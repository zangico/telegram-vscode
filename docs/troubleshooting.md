# Troubleshooting

Root causes are explained in [architecture.md](architecture.md#known-limitations-and-root-causes). First step for any problem: open the Output channel **Telegram-VSCode**.

## Known limitations

| Problem | Cause | Workaround |
|---|---|---|
| Passkey login fails | Telegram Web uses Telegram's relying party ID, but the page origin is `http://localhost:<port>` (default port 49152); WebAuthn binds credentials to the origin domain. VS Code's webview iframe policy also lacks `publickey-credentials-get`. | Log in with the QR code or the phone number. |
| Voice messages cannot be recorded | The webview iframe policy has no `microphone` permission. | Record in another Telegram client. |
| Audio or video does not play, or plays only partly | Unconfirmed. Codecs are unlikely (VS Code 1.146 ffmpeg includes AAC, H.264, MP3, Opus, Vorbis, FLAC). Most likely Telegram's media streaming through its service worker (`stream/` URLs), which runs in a third-party iframe nested in the webview. | Download the file and open it externally. To diagnose: see below. |
| Messaging stops working after a Telegram update | Telegram Web may add a `connect-src` Content-Security-Policy, which would block the rewritten connections to `http://localhost:<port>`. | Report an issue with the console errors from the webview developer tools. |

### Diagnosing media playback (hypothesis)

1. Command Palette: **Developer: Open Webview Developer Tools** with the Telegram view focused.
2. Application > Service Workers: is a service worker registered for `http://localhost:<port>`? Is it running?
3. Network tab: filter for `stream/`; look for failed or pending requests when you press play.
4. Console: look for media errors (`MEDIA_ERR_*`, codec errors) versus service worker or fetch errors.
5. Include the findings in an issue.

## Common problems

| Symptom | Cause | Fix |
|---|---|---|
| Sidebar or tab stays blank | Proxy settings are invalid, so the server was not started and the webviews never get their content. | Read the error message and the Output channel; fix `telegram-vscode.proxy.*`. Settings changes restart the server, then reopen the tab. |
| Sidebar or tab stays blank and an error asks to fix `telegram-vscode.server.port` | The value is not an integer between 1024 and 65535, so the server was not started. | Fix the setting; the server restarts. |
| Error "No usable port between A and B" | All 10 candidate ports (the configured port and the next 9) are used by other programs or reserved by the OS (for example Windows excluded port ranges). | Change `telegram-vscode.server.port` to another range, or free a port (`lsof -i :49152` on macOS and Linux, `netstat -ano` on Windows). Logging in is needed again on a new port. |
| Output channel shows `Port N is used by another program, trying the next one` | Another program holds port N (or the OS reserves it, `EACCES`). The server uses the next free port, which is a different origin. | Log in once on the new port. The session on each port persists, and the extension returns to the configured port (and its login) on the next start once it is free. To stay on the configured port, free it (`lsof -i :49152`). |
| Logged out and the Output channel shows a port other than the configured one | Each port is a separate origin, so Telegram keeps a separate login per port. After an upgrade from a version before 1.3.0, a server binary of the old version may still hold port 49152 and does not answer the ping, so 1.3.0 uses 49153. | Log in on the new port, or end the old process (it also ends after a reboot) and restart the extension to return to 49152. |
| Messaging works in one window but not after closing another window | The window that owned the port closed; another server takes over within about 2 seconds. | Wait, then reload the webview. |
| Requests fail with HTTP 500 after setting a proxy | The proxy is unreachable or refuses the connection. The extension deliberately does not fall back to a direct connection. | Check type, host, port, credentials; check the proxy is running. |
| Proxy requires authentication, connection refused | No user name set, or no password stored. | Set `telegram-vscode.proxy.username`, run **Telegram: Set Proxy Password**. |
| Telegram shows "connecting" after changing a proxy setting | Open webviews are not reloaded when the server restarts. | **Developer: Reload Webviews**, or reopen the tab. |
| Logged out after an update | The login lives in the storage of the origin `http://localhost:<port>`; clearing webview data or a different port (changed setting or fallback) resets it. | Log in again. The session on each port survives normal restarts. |
| Sidebar and tab ask for login separately | They are separate webviews; sharing depends on Chromium storage partitioning (not verified). | Log in in each, or use one of them. |
| IPv6 proxy address is rejected | Host must be in square brackets. | Use `[::1]`, not `::1`. |
