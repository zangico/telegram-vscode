const test = require('node:test');
const assert = require('node:assert');
const { migrateSettings } = require('../src/migrateSettings');

function fakeConfiguration(values) {
    const written = [];
    return {
        values,
        written,
        inspect: (key) => ({ globalValue: values[key] }),
        update: async (key, value, target) => {
            written.push([key, value, target]);
            values[key] = value;
        },
    };
}

test('old values fill the new names that are still unset and are removed', async () => {
    const configuration = fakeConfiguration({
        'telegram-vscode.proxy.type': 'socks5',
        'telegram-vscode.proxy.port': 1080,
        'telegram-vscode.zoom': 120,
        'telegram-sidebar.zoom': 90,
        'telegram-vscode.notifications.enabled': false,
    });
    await migrateSettings(configuration, [
        'telegram-sidebar.proxy.type',
        'telegram-sidebar.proxy.port',
        'telegram-sidebar.proxy.host',
        'telegram-sidebar.zoom',
        'telegram-sidebar.notifications.enabled',
    ], 1);
    assert.deepStrictEqual(configuration.written, [
        ['telegram-sidebar.proxy.type', 'socks5', 1],
        ['telegram-vscode.proxy.type', undefined, 1],
        ['telegram-sidebar.proxy.port', 1080, 1],
        ['telegram-vscode.proxy.port', undefined, 1],
        ['telegram-vscode.zoom', undefined, 1],
        ['telegram-sidebar.notifications.enabled', false, 1],
        ['telegram-vscode.notifications.enabled', undefined, 1],
    ]);
    assert.strictEqual(configuration.values['telegram-sidebar.zoom'], 90);
});

test('nothing is written without old values', async () => {
    const configuration = fakeConfiguration({});
    await migrateSettings(configuration, ['telegram-sidebar.zoom', 'other.key'], 1);
    assert.deepStrictEqual(configuration.written, []);
});
