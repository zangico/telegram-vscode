const vscode = require('vscode');
const { fork } = require('child_process');
const path = require('path');
const { buildProxyUrl } = require('./proxyUrl');

const SECTION = 'telegram-vscode';
const PASSWORD_KEY = 'telegram-vscode.proxy.password';

const logger = vscode.window.createOutputChannel('Telegram-VSCode');
let server;
let startRequest = 0;
// Port the webviews point at; set by the server once something answers on it.
let serverPort;
const webviews = new Set();

async function startServer(secrets) {
    const request = ++startRequest;
    const settings = vscode.workspace.getConfiguration(SECTION);
    const password = await secrets.get(PASSWORD_KEY);
    if (request !== startRequest) return; // a newer restart is already under way
    // Wait for the old server to release the port, or the new one would see it busy and move to the next port.
    await stopServer();
    if (request !== startRequest) return;

    const port = settings.get('server.port');
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        logger.appendLine(`Invalid server port ${port}, server not started`);
        vscode.window.showErrorMessage('Telegram: "telegram-vscode.server.port" must be a number between 1024 and 65535.');
        return;
    }
    let proxyUrl;
    try {
        proxyUrl = buildProxyUrl(
            {
                type: settings.get('proxy.type'),
                host: settings.get('proxy.host'),
                port: settings.get('proxy.port'),
                username: settings.get('proxy.username'),
            },
            password
        );
    } catch (error) {
        // A proxy was requested: never fall back to a direct connection.
        logger.appendLine(`Proxy settings are invalid, server not started: ${error.message}`);
        vscode.window.showErrorMessage(`Telegram: ${error.message}. Fix the "telegram-vscode.proxy" settings.`);
        return;
    }

    // Plain Node child process: VS Code's own proxy handling in the extension host would replace our agent.
    const child = fork(path.join(__dirname, 'server.js'), [], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.stdout.on('data', (data) => logger.append(data.toString()));
    child.stderr.on('data', (data) => logger.append(data.toString()));
    child.on('error', (error) => logger.appendLine(`Server process error: ${error.message}`));
    child.on('message', (message) => {
        if (child !== server) return; // late message from a server that was replaced
        if (message.ready) setServerPort(message.ready);
        if (message.error) vscode.window.showErrorMessage(`Telegram: ${message.error}. Change "telegram-vscode.server.port".`);
    });
    child.on('exit', (code, signal) => logger.appendLine(`Server stopped (${signal || `exit code ${code}`})`));
    child.send({ proxyUrl, port });
    server = child;
}

function stopServer() {
    const child = server;
    server = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill();
    });
}

function setServerPort(port) {
    if (port === serverPort) return;
    serverPort = port;
    for (const webview of webviews) webview.html = getWebviewContent(port);
}

function showTelegram(webview, onDidDispose) {
    webviews.add(webview);
    onDidDispose(() => webviews.delete(webview));
    if (serverPort) webview.html = getWebviewContent(serverPort);
}

async function setProxyPassword(secrets) {
    const password = await vscode.window.showInputBox({
        title: 'Telegram proxy password',
        prompt: 'Stored in the operating system keychain. Leave empty to remove it.',
        password: true,
        ignoreFocusOut: true,
    });
    if (password === undefined) return;
    if (password) await secrets.store(PASSWORD_KEY, password);
    else await secrets.delete(PASSWORD_KEY);
}

function activate(context) {
    const { secrets } = context;

    context.subscriptions.push(
        logger,
        { dispose: stopServer },
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(SECTION)) startServer(secrets);
        }),
        secrets.onDidChange((event) => {
            if (event.key === PASSWORD_KEY) startServer(secrets);
        }),
        vscode.commands.registerCommand('telegram-vscode.setProxyPassword', () => setProxyPassword(secrets)),
        vscode.commands.registerCommand('telegram-vscode.openTelegramWeb', () => {
            const panel = vscode.window.createWebviewPanel(
                'telegramWebviewTab',
                'Telegram',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );
            showTelegram(panel.webview, (listener) => panel.onDidDispose(listener));
        }),
        vscode.window.registerWebviewViewProvider(
            'telegramWebview',
            {
                resolveWebviewView(webviewView) {
                    webviewView.webview.options = { enableScripts: true };
                    showTelegram(webviewView.webview, (listener) => webviewView.onDidDispose(listener));
                }
            },
            // Keep Telegram running (and playing media) while the sidebar is hidden.
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    startServer(secrets);
}

function getWebviewContent(port) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Telegram Web</title>
            <style>
                body, html {
                    margin: 0;
                    padding: 0;
                    height: 100%;
                    width: 100%;
                    overflow: hidden;
                }
                iframe {
                    border: none;
                    height: 100%;
                    width: 100%;
                }
            </style>
        </head>
        <body>
            <iframe src="http://localhost:${port}"></iframe>
        </body>
        </html>
    `;
}

function deactivate() {
    return stopServer();
}

module.exports = {
    activate,
    deactivate
};
