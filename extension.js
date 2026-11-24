import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {TasksClient, dueInfo} from './api.js';

const REFRESH_SECONDS = 300;
const CARD_MAX_LINES = 22;

export default class GTasksExtension extends Extension {
    enable() {
        this._client = new TasksClient();
        this._lists = [];
        this._error = null;

        // --- top-bar button + menu ---
        this._button = new PanelMenu.Button(0.0, 'Google Tasks');
        const box = new St.BoxLayout();
        box.add_child(new St.Icon({icon_name: 'object-select-symbolic', style_class: 'system-status-icon'}));
        this._count = new St.Label({text: '…', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._count);
        this._button.add_child(box);

        const menu = this._button.menu;
        this._section = new PopupMenu.PopupMenuSection();
        menu.addMenuItem(this._section);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const entryItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._entry = new St.Entry({hint_text: 'Add task…', x_expand: true, can_focus: true});
        this._entry.clutter_text.connect('activate', () => this._add());
        entryItem.add_child(this._entry);
        menu.addMenuItem(entryItem);
        menu.addAction('Refresh', () => this._refresh());
        menu.addAction('Open Google Tasks', () =>
            Gio.AppInfo.launch_default_for_uri('https://calendar.google.com/calendar/u/0/r/tasks', null));

        Main.panel.addToStatusArea(this.uuid, this._button);

        // --- desktop card (sits on the wallpaper, below all windows) ---
        this._card = new St.BoxLayout({style_class: 'gtasks-card', orientation: Clutter.Orientation.VERTICAL});
        Main.layoutManager._backgroundGroup.add_child(this._card);
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._place());
        this._place();

        // --- refresh triggers ---
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
        this._net = Gio.NetworkMonitor.get_default();
        this._netId = this._net.connect('network-changed', (m, up) => {
            if (up && this._error)
                this._refresh();
        });
        this._render();
        this._refresh();
    }

    disable() {
        GLib.source_remove(this._timer);
        this._net.disconnect(this._netId);
        Main.layoutManager.disconnect(this._monitorsId);
        this._client.destroy();
        this._card.destroy();
        this._button.destroy();
        this._client = this._card = this._button = this._section = this._entry = this._count = null;
        this._net = null;
    }

    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m || !this._card)
            return;
        this._card.set_position(m.x + m.width - 340, m.y + Main.panel.height + 30);
        Main.layoutManager._backgroundGroup.set_child_above_sibling(this._card, null);
    }

    async _refresh() {
        if (this._busy)
            return;
        this._busy = true;
        try {
            const lists = await this._client.fetchAll();
            this._lists = lists;
            this._error = null;
        } catch (e) {
            this._error = e.message === 'NOT_SETUP'
                ? 'Not signed in.\nSettings → Online Accounts → Google'
                : `Offline or error:\n${e.message}`;
        } finally {
            this._busy = false;
        }
        if (this._client)
            this._render();
    }

    async _run(fn) {
        try {
            await fn();
        } catch (e) {
            Main.notifyError('Google Tasks', e.message);
        }
        if (this._client)
            this._refresh();
    }

    _add() {
        const title = this._entry.text.trim();
        const list = this._lists[0];
        if (!title || !list)
            return;
        this._entry.text = '';
        this._run(() => this._client.add(list.id, title));
    }

    _render() {
        const total = this._lists.reduce((n, l) => n + l.tasks.length, 0);
        this._count.text = this._error && !this._lists.length ? '!' : ` ${total}`;
        if (this._lists[0])
            this._entry.hint_text = `Add to “${this._lists[0].title}”…`;

        // menu
        this._section.removeAll();
        if (this._error)
            this._section.addMenuItem(new PopupMenu.PopupMenuItem(this._error, {reactive: false}));
        for (const l of this._lists) {
            const head = new PopupMenu.PopupMenuItem(l.title, {reactive: false});
            head.label.add_style_class_name('gtasks-header');
            this._section.addMenuItem(head);
            for (const t of l.tasks) {
                const due = dueInfo(t);
                const item = new PopupMenu.PopupMenuItem(
                    `${t.depth ? '    ' : ''}○  ${t.title || '(untitled)'}${due ? `   · ${due.text}` : ''}`);
                if (due?.overdue)
                    item.label.add_style_class_name('gtasks-overdue');
                item.connect('activate', () => this._run(() => this._client.complete(l.id, t.id)));
                this._section.addMenuItem(item);
            }
        }

        // desktop card
        this._card.destroy_all_children();
        const add = (text, cls) => this._card.add_child(new St.Label({text, style_class: cls ?? ''}));
        if (this._error) {
            add(this._error, 'gtasks-dim');
            if (!this._lists.length)
                return;
        }
        let lines = 0, hidden = 0;
        for (const l of this._lists) {
            if (!l.tasks.length)
                continue;
            if (lines >= CARD_MAX_LINES) {
                hidden += l.tasks.length;
                continue;
            }
            add(l.title, 'gtasks-list');
            for (const t of l.tasks) {
                if (lines++ >= CARD_MAX_LINES) {
                    hidden++;
                    continue;
                }
                const row = new St.BoxLayout({x_expand: true});
                row.add_child(new St.Label({
                    text: `${t.depth ? '    ' : ''}○  ${t.title || '(untitled)'}`, x_expand: true,
                }));
                const due = dueInfo(t);
                if (due)
                    row.add_child(new St.Label({text: due.text, style_class: due.overdue ? 'gtasks-due gtasks-overdue' : 'gtasks-due'}));
                this._card.add_child(row);
            }
        }
        if (!total)
            add('All done ✓', 'gtasks-dim');
        if (hidden)
            add(`+${hidden} more`, 'gtasks-dim');
    }
}
