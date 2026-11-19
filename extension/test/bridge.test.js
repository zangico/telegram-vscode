const test = require('node:test');
const assert = require('node:assert');
const { bridgeToExtension, PATCH } = require('../src/patch');

function fakeScope({ framed = true } = {}) {
    const posted = [];
    const scope = { navigator: {} };
    scope.parent = framed ? { postMessage: (message, origin) => posted.push([message, origin]) } : scope;
    return { scope, posted };
}

test('bridgeToExtension does nothing outside a frame or in a worker', () => {
    const { scope, posted } = fakeScope({ framed: false });
    bridgeToExtension(scope);
    assert.strictEqual(scope.Notification, undefined);
    assert.strictEqual(scope.navigator.setAppBadge, undefined);
    const worker = { navigator: {} };
    bridgeToExtension(worker);
    assert.strictEqual(worker.Notification, undefined);
    assert.deepStrictEqual(posted, []);
});

test('the app badge count is posted as the unread count', async () => {
    const { scope, posted } = fakeScope();
    bridgeToExtension(scope);
    await scope.navigator.setAppBadge(4);
    await scope.navigator.setAppBadge(0);
    await scope.navigator.setAppBadge();
    await scope.navigator.setAppBadge(-1);
    await scope.navigator.setAppBadge(2);
    await scope.navigator.clearAppBadge();
    assert.deepStrictEqual(posted.map(([message]) => message.count), [4, 0, 0, 0, 2, 0]);
    assert.ok(posted.every(([message, origin]) => message.source === 'telegram-vscode' && message.type === 'unread' && origin === '*'));
});

test('the Notification stand-in is granted and posts the notification', async () => {
    const { scope, posted } = fakeScope();
    bridgeToExtension(scope);
    bridgeToExtension(scope); // second call is a no-op
    const { Notification } = scope;
    assert.strictEqual(Notification.permission, 'granted');
    assert.strictEqual(await Notification.requestPermission(), 'granted');
    let callbackValue;
    await Notification.requestPermission((value) => { callbackValue = value; });
    assert.strictEqual(callbackValue, 'granted');

    const notification = new Notification('Alice', { body: 'hello' });
    new Notification('Bob');
    notification.onclick = () => {};
    notification.close();
    assert.deepStrictEqual(posted.map(([message]) => message), [
        { source: 'telegram-vscode', type: 'notify', title: 'Alice', body: 'hello' },
        { source: 'telegram-vscode', type: 'notify', title: 'Bob', body: undefined },
    ]);
});

test('PATCH is self-contained source for both functions', () => {
    assert.match(PATCH, /^\(function rerouteTelegramTraffic[\s\S]*\)\(self\);\n\(function bridgeToExtension[\s\S]*\)\(self\);\n$/);
});
