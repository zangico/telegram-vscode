# Configuration

All settings are defined in `extension/package.json` under `contributes.configuration`, have `application` scope (user settings only; a workspace `.vscode/settings.json` is ignored), and appear in the Settings UI under "Telegram". The gear icon in the Telegram sidebar header (command **Telegram: Open Settings**, `telegram-vscode.openSettings`) opens the Settings UI filtered to this extension.

## Settings

| Key | Type | Default | Meaning |
|---|---|---|---|
| `telegram-vscode.server.port` | integer | `49152` | Base port of the local server, 1024 to 65535. If it is used by another program, the next 9 ports are tried in order (never above 65535). Telegram keeps a separate login per port. |
| `telegram-vscode.proxy.type` | string: `none`, `http`, `https`, `socks4`, `socks5` | `"none"` | Proxy used for all Telegram traffic. `none` connects directly. |
| `telegram-vscode.proxy.host` | string | `""` | Proxy host name or IP address. IPv6 addresses go in square brackets, for example `[::1]`. Surrounding whitespace is trimmed. |
| `telegram-vscode.proxy.port` | integer or null | `null` | Proxy port, 1 to 65535. Required when `type` is not `none`. |
| `telegram-vscode.proxy.username` | string | `""` | User name, if the proxy requires authentication. Empty means no authentication. |
| `telegram-vscode.zoom` | integer | `100` | Zoom of the Telegram view in percent, 50 to 200. |
| `telegram-vscode.notifications.enabled` | boolean | `true` | Show Telegram notifications as VS Code information messages. |
| `telegram-vscode.notifications.showPreview` | boolean | `true` | Include the message text in the notification. |
| `telegram-vscode.notifications.muteWhileDebugging` | boolean | `true` | Skip notifications while a debug session is active. |
| `telegram-vscode.statusBar.enabled` | boolean | `true` | Show the unread counter and the Do Not Disturb indicator in the status bar. |
| `telegram-vscode.showSupportButton` | boolean | `true` | Shows the heart (Buy Me a Coffee) button in the Telegram sidebar header. Does not restart the server. |

Proxy types map to these URL schemes (`extension/src/proxyUrl.js`):

| `type` | Scheme | Notes |
|---|---|---|
| `http` | `http://` | HTTP proxy, CONNECT tunnelling (`https-proxy-agent`). |
| `https` | `https://` | TLS to the proxy itself (`https-proxy-agent`). |
| `socks4` | `socks4a://` | Host names are resolved by the proxy (`socks-proxy-agent`). |
| `socks5` | `socks5h://` | Host names are resolved by the proxy (`socks-proxy-agent`). |

## Commands

| Command | Meaning |
|---|---|
| **Telegram: Toggle Do Not Disturb** (`telegram-vscode.toggleDoNotDisturb`) | Mutes or unmutes notifications. Stored in the extension's global state; the status bar shows `$(bell-slash)` while it is on (click it to turn it off). |
| **Telegram: Copy Selection for Chat** (`telegram-vscode.sendSelection`) | In the editor context menu when text is selected. Copies the selection as a code block (three backticks around the code) to the clipboard and reveals the sidebar; paste it into a chat. |
| **Telegram: Toggle Chat** (`telegram-vscode.toggle`) | `Ctrl+Alt+G` (`Cmd+Alt+G` on macOS). Closes the sidebar if the Telegram view is visible, otherwise focuses it. |
| **Telegram: Move View...** (`telegram-vscode.moveView`) | Focuses the view and opens VS Code's "Move View" picker (bottom panel, secondary sidebar...). Dragging the activity-bar icon also works. |

Notifications and the unread counter come from the Telegram page, so they start once the Telegram view (or a tab) has been opened in the window and you are logged in. Telegram Web K decides when to notify (for example not for muted chats, and not while its page has focus).

## Password command

Command Palette: **Telegram: Set Proxy Password** (`telegram-vscode.setProxyPassword`). It opens a masked input box.

- A non-empty value is stored in VS Code SecretStorage (OS keychain) under the key `telegram-vscode.proxy.password`.
- An empty value deletes the stored password.
- Cancelling (Escape) changes nothing.
- The password is only used when `telegram-vscode.proxy.username` is non-empty; with an empty user name no credentials are sent.

## What happens when settings change

A change to a `telegram-vscode.proxy.*` setting or to `telegram-vscode.server.port`, or to the stored password (including from another window), stops the running server and starts a new one with the new proxy URL and port. Overlapping restarts are collapsed (the latest wins).

- Invalid settings (unknown type, bad host, port outside 1-65535 or not an integer): no server is started, an error message "Telegram: ... Fix the "telegram-vscode.proxy" settings." is shown, and the reason is written to the Output channel `Telegram-VSCode`. There is no fallback to a direct connection. Webviews opened before the first successful start stay empty.
- Open webviews are not reloaded when only the proxy changes. If Telegram shows a disconnected state after a change, reload the webview (Command Palette: **Developer: Reload Webviews**) or reopen the tab.
- An invalid `telegram-vscode.server.port` (not an integer, below 1024 or above 65535): no server is started, an error message "Telegram: "telegram-vscode.server.port" must be a number between 1024 and 65535." is shown, and the reason is written to the Output channel.
- Open webviews follow the server: when the server reports a different port than the current one, the extension reloads every open webview's content on `http://localhost:<port>`.
- With `type: none` the server connects directly.

## Examples

SOCKS5 proxy running locally on `127.0.0.1:1080`:

```json
{
  "telegram-vscode.proxy.type": "socks5",
  "telegram-vscode.proxy.host": "127.0.0.1",
  "telegram-vscode.proxy.port": 1080
}
```

Authenticated HTTP proxy:

```json
{
  "telegram-vscode.proxy.type": "http",
  "telegram-vscode.proxy.host": "proxy.example.com",
  "telegram-vscode.proxy.port": 3128,
  "telegram-vscode.proxy.username": "alice"
}
```

Then run **Telegram: Set Proxy Password** and enter the password.

Check the result in the Output channel `Telegram-VSCode`; the server logs a line such as `Listening on http://127.0.0.1:49152 via socks5h://127.0.0.1:1080` (host and port only, with "(with credentials)" appended when a user name is set).

## Port and multi-window behaviour

The server tries the configured port (`telegram-vscode.server.port`, default `49152`), then the next ports, up to 10 candidates in total and never above 65535. Each VS Code window starts its own server child process. For each candidate port:

- If it binds, the server logs "Listening on ..." and serves on it.
- If it is taken (`EADDRINUSE`) or reserved by the OS (`EACCES`, for example Windows excluded port ranges), the server asks `GET /__telegram-vscode/ping` on it (1 second timeout). The reply `telegram-vscode` means the server of another VS Code window owns the port: this window's webviews use that server, and this server retries taking the port over every 2 seconds. The owning window's proxy settings apply to both windows. Settings are application-scoped, so windows normally have the same values.
- Any other reply or no reply means another program holds the port: the server logs "Port N is used by another program, trying the next one" and tries the next port.
- If no candidate is usable, the server logs "No usable port between A and B" and the extension shows an error asking to change `telegram-vscode.server.port`.

If the owning window closes, another window's server takes over within about 2 seconds. Connections of the other windows break during the hand-over; reload their webviews if Telegram does not reconnect. If during the retries the port turns out to be held by a foreign program, the server picks a port again starting from the configured port.

Each port is a separate origin (`http://localhost:<port>`), so Telegram keeps a separate login per port:

- Falling back to another port means logging in once on that port. The session on each port persists, and as soon as the configured port is free again the extension goes back to it (and to its login) on the next start.
- Changing `telegram-vscode.server.port` means logging in again, unless that port was used before.
- Upgrade note: a server binary of a version before 1.3.0 that is still running holds port 49152 and does not answer the ping, so 1.3.0 falls back to 49153 (a new login) until that old process ends, for example after a reboot.
- Changing a setting restarts the server in every window; whichever binds the port next serves.
