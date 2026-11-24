# Google Tasks widget for GNOME

A minimal GNOME Shell extension that shows your Google Tasks:

- **Top bar**: ✓ icon with your open-task count. The menu lists all task lists — click a task to mark it done, type in the box to add a task to your first list.
- **Desktop**: a semi-transparent card in the top-right corner, behind your windows.

No Google Cloud project, no background service, no extra packages. It signs in through the Google account you add in **Settings → Online Accounts**, and refreshes every 5 minutes.

## Requirements

- GNOME Shell 50 (e.g. Ubuntu 26.04)
- A Google account added in **Settings → Online Accounts** (keep *Calendar* turned on)

## Install

```sh
git clone https://github.com/ShafayetSadik/gnome-gtasks-widget.git \
  ~/.local/share/gnome-shell/extensions/gtasks@shafayetsadik.github.io
```

Log out and back in (required on Wayland), then:

```sh
gnome-extensions enable gtasks@shafayetsadik.github.io
```

## Update

```sh
git -C ~/.local/share/gnome-shell/extensions/gtasks@shafayetsadik.github.io pull
```

Then log out and back in.

## Customize

| What | Where |
|---|---|
| Refresh interval | `REFRESH_SECONDS` in `extension.js` |
| Max lines on the card | `CARD_MAX_LINES` in `extension.js` |
| Card position | `_place()` in `extension.js` |
| Colours, width, transparency, font size | `stylesheet.css` |

CSS changes apply after `gnome-extensions disable` + `enable`; JS changes need a log out/in.

## Troubleshooting

- **Card says "Not signed in"** — add your Google account in Settings → Online Accounts.
- **Nothing shows up** — check for errors:
  ```sh
  journalctl -b -o cat /usr/bin/gnome-shell | grep -iA5 gtasks
  ```

## Notes

- The desktop card is display-only (Ubuntu's desktop-icons layer sits above it and takes clicks); use the top-bar menu to tick off or add tasks.
- Clicking a task in the menu marks it done immediately. Undo it in Google Tasks if needed.

## License

MIT
