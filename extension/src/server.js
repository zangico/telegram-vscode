// Local reverse proxy for Telegram Web K. Runs as a child process of the extension
// (see extension.js), receives its configuration over IPC ({ proxyUrl, port }) and answers
// { ready: <port> } once a server answers on that port, or { error } when no port is usable.
const http = require('http');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { PATCH, nameSession } = require('./patch');

const HOST = '127.0.0.1';
const PORT_ATTEMPTS = 10;
const PING_PATH = '/__telegram-vscode/ping';
const PING_REPLY = 'telegram-sidebar';
const UPSTREAM = 'https://web.telegram.org';
const ORIGIN = 'https://web.telegram.org';
// /__tg/<subdomain>/<path> -> https://<subdomain>.web.telegram.org/<path> (rewritten by patch.js)
const DC_PATH = /^\/__tg\/([a-z0-9-]+)(\/.*)?$/;

function createAgent(proxyUrl) {
    if (!proxyUrl) return undefined;
    const url = new URL(proxyUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') return new HttpsProxyAgent(url);
    if (url.protocol.startsWith('socks')) return new SocksProxyAgent(url);
    throw new Error(`Unsupported proxy protocol: ${url.protocol}`);
}

function describe(proxyUrl) {
    if (!proxyUrl) return 'direct connection';
    const url = new URL(proxyUrl);
    return `${url.protocol}//${url.host}${url.username ? ' (with credentials)' : ''}`;
}

function createServer(proxyUrl) {
    const agent = createAgent(proxyUrl);

    // Headers go in through options: proxy agents connect asynchronously, so onProxyReq would fire after they are sent.
    const proxy = createProxyMiddleware({
        target: UPSTREAM,
        changeOrigin: true,
        ws: true,
        agent,
        headers: { origin: ORIGIN },
        logLevel: 'warn',
        selfHandleResponse: true,
        router: (req) => {
            const match = DC_PATH.exec(req.url);
            return match ? `https://${match[1]}.web.telegram.org` : undefined;
        },
        pathRewrite: (path) => {
            const match = DC_PATH.exec(path);
            return match ? match[2] || '/' : '/k' + path;
        },
        onProxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
            res.removeHeader('x-frame-options');
            const isScript = /javascript/.test(proxyRes.headers['content-type'] || '');
            if (!isScript || proxyRes.statusCode !== 200) return buffer;
            res.removeHeader('etag');
            res.removeHeader('last-modified');
            const script = Buffer.concat([Buffer.from(PATCH), buffer]);
            return buffer.includes('customDeviceModel') ? Buffer.from(nameSession(script.toString())) : script;
        }),
    });

    const server = http.createServer((req, res) => {
        if (req.url === PING_PATH) return res.end(PING_REPLY);
        // Always get a full body back, so cached copies made before patching are never revalidated as-is.
        delete req.headers['if-none-match'];
        delete req.headers['if-modified-since'];
        proxy(req, res, () => {
            res.statusCode = 404;
            res.end();
        });
    });
    server.on('upgrade', proxy.upgrade);
    return server;
}

// Resolves true once listening, false if the port is taken (EADDRINUSE) or reserved by the OS (EACCES).
function listenOn(server, port) {
    return new Promise((resolve) => {
        const onError = (error) => {
            if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') {
                console.error(`Server error: ${error.message}`);
                process.exit(1);
            }
            resolve(false);
        };
        server.once('error', onError);
        server.listen(port, HOST, () => {
            server.off('error', onError);
            resolve(true);
        });
    });
}

// True when the port is held by this extension's server from another VS Code window.
function isOurServer(port) {
    return new Promise((resolve) => {
        const req = http.get({ host: HOST, port, path: PING_PATH, timeout: 1000 }, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve(body === PING_REPLY));
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(false));
    });
}

// Tries basePort, then the next ports. Each port is its own origin, so Telegram keeps a separate login per port.
async function bind(server, basePort, proxyUrl) {
    for (let port = basePort; port < basePort + PORT_ATTEMPTS && port <= 65535; port++) {
        if (await listenOn(server, port)) {
            console.log(`Listening on http://${HOST}:${port} via ${describe(proxyUrl)}`);
            process.send?.({ ready: port });
            return;
        }
        if (await isOurServer(port)) {
            console.log(`Port ${port} is served by another VS Code window; taking over when it is released`);
            process.send?.({ ready: port });
            setTimeout(() => takeOver(server, port, basePort, proxyUrl), 2000);
            return;
        }
        console.log(`Port ${port} is used by another program, trying the next one`);
    }
    const error = `No usable port between ${basePort} and ${basePort + PORT_ATTEMPTS - 1}`;
    console.error(error);
    process.send?.({ error });
}

async function takeOver(server, port, basePort, proxyUrl) {
    if (await listenOn(server, port)) {
        console.log(`Took over http://${HOST}:${port} via ${describe(proxyUrl)}`);
    } else if (await isOurServer(port)) {
        setTimeout(() => takeOver(server, port, basePort, proxyUrl), 2000);
    } else {
        // The other window closed and another program grabbed the port: pick a port again.
        await bind(server, basePort, proxyUrl);
    }
}

process.once('message', ({ proxyUrl, port }) => {
    const fail = (error) => {
        console.error(`Cannot start server: ${error.message}`);
        process.exit(1);
    };
    try {
        bind(createServer(proxyUrl), port, proxyUrl).catch(fail);
    } catch (error) {
        fail(error);
    }
});
// The extension host went away: do not outlive it.
process.on('disconnect', () => process.exit(0));
