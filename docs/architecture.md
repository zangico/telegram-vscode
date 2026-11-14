# Architecture

## Components

| Component | File | Runs in | Responsibility |
|---|---|---|---|
| Extension entry | `extension/src/extension.js` | VS Code extension host | Registers the commands and the sidebar view, builds the webview HTML (an iframe to `http://localhost:<port>`), reads settings and the password, forks and stops the server, and points the open webviews at the port the server reports. |
| Local server | `extension/src/server.js` | Child process (`child_process.fork`, `ELECTRON_RUN_AS_NODE=1`) | Reverse proxy built on `http` + `http-proxy-middleware` 2.x. Serves Telegram Web, strips framing headers, injects the patch, routes `/__tg/...` requests, applies the outbound proxy. |
| Patch | `extension/src/patch.js` | Browser (page, workers, service worker) | `rerouteTelegramTraffic(scope)`: wraps `WebSocket` and `fetch` so Telegram URLs go to the local server. Exported as `PATCH`, the source text `(fn)(self);\n`. |
| Proxy URL builder | `extension/src/proxyUrl.js` | Extension host (and tests) | `buildProxyUrl(settings, password)`: validates settings, returns a proxy URL, `null` (direct) or throws. |
| Tests | `extension/test/proxy.test.js`, `extension/test/server.test.js` | Node (`node --test`) | Unit tests for `proxyUrl.js` and `patch.js`; `server.test.js` forks the real server to test the port fallback. |

Constants in `server.js`: `HOST = '127.0.0.1'`, `PORT_ATTEMPTS = 10`, `PING_PATH = '/__telegram-vscode/ping'`, `PING_REPLY = 'telegram-vscode'`, `UPSTREAM = ORIGIN = 'https://web.telegram.org'`, `DC_PATH = /^\/__tg\/([a-z0-9-]+)(\/.*)?$/`.

Command and view IDs: `telegram-vscode.openTelegramWeb`, `telegram-vscode.setProxyPassword`, view `telegramWebview` in container `telegram-sidebar`, webview panel type `telegramWebviewTab`. Secret key: `telegram-vscode.proxy.password`. Output channel: `Telegram-VSCode`.

## Request flow

```mermaid
flowchart LR
    W["Webview iframe<br/>(Telegram Web K)"] -->|"http://localhost:port"| S["Local server<br/>child process<br/>127.0.0.1:port"]
    S -->|"direct"| T["web.telegram.org<br/>*.web.telegram.org"]
    S -->|"optional: HTTP / HTTPS / SOCKS4 / SOCKS5"| P["Proxy"]
    P --> T
```

Page and asset requests:

1. The webview HTML contains `<iframe src="http://localhost:<port>">`, where `<port>` is the one the server reported.
2. The server maps a request path `p` to `https://web.telegram.org/k` + `p` (`/` becomes `/k/`), via `pathRewrite`.
3. The response goes through `responseInterceptor`: `X-Frame-Options` is removed (so the page can be framed); for JavaScript responses with status 200 the `PATCH` text is prepended and `ETag`/`Last-Modified` are removed.
4. Incoming `If-None-Match` and `If-Modified-Since` are deleted, so the server always receives a full body. Telegram serves assets with `cache-control: max-age=3600`, so a copy cached before patching could otherwise be revalidated with a 304 and used unpatched.
5. Upstream requests and WebSocket upgrades get `Origin: https://web.telegram.org`, set through `headers` (proxy agents connect asynchronously, so `onProxyReq` would run after the headers are sent).

## How MTProto traffic is rerouted

Telegram Web K opens its MTProto WebSockets to `wss://kws<dc>[-1].web.telegram.org/apiws` from a SharedWorker (fallback: dedicated Worker) and also registers a service worker. These connections go from the browser straight to Telegram and never pass through the local server, so a proxy configured only in the server would not cover messaging.

`patch.js` fixes this:

- `server.js` prepends `PATCH` to every JavaScript response, so it runs at the top of the page scripts, worker scripts and the service worker script, each time with `self` as scope.
- `rerouteTelegramTraffic` replaces `scope.WebSocket` with a `Proxy` whose `construct` trap rewrites the URL, and `scope.fetch` with a wrapper that rewrites string and `URL` arguments. `Request` objects are passed through unchanged. XMLHttpRequest and `EventSource` are not patched.
- Rewrite rule: `wss|https://<sub>.web.telegram.org/<rest>` becomes `ws|http://<scope.location.host>/__tg/<sub>/<rest>`. Other URLs are untouched. A guard (`__telegramVscodeReroute`) prevents double wrapping.
- The server's `router` sends `/__tg/<sub>/...` to `https://<sub>.web.telegram.org`, and `pathRewrite` strips the `/__tg/<sub>` prefix. WebSocket upgrades are handled by `server.on('upgrade', proxy.upgrade)` and use the same router and agent.

The server accepts any `[a-z0-9-]+` subdomain under `/__tg/`, but the upstream host is always `<sub>.web.telegram.org`.

## Process lifecycle

1. `activate()` registers commands, views and listeners, then calls `startServer(secrets)`.
2. `startServer` reads the `telegram-vscode` settings (`proxy.*` and `server.port`) and the password from SecretStorage, waits for `stopServer()` to finish (the old server must release the port first, otherwise the new one would find it busy and move to the next port), validates the port (integer, 1024-65535) and builds the proxy URL. On an invalid port or invalid proxy settings it logs, shows an error message and returns without starting a server.
3. It forks `src/server.js` with `ELECTRON_RUN_AS_NODE=1` and `stdio: ['ignore', 'pipe', 'pipe', 'ipc']`, pipes stdout/stderr to the Output channel, and sends `{ proxyUrl, port }` over IPC (`proxyUrl` is `null` for direct).
4. The server creates the agent (`HttpsProxyAgent` for `http:`/`https:`, `SocksProxyAgent` for `socks*:`) and tries `port`, then the next ports, up to `PORT_ATTEMPTS` candidates (never above 65535):
   - If `listen` succeeds, it logs "Listening on ..." and sends `{ ready: <port> }`.
   - If the port fails with `EADDRINUSE` or `EACCES` (the latter covers ports reserved by the OS, for example Windows excluded port ranges), it probes `GET PING_PATH` on that port with a 1 second timeout. The reply `PING_REPLY` means the server of another VS Code window owns the port: it sends `{ ready: <port> }` (the webviews use that server) and retries `listen` on the port every 2 seconds. When the other window releases it, this server takes over with its own proxy settings. If during the retries the port turns out to be held by a foreign program, it picks a port again starting from the base port.
   - Otherwise it logs "Port N is used by another program, trying the next one" and tries the next port.
   - If no candidate is usable, it logs and sends `{ error: 'No usable port between A and B' }`; the extension shows an error asking to change `telegram-vscode.server.port`.
5. The extension has no ready promise. It keeps `serverPort` and the set of open webviews. On `{ ready: port }` with a port different from `serverPort`, it sets the HTML of every open webview to an iframe on `http://localhost:<port>`. A webview opened before the first ready message gets its HTML when the message arrives, so Telegram Web never loads before a server answers. If the settings are invalid, no server runs and the webviews stay empty. Messages from a replaced (killed) child are ignored.
6. A change to a `telegram-vscode.proxy.*` setting, to `telegram-vscode.server.port` or to the stored password restarts the server (a counter, `startRequest`, discards overlapping restarts). A restart that keeps the same port does not reload the open webviews; reload them if connections do not recover.
7. The server exits on IPC `disconnect`, and the extension kills it in `stopServer` (called from `deactivate` and from the subscriptions). It never outlives the extension host.

## Port and origin

The webview content is an iframe with origin `http://localhost:<port>`. Telegram's login session (IndexedDB, localStorage, service worker) lives in the storage of that origin, so each port has its own login. If the port changed on every start the user would be logged out every time, so the port is a setting (`telegram-vscode.server.port`, default 49152) and the fallback is deterministic: the base port, then base+1, up to 10 candidates. When the configured port is free again the extension returns to it, and to its login, on the next start. Only one server can own a port at a time; windows share it (see multi-window behaviour in [configuration.md](configuration.md)).

A server binary of a version before 1.3.0 that is still running holds 49152 and does not answer the ping, so 1.3.0 falls back to 49153 (a new login) until that process ends, for example after a reboot.

The iframe uses `localhost` while the server binds `127.0.0.1`; this relies on `localhost` resolving to IPv4 loopback.

The sidebar and the editor tab are different webviews. Whether they share the login depends on Chromium storage partitioning; this was not verified.

## Security notes

- The server listens on `127.0.0.1` only (until 1.2.2 it listened on all interfaces).
- Proxy settings have `application` scope: a workspace's `.vscode/settings.json` cannot change them, so an opened repository cannot redirect Telegram traffic.
- The password is stored in SecretStorage (OS keychain), never in settings. It is embedded in the proxy URL only in memory and over the IPC channel; the server log prints host and port only (`describe()`), plus "(with credentials)".
- Fail closed: invalid settings never start the server and never fall back to a direct connection. With an unreachable proxy requests fail (HTTP 500) instead of going direct.
- Proxy host names are resolved by the proxy (`socks5h`, `socks4a`), so local DNS filtering does not apply to Telegram host names.
- There is no authentication on the loopback port: any local process can use the server as a relay to `web.telegram.org` and `*.web.telegram.org` (through the configured proxy). The server is stateless; the Telegram session lives in the webview's storage, not in the server.
- `buildProxyUrl` validates the host with a strict pattern to prevent URL injection through the settings (for example `evil.com/x@a`).

## Design decisions

| Decision | Reason | Rejected alternative |
|---|---|---|
| Run the server in a forked child process on VS Code's runtime | Inside the extension host VS Code patches Node's `http`/`https`. With the default `http.proxySupport: "override"` (VS Code 1.146, `@vscode/proxy-agent` 0.46) an explicit `agent` passed by an extension is dropped for non-localhost hosts, so the proxy agent would be ignored. The child process is not patched. `ELECTRON_RUN_AS_NODE=1` reuses VS Code's own runtime. | Server inside the extension host (agent ignored). Per-platform `pkg` binary (pre-1.3.0; Node 14, binaries outside git, never stopped). |
| Patch `WebSocket`/`fetch` in injected JavaScript | MTProto connections bypass the local server otherwise. | Proxy only the page requests (messaging would be unproxied). |
| Keep serving the live Telegram Web K | Always current; no vendoring. | Bundle Telegram Web K locally: GPL-3.0 vs this extension's MIT license, manual updates, and passkeys would still fail because the origin is still not Telegram's. |
| Reverse proxy + web client | Small code base. | Native client on TDLib with a custom UI: native proxy support (including MTProto proxies), QR login, media played from local files, but a full UI rewrite and a dedicated `api_id`. |
| Configurable base port (default 49152) with deterministic fallback to the next 9 ports | The origin, and with it the Telegram login, stays stable between starts, while a port used by another program does not block the extension. | Random port: the origin would change and the login would be lost every start. |

## Known limitations and root causes

- **No passkeys.** Telegram Web calls `navigator.credentials.get` with Telegram's relying party ID while the page origin is `http://localhost:<port>`; WebAuthn binds credentials to the origin's domain. VS Code's webview iframes also grant only `cross-origin-isolated; autoplay; local-network-access; clipboard-read; clipboard-write`, without `publickey-credentials-get`.
- **No voice recording.** The webview iframe policy has no `microphone` permission.
- **Audio/video playback problems (unconfirmed cause).** VS Code 1.146's bundled ffmpeg has AAC, H.264, MP3, Opus, Vorbis and FLAC decoders, so codecs are unlikely. Telegram Web streams media through its service worker (`stream/` URLs), and that service worker runs in a third-party iframe nested in the webview (partitioned storage). This is the most likely cause, but it is a hypothesis. Diagnostic steps are in [troubleshooting.md](troubleshooting.md).
- **Content-Security-Policy.** Telegram Web ships a `<meta http-equiv="Content-Security-Policy">` without `connect-src` or `script-src`. If Telegram adds a `connect-src` restriction, the rerouted connections to `http://localhost:<port>` would be blocked and messaging would break.
- **Unpatched channels.** `XMLHttpRequest`, `EventSource` and `fetch(new Request(...))` are not rewritten; Telegram Web K is not known to use them for `*.web.telegram.org`.
- **One server per port.** Only one window's server serves on a port; its proxy settings apply to all windows sharing it.
- **One login per port.** Each port is a separate origin, so a fallback port or a changed `telegram-vscode.server.port` needs a new login.
- **Only `web.telegram.org/k/`.** Other Telegram Web versions (`/a/`) are not mapped.
- **Untested proxy types.** HTTP, HTTPS and SOCKS4 were not tested against a real proxy (unit-tested URL building only). SOCKS5 was verified end to end on macOS with VS Code 1.146 (Extension Development Host): the sidebar shows the QR login screen, every WebSocket from the webview is tunnelled through the proxy, no VS Code process connects to Telegram directly, and the server exits with the window.
