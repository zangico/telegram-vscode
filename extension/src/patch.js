// Telegram Web opens its MTProto connections (WebSocket, HTTP fallback) from the page, its workers
// and its service worker straight to *.web.telegram.org. server.js prepends this function to every
// script it serves, so those connections reach the local server and follow the configured proxy.
function rerouteTelegramTraffic(scope) {
    if (scope.__telegramVscodeReroute) return;
    scope.__telegramVscodeReroute = true;

    const remote = /^(wss|https):\/\/([a-z0-9-]+)\.web\.telegram\.org\//;
    const toLocal = (url) => {
        const match = remote.exec(url);
        if (!match) return url;
        const protocol = match[1] === 'wss' ? 'ws' : 'http';
        return `${protocol}://${scope.location.host}/__tg/${match[2]}/${url.slice(match[0].length)}`;
    };

    if (scope.WebSocket) {
        scope.WebSocket = new Proxy(scope.WebSocket, {
            construct: (Target, [url, ...rest]) => new Target(toLocal(String(url)), ...rest),
        });
    }
    if (scope.fetch) {
        const fetch = scope.fetch;
        scope.fetch = (input, init) => fetch.call(
            scope,
            typeof input === 'string' || input instanceof URL ? toLocal(String(input)) : input,
            init
        );
    }
}

// Runs in the page only (inside the extension's webview iframe; workers have no parent). The webview forwards
// these messages to the extension: the unread count Telegram Web K hands to the Badging API, and notifications
// through a stand-in for the Notification API, so Telegram believes they are allowed.
function bridgeToExtension(scope) {
    if (!scope.parent || scope.parent === scope || scope.__telegramVscodeBridge) return;
    scope.__telegramVscodeBridge = true;

    const post = (message) => scope.parent.postMessage({ source: 'telegram-vscode', ...message }, '*');

    function Notification(title, options) {
        post({ type: 'notify', title: String(title), body: options?.body });
        return Object.assign(new EventTarget(), { close() {}, onclick: null, onclose: null, onerror: null, onshow: null });
    }
    Notification.permission = 'granted';
    Notification.requestPermission = (callback) => {
        if (typeof callback === 'function') callback('granted');
        return Promise.resolve('granted');
    };
    scope.Notification = Notification;

    // Web K calls navigator.setAppBadge with the number of unread unmuted chats.
    scope.navigator.setAppBadge = (count) => {
        const value = Number(count ?? 0);
        post({ type: 'unread', count: Number.isInteger(value) && value > 0 ? value : 0 });
        return Promise.resolve();
    };
    scope.navigator.clearAppBadge = () => scope.navigator.setAppBadge(0);
}

// Telegram Web K names the session after the browser user agent unless the user set a device name in its
// settings. Its MTProto worker builds that name in a single expression, which server.js rewrites as it serves
// the script, so the session reads "telegram-vscode" while a name chosen in Telegram still wins.
const DEVICE_MODEL = /deviceModel:this\.customDeviceModel\|\|/;
const nameSession = (source) => source.replace(DEVICE_MODEL, '$&"telegram-vscode"||');

module.exports = {
    rerouteTelegramTraffic,
    bridgeToExtension,
    nameSession,
    PATCH: `(${rerouteTelegramTraffic})(self);\n(${bridgeToExtension})(self);\n`,
};
