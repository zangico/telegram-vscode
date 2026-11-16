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

// Telegram Web K names the session after the browser user agent unless the user set a device name in its
// settings. Its MTProto worker builds that name in a single expression, which server.js rewrites as it serves
// the script, so the session reads "telegram-vscode" while a name chosen in Telegram still wins.
const DEVICE_MODEL = /deviceModel:this\.customDeviceModel\|\|/;
const nameSession = (source) => source.replace(DEVICE_MODEL, '$&"telegram-vscode"||');

module.exports = {
    rerouteTelegramTraffic,
    nameSession,
    PATCH: `(${rerouteTelegramTraffic})(self);\n`,
};
