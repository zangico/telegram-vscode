## Features

> **Moved:** this extension is now published as `zangico.telegram-vscode` (previously `livingasync.telegram-vscode`). Install this one and uninstall the old one. Settings carry over; set the proxy password again.

Telegram for VSCode: use Telegram Web inside VS Code, in the sidebar or in an editor tab.

- Optional proxy for all Telegram traffic: HTTP, HTTPS, SOCKS4 or SOCKS5, with authentication.
- The proxy password is kept in the operating system keychain.

## Usage

Use it from the sidebar

or

Open Command Palette with `CTRL`+`SHIFT`+`P` or `F1` and type `Open Telegram in Tab`

Log in with the QR code or your phone number.

## Proxy settings

Set these in your user settings (Settings > Telegram, or the gear icon at the top of the Telegram sidebar):

- `telegram-vscode.proxy.type`: `none` (default), `http`, `https`, `socks4` or `socks5`
- `telegram-vscode.proxy.host`: proxy host name or IP (IPv6 in square brackets)
- `telegram-vscode.proxy.port`: proxy port
- `telegram-vscode.proxy.username`: user name, if the proxy needs one

Local port:

- `telegram-vscode.server.port`: local port of the server that serves Telegram Web (default `49152`, 1024-65535). If it is used by another program, the next 9 ports are tried in order. Telegram keeps a separate login for each port, so changing the port means logging in again.

For the password run the command `Telegram: Set Proxy Password`. Invalid settings never fall back to a direct connection: Telegram is not loaded and an error is shown.

## Known Issues
- Passkeys do not work: log in with the QR code or the phone number
- Voice messages cannot be recorded
- Audio/video playback may not work

Every feedback would be appreciated
If you need help or have any question, feel free to ask at zangico@gmail.com

## Support

If you find this extension useful, you can [buy me a coffee](https://buymeacoffee.com/zangico) ☕ (also from the heart icon at the top of the Telegram sidebar; hide it with `telegram-vscode.showSupportButton`)

## Release Notes

### 1.0.0

Initial release

### 1.1.0

Added sidebar feature

### 1.2.0

No need for external script running anymore

### 1.2.1

Added Output Channel 'Telegram-VSCode'
Fixed BUG with proxy script not running...

### 1.2.2

Fix for the proxy script not running on macos

### 1.3.0

- Proxy support (HTTP, HTTPS, SOCKS4, SOCKS5) applied to all Telegram traffic
- Proxy password stored in the OS keychain
- The local server now runs on VS Code's own Node runtime (no more platform binaries), listens on 127.0.0.1 only and stops with the extension
- The sidebar keeps its state when hidden
- Telegram Web loads only after the local server is ready
- Configurable local port (`telegram-vscode.server.port`) with automatic fallback to the next 9 ports when it is used by another program
- Settings and Buy Me a Coffee buttons in the sidebar header

### 2.0.0

- The extension moved to the Marketplace publisher `zangico`; the new id is `zangico.telegram-vscode`
- If you use `livingasync.telegram-vscode`, install this one and uninstall the old one
- Settings carry over; the proxy password must be set again (SecretStorage is per extension id)
- Telegram may ask you to log in again
