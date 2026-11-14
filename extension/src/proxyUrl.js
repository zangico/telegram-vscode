// Remote DNS variants: the proxy resolves Telegram host names, so local DNS filtering does not apply.
const SCHEMES = { http: 'http', https: 'https', socks4: 'socks4a', socks5: 'socks5h' };
const HOST = /^([a-z0-9-]+\.)*[a-z0-9-]+$|^\[[0-9a-f:.]+\]$/i;

// Returns the proxy URL for the given settings, null for a direct connection, or throws on invalid settings.
function buildProxyUrl({ type, host, port, username }, password) {
    if (!type || type === 'none') return null;
    const scheme = SCHEMES[type];
    if (!scheme) throw new Error(`Unknown proxy type "${type}"`);
    host = (host || '').trim();
    if (!HOST.test(host)) throw new Error(`Invalid proxy host "${host}" (IPv6 addresses go in square brackets)`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Proxy port must be a number between 1 and 65535');

    const url = new URL(`${scheme}://${host}:${port}`);
    if (username) {
        url.username = username;
        url.password = password || '';
    }
    return url.href;
}

module.exports = { buildProxyUrl };
