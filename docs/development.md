# Development

## Prerequisites

- Node.js 20 or newer (matches `@types/node` 20.x).
- VS Code 1.91 or newer (`engines.vscode: ^1.91.0`).
- npm.

The code is plain JavaScript (CommonJS) with no build step: what is in `extension/src/` is what ships.

## Setup

```sh
cd extension
npm ci
```

Runtime dependencies: `http-proxy-middleware` (2.x), `https-proxy-agent`, `socks-proxy-agent`. They are shipped in the `.vsix` (`node_modules/` is not in `.vscodeignore`; only `test/**` is excluded).

## Running in an Extension Development Host

```sh
code --extensionDevelopmentPath=<abs path>/extension
```

There is no `.vscode/launch.json` in the repository, so F5 is not preconfigured. If you add a launch config locally, use an `extensionHost` configuration with `--extensionDevelopmentPath=${workspaceFolder}/extension`.

Other VS Code windows running the extension do not need to be closed: if port `49152` is taken, the server in the new window shares the other window's server or falls back to the next port (see [configuration.md](configuration.md)). Each port has its own Telegram login.

## Tests

```sh
cd extension
npm test        # node --test
```

`extension/test/proxy.test.js` (node:test, no VS Code needed) covers:

- `buildProxyUrl`: type-to-scheme mapping (`socks5h`, `socks4a`, `http`, `https`), `none` and empty settings give `null`, host trimming, IPv6 in brackets, credential percent-encoding, rejection of unknown types, empty/injected/unbracketed hosts and bad ports.
- `rerouteTelegramTraffic`: `WebSocket` and `fetch` URLs for `*.web.telegram.org` are rewritten to `/__tg/<sub>/...` on the local host, other URLs are untouched, and calling it twice does not wrap twice.

`extension/test/server.test.js` forks the real `server.js` with `{ proxyUrl: null, port }` on a random base port:

- A foreign HTTP server on the base port: the server replies `{ ready: base + 1 }`.
- A second instance with the same base port also replies `{ ready: base + 1 }` (shared port); after the first is killed, the second takes the port over within about 3 s.
- With all 10 candidate ports blocked, the server replies with `{ error }` ("No usable port ...").

These tests open loopback ports, so they need permission to listen on `127.0.0.1` (a sandbox that blocks listening makes them fail).

Not covered by tests: the proxying itself in `server.js`, `extension.js`, real proxies, VS Code integration. The listed devDependencies `@vscode/test-cli`, `@vscode/test-electron`, `eslint`, `typescript` and `@types/mocha` are installed but not used by any script or config in the repository.

## Running the server standalone

Useful to check proxy behaviour without VS Code. Save as a scratch file outside the repo (for example `run-server.js`):

```js
const { fork } = require('child_process');
const child = fork('<abs path>/extension/src/server.js', [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
child.on('message', (m) => console.log('message from server:', m));
// null = direct connection; or e.g. 'socks5h://127.0.0.1:1080'
child.send({ proxyUrl: null, port: 49152 });
```

The server answers with `{ ready: <port> }` (the port it actually uses, which may be above 49152) or `{ error }`. Run it with `node run-server.js`. The server exits when the IPC channel closes, so keep this process running. Then, from another terminal:

```sh
curl -i http://127.0.0.1:49152/                       # Telegram Web K index, no X-Frame-Options
curl -s http://127.0.0.1:49152/ | grep -o '<script[^>]*src="[^"]*"' | head   # find a script URL
curl -s http://127.0.0.1:49152/<script path> | head -c 300   # starts with the patch text
```

WebSocket handshake through the `/__tg/` route (a `101 Switching Protocols` response means the route and, if configured, the proxy work):

```sh
curl -i --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Sec-WebSocket-Protocol: binary' \
  http://127.0.0.1:49152/__tg/kws2/apiws
```

Equivalent in Node 22+: `new WebSocket('ws://127.0.0.1:49152/__tg/kws2/apiws')`.

To confirm a proxy is used, point `proxyUrl` at it and watch its log; with an unreachable proxy the requests must fail (HTTP 500), not succeed directly.

## Debugging

- Output channel: View > Output, select **Telegram-VSCode**. It shows the server's stdout/stderr (listening line, port notices, proxy errors at `logLevel: 'warn'`) and "Server stopped (...)" on exit.
- Webview: Command Palette, **Developer: Open Webview Developer Tools** (use it with the Telegram view focused). Check the Console, the Network tab (rewritten requests to `localhost:49152/__tg/...`) and Application > Service Workers.
- Extension host log: **Developer: Show Logs...** > Extension Host.

## Packaging and publishing

```sh
cd extension
npx @vscode/vsce package      # produces telegram-vscode-<version>.vsix
npx @vscode/vsce publish      # needs a Marketplace token for publisher livingasync
```

Install a local build with `code --install-extension telegram-vscode-<version>.vsix`. `*.vsix` is git-ignored.

## Release checklist

1. Bump `version` in `extension/package.json`.
2. Add release notes (`### x.y.z`) to `extension/README.md`.
3. Make sure `extension/package-lock.json` is up to date and committed (`npm install`, then commit).
4. `cd extension && npm ci && npm test`.
5. Smoke test in an Extension Development Host: sidebar loads, tab command works, proxy settings apply.
6. `npx @vscode/vsce package` and inspect the file list.
7. Commit, push to `master`, then tag and push the tag: `git tag v<version> && git push origin v<version>`.

Pushing a `v*` tag runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml). The workflow checks that the tag matches `version` in `package.json`, runs `npm ci` and `npm test`, then runs `vsce publish --oidc`. Publishing uses the Marketplace's Trusted Publishing, so no access token is stored in the repository. The `livingasync` publisher has a Trusted Publishing policy that allows the `zangico/telegram-vscode` repository and the `publish.yml` workflow, with no GitHub environment. If the workflow file is renamed or the repository moves, update that policy on the Marketplace publisher page, or publishing fails at the token exchange.

## Code conventions

- CommonJS (`require`/`module.exports`), plain JavaScript, no transpilation or bundler.
- 4-space indentation, single quotes, semicolons.
- `src/patch.js` must stay self-contained: `rerouteTelegramTraffic` is serialized with `Function.prototype.toString` (via template string) and runs in a browser scope, so it must not reference anything outside its own body.
- `src/proxyUrl.js` and `src/patch.js` do not import `vscode`, so they can be unit-tested with plain `node --test`.
- Comments explain why, not what.
- Errors in proxy configuration must fail closed (no server), never fall back to a direct connection.
