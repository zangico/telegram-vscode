const vscode = require('vscode');
const { fork } = require('child_process');
const path = require('path');
const { buildProxyUrl } = require('./proxyUrl');
const { migrateSettings } = require('./migrateSettings');

const SECTION = 'telegram-sidebar';
const PASSWORD_KEY = 'telegram-vscode.proxy.password';
const DND_KEY = 'telegram-vscode.doNotDisturb';

const logger = vscode.window.createOutputChannel('Telegram-VSCode');
let server;
let startRequest = 0;
// Port the webviews point at; set by the server once something answers on it.
let serverPort;
const webviews = new Set();
// Unread chats as last reported by the page (Telegram counts unmuted chats only).
let unread = 0;
let sidebarView;
let globalState;
let unreadItem;
let dndItem;

const config = () => vscode.workspace.getConfiguration(SECTION);

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
        vscode.window.showErrorMessage('Telegram: "telegram-sidebar.server.port" must be a number between 1024 and 65535.');
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
        vscode.window.showErrorMessage(`Telegram: ${error.message}. Fix the "telegram-sidebar.proxy" settings.`);
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
        if (message.error) vscode.window.showErrorMessage(`Telegram: ${message.error}. Change "telegram-sidebar.server.port".`);
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
    refreshWebviews();
}

function refreshWebviews() {
    if (!serverPort) return;
    for (const webview of webviews) webview.html = getWebviewContent(serverPort);
}

function showTelegram(webview, onDidDispose) {
    webviews.add(webview);
    onDidDispose(() => webviews.delete(webview));
    webview.onDidReceiveMessage(handleMessage);
    if (serverPort) webview.html = getWebviewContent(serverPort);
}

const doNotDisturb = () => globalState.get(DND_KEY, false);

function updateIndicators() {
    if (sidebarView) {
        sidebarView.badge = unread ? { value: unread, tooltip: `${unread} unread chat${unread === 1 ? '' : 's'}` } : undefined;
    }
    const show = config().get('statusBar.enabled');
    unreadItem.text = `$(send) ${unread}`;
    unreadItem.tooltip = `${unread} unread Telegram chat${unread === 1 ? '' : 's'}`;
    if (show && unread) unreadItem.show();
    else unreadItem.hide();
    if (show && doNotDisturb()) dndItem.show();
    else dndItem.hide();
}

// Messages come from a page that talks to a third-party site: check every field.
function handleMessage(message) {
    if (!message || message.source !== 'telegram-vscode') return;
    if (message.type === 'unread' && Number.isInteger(message.count) && message.count >= 0) {
        unread = message.count;
        updateIndicators();
    } else if (message.type === 'notify' && typeof message.title === 'string') {
        notify(message.title, typeof message.body === 'string' ? message.body : '');
    }
}

function notify(title, body) {
    const settings = config();
    if (!settings.get('notifications.enabled') || doNotDisturb()) return;
    if (settings.get('notifications.muteWhileDebugging') && vscode.debug.activeDebugSession) return;
    const text = `Telegram: ${title}${settings.get('notifications.showPreview') && body ? ` - ${body}` : ''}`;
    vscode.window.showInformationMessage(text, 'Open').then((choice) => {
        if (choice === 'Open') vscode.commands.executeCommand('telegramWebview.focus');
    });
}

async function sendSelection() {
    const editor = vscode.window.activeTextEditor;
    const text = editor && editor.document.getText(editor.selection);
    if (!text) return;
    await vscode.env.clipboard.writeText(`\`\`\`\n${text}\n\`\`\``);
    vscode.commands.executeCommand('telegramWebview.focus');
    vscode.window.setStatusBarMessage('Copied: paste it into a chat', 4000);
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

async function activate(context) {
    const { secrets } = context;
    globalState = context.globalState;
    try {
        const keys = Object.keys(context.extension.packageJSON.contributes.configuration.properties);
        await migrateSettings(vscode.workspace.getConfiguration(), keys, vscode.ConfigurationTarget.Global);
    } catch (error) {
        logger.appendLine(`Could not move the old telegram-vscode.* settings: ${error.message}`);
    }
    unreadItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    unreadItem.name = 'Telegram unread chats';
    unreadItem.command = 'telegramWebview.focus';
    dndItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    dndItem.name = 'Telegram Do Not Disturb';
    dndItem.text = '$(bell-slash) $(send)';
    dndItem.tooltip = 'Telegram Do Not Disturb is on (click to turn it off)';
    dndItem.command = 'telegram-vscode.toggleDoNotDisturb';

    context.subscriptions.push(
        logger,
        unreadItem,
        dndItem,
        { dispose: stopServer },
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(`${SECTION}.server`) || event.affectsConfiguration(`${SECTION}.proxy`)) {
                startServer(secrets);
            }
            if (event.affectsConfiguration(`${SECTION}.zoom`)) refreshWebviews();
            if (event.affectsConfiguration(SECTION)) updateIndicators();
        }),
        secrets.onDidChange((event) => {
            if (event.key === PASSWORD_KEY) startServer(secrets);
        }),
        vscode.commands.registerCommand('telegram-vscode.setProxyPassword', () => setProxyPassword(secrets)),
        vscode.commands.registerCommand('telegram-vscode.openSettings', () =>
            vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)
        ),
        vscode.commands.registerCommand('telegram-vscode.buyMeACoffee', () =>
            vscode.env.openExternal(vscode.Uri.parse('https://buymeacoffee.com/zangico'))
        ),
        vscode.commands.registerCommand('telegram-vscode.toggleDoNotDisturb', async () => {
            await globalState.update(DND_KEY, !doNotDisturb());
            updateIndicators();
        }),
        vscode.commands.registerCommand('telegram-vscode.sendSelection', sendSelection),
        vscode.commands.registerCommand('telegram-vscode.toggle', () =>
            vscode.commands.executeCommand(sidebarView && sidebarView.visible ? 'workbench.action.closeSidebar' : 'telegramWebview.focus')
        ),
        vscode.commands.registerCommand('telegram-vscode.moveView', async () => {
            await vscode.commands.executeCommand('telegramWebview.focus');
            await vscode.commands.executeCommand('workbench.action.moveFocusedView');
        }),
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
                    sidebarView = webviewView;
                    webviewView.onDidDispose(() => { if (sidebarView === webviewView) sidebarView = undefined; });
                    updateIndicators();
                    showTelegram(webviewView.webview, (listener) => webviewView.onDidDispose(listener));
                }
            },
            // Keep Telegram running (and playing media) while the sidebar is hidden.
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    updateIndicators();
    startServer(secrets);
}

function getWebviewContent(port) {
    const zoom = config().get('zoom');
    const scale = Number.isInteger(zoom) && zoom >= 50 && zoom <= 200 ? zoom / 100 : 1;
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
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: ${100 / scale}%;
                    height: ${100 / scale}%;
                    transform: scale(${scale});
                    transform-origin: 0 0;
                }
            </style>
        </head>
        <body>
            <iframe src="http://localhost:${port}"></iframe>
            <script>
                const vscode = acquireVsCodeApi();
                const frame = document.querySelector('iframe');
                window.addEventListener('message', (event) => {
                    const data = event.data;
                    if (event.source !== frame.contentWindow || !data || data.source !== 'telegram-vscode') return;
                    vscode.postMessage(data);
                });
            </script>
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
