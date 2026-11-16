const test = require('node:test');
const assert = require('node:assert');
const { buildProxyUrl } = require('../src/proxyUrl');
const { rerouteTelegramTraffic, nameSession } = require('../src/patch');

test('buildProxyUrl maps settings to proxy URLs', () => {
    assert.strictEqual(buildProxyUrl({ type: 'none' }), null);
    assert.strictEqual(buildProxyUrl({}), null);
    assert.strictEqual(buildProxyUrl({ type: 'socks5', host: '127.0.0.1', port: 1080 }), 'socks5h://127.0.0.1:1080');
    assert.strictEqual(buildProxyUrl({ type: 'socks4', host: 'proxy.lan', port: 1080 }), 'socks4a://proxy.lan:1080');
    assert.strictEqual(buildProxyUrl({ type: 'http', host: ' proxy.lan ', port: 3128 }), 'http://proxy.lan:3128/');
    assert.strictEqual(buildProxyUrl({ type: 'https', host: '[::1]', port: 443 }), 'https://[::1]/');
    assert.strictEqual(
        buildProxyUrl({ type: 'http', host: 'proxy.lan', port: 8080, username: 'me@x' }, 'p:ss/word'),
        'http://me%40x:p%3Ass%2Fword@proxy.lan:8080/'
    );
});

test('buildProxyUrl rejects invalid settings', () => {
    assert.throws(() => buildProxyUrl({ type: 'ftp', host: 'a', port: 1 }), /Unknown proxy type/);
    assert.throws(() => buildProxyUrl({ type: 'http', host: '', port: 80 }), /Invalid proxy host/);
    assert.throws(() => buildProxyUrl({ type: 'http', host: 'evil.com/x@a', port: 80 }), /Invalid proxy host/);
    assert.throws(() => buildProxyUrl({ type: 'http', host: '::1', port: 80 }), /Invalid proxy host/);
    assert.throws(() => buildProxyUrl({ type: 'http', host: 'a', port: null }), /port/);
    assert.throws(() => buildProxyUrl({ type: 'http', host: 'a', port: 70000 }), /port/);
});

test('rerouteTelegramTraffic sends Telegram connections to the local server', () => {
    const opened = [];
    const fetched = [];
    const scope = {
        location: { host: 'localhost:49152' },
        WebSocket: class { constructor(url) { opened.push(url); } },
        fetch(url) { fetched.push(url); },
    };
    rerouteTelegramTraffic(scope);
    rerouteTelegramTraffic(scope); // second call must not wrap twice

    new scope.WebSocket('wss://kws2-1.web.telegram.org/apiws', 'binary');
    new scope.WebSocket('wss://example.com/socket');
    scope.fetch('https://kws4.web.telegram.org/apiw1?x=1');
    scope.fetch(new URL('https://web.telegram.org/k/'));

    assert.deepStrictEqual(opened, ['ws://localhost:49152/__tg/kws2-1/apiws', 'wss://example.com/socket']);
    assert.deepStrictEqual(fetched, ['http://localhost:49152/__tg/kws4/apiw1?x=1', 'https://web.telegram.org/k/']);
});

test('nameSession names the Web K session unless the user chose a name', () => {
    const worker = 'getInitConnectionParams:()=>({id:a.id,deviceModel:this.customDeviceModel||Pi().USER_AGENT||`Unknown UserAgent`,';
    assert.strictEqual(
        nameSession(worker),
        'getInitConnectionParams:()=>({id:a.id,deviceModel:this.customDeviceModel||"telegram-vscode"||Pi().USER_AGENT||`Unknown UserAgent`,'
    );
    assert.strictEqual(nameSession('this.customDeviceModel=``'), 'this.customDeviceModel=``');
});
