# Telegram for VS Code

> **Moved:** this extension is now published as Telegram Sidebar, `zangico.telegram-sidebar` (previously `livingasync.telegram-vscode`). Install this one and uninstall the old one. Settings carry over; set the proxy password again, and Telegram may ask you to log in again.

A VS Code extension that shows Telegram Web K (`https://web.telegram.org/k/`) inside VS Code, in the activity-bar sidebar or in an editor tab. A small local server, started by the extension on `127.0.0.1` (port 49152 by default, configurable), serves Telegram Web to the webview and sends all Telegram traffic, including the MTProto WebSockets, through an optional HTTP, HTTPS, SOCKS4 or SOCKS5 proxy.

## Features

- Telegram in the sidebar (view `telegramWebview`, container `telegram-sidebar`) and in an editor tab (command `telegram-vscode.openTelegramWeb`, title "Open Telegram in Tab").
- Proxy support (HTTP, HTTPS, SOCKS4, SOCKS5) for all Telegram traffic, with optional authentication. The password is stored in the OS keychain (VS Code SecretStorage).
- Configurable local port (`telegram-sidebar.server.port`, default 49152) with automatic fallback to the next 9 ports when it is used by another program.
- Fail closed: invalid proxy settings never fall back to a direct connection.
- The local server runs on VS Code's own Node runtime, listens on loopback only and stops with the extension.
- The sidebar keeps its state while hidden (`retainContextWhenHidden`).
- Unread count on the sidebar badge and in the status bar (the count Telegram Web K passes to `navigator.setAppBadge`: unread unmuted chats).
- Notifications as VS Code messages with Do Not Disturb, optional message preview and muting while debugging.
- Commands: **Telegram: Copy Selection for Chat**, **Telegram: Toggle Chat** (`Ctrl+Alt+G`, `Cmd+Alt+G` on macOS), **Telegram: Move View...**, and the `telegram-sidebar.zoom` setting.

## Quick usage

1. Install the extension (publisher `zangico`, name `telegram-sidebar`; VS Code >= 1.91).
2. Click the Telegram icon in the activity bar, or run **Open Telegram in Tab** from the Command Palette.
3. Log in with the QR code or the phone number (passkeys do not work, see [troubleshooting](docs/troubleshooting.md)).
4. To use a proxy, set `telegram-sidebar.proxy.type`, `.host`, `.port` (and optionally `.username` plus the **Telegram: Set Proxy Password** command). See [docs/configuration.md](docs/configuration.md).

## Repository layout

```
.
├── README.md                  This file
├── .gitignore                 Ignores node_modules/ and *.vsix
├── .github/
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md      Bug report template
│       └── feature_request.md Feature request template
├── docs/
│   ├── architecture.md        Components, request flow, design decisions, limitations
│   ├── configuration.md       Settings, password command, examples
│   ├── development.md         Setup, tests, debugging, packaging, release checklist
│   └── troubleshooting.md     Known limitations and common problems
└── extension/                 The VS Code extension (the only package in the repo)
    ├── package.json           Manifest: commands, settings, views, scripts, dependencies
    ├── package-lock.json      Locked dependencies (must be committed)
    ├── README.md              Marketplace page and release notes
    ├── LICENSE                MIT license
    ├── .vscodeignore          Files excluded from the .vsix (test/**)
    ├── images/
    │   ├── icon.png           Extension icon (rendered from icon.svg)
    │   ├── icon.svg           Extension icon source
    │   └── sidebar_icon.svg   Activity-bar icon
    ├── src/
    │   ├── extension.js       Extension host entry: commands, webviews, server lifecycle
    │   ├── server.js          Local reverse proxy; runs as a child process
    │   ├── migrateSettings.js Moves telegram-vscode.* settings to telegram-sidebar.*
    │   ├── patch.js           Script prepended to every JavaScript response (reroute, page bridge, session name)
    │   └── proxyUrl.js        Settings -> proxy URL (validation)
    └── test/
        ├── bridge.test.js     node:test unit tests for the page-to-extension bridge in patch.js
        ├── migrateSettings.test.js node:test unit tests for the settings migration
        ├── proxy.test.js      node:test unit tests for proxyUrl.js, the reroute patch and nameSession
        └── server.test.js     node:test tests that fork the real server (port fallback, sharing, take-over)
```

## Documentation

- [docs/architecture.md](docs/architecture.md)
- [docs/configuration.md](docs/configuration.md)
- [docs/development.md](docs/development.md)
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [extension/README.md](extension/README.md) (marketplace page, release notes)

## Support

If you find this extension useful, you can [buy me a coffee](https://buymeacoffee.com/zangico).

## License

MIT, see [extension/LICENSE](extension/LICENSE).
