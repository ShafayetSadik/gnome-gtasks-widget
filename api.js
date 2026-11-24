// Tiny Google Tasks client (GLib + libsoup3 only). Usable from gnome-shell or plain gjs.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.DBusConnection.prototype, 'call');

const API = 'https://tasks.googleapis.com/tasks/v1';
const enc = s => GLib.Uri.escape_string(s, null, false);

export class TasksClient {
    constructor() {
        this._session = new Soup.Session({timeout: 20});
        this._token = null;
        this._expiry = 0;
    }

    destroy() {
        this._session.abort();
    }

    async _send(method, url, body, type, headers = {}) {
        const msg = Soup.Message.new(method, url);
        for (const [k, v] of Object.entries(headers))
            msg.request_headers.append(k, v);
        if (body !== undefined)
            msg.set_request_body_from_bytes(type, new GLib.Bytes(new TextEncoder().encode(body)));
        const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
        const text = new TextDecoder().decode(bytes.get_data() ?? new Uint8Array());
        if (msg.status_code < 200 || msg.status_code >= 300) {
            const err = new Error(`HTTP ${msg.status_code}: ${text.slice(0, 200)}`);
            err.status = msg.status_code;
            throw err;
        }
        return text ? JSON.parse(text) : {};
    }

    async _ensureToken() {
        if (this._token && Date.now() < this._expiry)
            return;
        // Token from the Google account in Settings → Online Accounts.
        const goa = await goaToken();
        if (!goa)
            throw new Error('NOT_SETUP');
        this._token = goa.token;
        this._expiry = Date.now() + Math.max(goa.expires - 60, 30) * 1000;
    }

    async _api(method, path, json) {
        await this._ensureToken();
        return this._send(method, API + path,
            json === undefined ? undefined : JSON.stringify(json),
            'application/json', {Authorization: `Bearer ${this._token}`});
    }

    // -> [{id, title, tasks: [{id, title, due, depth}]}]
    async fetchAll() {
        const lists = (await this._api('GET', '/users/@me/lists?maxResults=100')).items ?? [];
        return Promise.all(lists.map(async l => {
            const tasks = [];
            let page = '';
            do {
                const r = await this._api('GET', `/lists/${enc(l.id)}/tasks?showCompleted=false&maxResults=100` +
                    (page ? `&pageToken=${enc(page)}` : ''));
                tasks.push(...(r.items ?? []));
                page = r.nextPageToken;
            } while (page);
            return {id: l.id, title: l.title, tasks: order(tasks)};
        }));
    }

    complete(listId, taskId) {
        return this._api('PATCH', `/lists/${enc(listId)}/tasks/${enc(taskId)}`, {status: 'completed'});
    }

    add(listId, title) {
        return this._api('POST', `/lists/${enc(listId)}/tasks`, {title});
    }

    move(listId, taskId, destListId) {
        return this._api('POST',
            `/lists/${enc(listId)}/tasks/${enc(taskId)}/move?destinationTasklist=${enc(destListId)}`);
    }

    addList(title) {
        return this._api('POST', '/users/@me/lists', {title});
    }
}

// Access token from GNOME Online Accounts (first Google account), or null if none.
async function goaToken() {
    const bus = Gio.DBus.session;
    const call = (path, iface, method, type) => bus.call('org.gnome.OnlineAccounts', path, iface, method,
        null, type ? new GLib.VariantType(type) : null, Gio.DBusCallFlags.NONE, -1, null);
    let objs;
    try {
        [objs] = (await call('/org/gnome/OnlineAccounts',
            'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects')).recursiveUnpack();
    } catch {
        return null;
    }
    for (const [path, ifaces] of Object.entries(objs)) {
        if (ifaces['org.gnome.OnlineAccounts.Account']?.ProviderType !== 'google' ||
            !ifaces['org.gnome.OnlineAccounts.OAuth2Based'])
            continue;
        try {
            const [token, expires] = (await call(path,
                'org.gnome.OnlineAccounts.OAuth2Based', 'GetAccessToken', '(si)')).deepUnpack();
            return {token, expires};
        } catch {
            throw new Error('NOT_SETUP');
        }
    }
    return null;
}

// Parents in Google's order, each followed by its subtasks.
function order(tasks) {
    const byPos = (a, b) => (a.position < b.position ? -1 : 1);
    const out = [];
    for (const t of tasks.filter(x => !x.parent).sort(byPos)) {
        out.push({...t, depth: 0});
        for (const c of tasks.filter(x => x.parent === t.id).sort(byPos))
            out.push({...c, depth: 1});
    }
    const seen = new Set(out.map(t => t.id));
    for (const t of tasks)
        if (!seen.has(t.id))
            out.push({...t, depth: 0});
    return out;
}

// -> {text: 'Nov 25' | 'today', overdue: bool} or null
export function dueInfo(task) {
    if (!task.due)
        return null;
    const day = task.due.slice(0, 10);
    const today = GLib.DateTime.new_now_local().format('%F');
    if (day === today)
        return {text: 'today', overdue: false};
    const dt = GLib.DateTime.new_from_iso8601(task.due, null);
    return {text: dt ? dt.format('%b %-d') : day, overdue: day < today};
}
