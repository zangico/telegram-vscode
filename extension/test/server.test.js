const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { fork } = require('child_process');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');

function startServer(port) {
    const child = fork(SERVER, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const reply = new Promise((resolve) => child.once('message', resolve));
    child.send({ proxyUrl: null, port });
    return { child, reply };
}

function listen(server, port) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
}

test('server skips ports held by other programs and shares ports held by itself', async (t) => {
    const base = 40000 + Math.floor(Math.random() * 20000);
    const foreign = http.createServer((req, res) => res.end('not telegram-vscode'));
    await listen(foreign, base);
    t.after(() => foreign.close());

    const first = startServer(base);
    t.after(() => first.child.kill());
    assert.deepStrictEqual(await first.reply, { ready: base + 1 });

    const second = startServer(base);
    t.after(() => second.child.kill());
    assert.deepStrictEqual(await second.reply, { ready: base + 1 });

    // When the first window's server goes away, the second one takes the port over.
    first.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const body = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${base + 1}/__telegram-vscode/ping`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
    assert.strictEqual(body, 'telegram-sidebar');
});

test('server reports an error when every candidate port is taken', async (t) => {
    const base = 40000 + Math.floor(Math.random() * 20000);
    const blockers = [];
    for (let port = base; port < base + 10; port++) {
        const blocker = http.createServer((req, res) => res.end());
        await listen(blocker, port);
        blockers.push(blocker);
    }
    t.after(() => blockers.forEach((blocker) => blocker.close()));

    const server = startServer(base);
    t.after(() => server.child.kill());
    assert.match((await server.reply).error, /No usable port/);
});
