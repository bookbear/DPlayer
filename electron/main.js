'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');

// SharedArrayBuffer を有効にするため Chromium フラグを設定
// (COOP/COEP ヘッダーだけでは Electron 上で不十分な場合がある)
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');
const http = require('http');
const fs = require('fs');
const path = require('path');

// -----------------------------------------------------------------------
// Path resolution (dev vs packaged)
// -----------------------------------------------------------------------
const ROOT = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.resolve(__dirname, '..');

// -----------------------------------------------------------------------
// Static file server with COOP/COEP headers (required for SharedArrayBuffer)
// -----------------------------------------------------------------------
const ROUTES = {
    '/':                 { file: path.join(ROOT, 'demo/local-player.html'),  mime: 'text/html' },
    '/DPlayer.js':       { file: path.join(ROOT, 'dist/DPlayer.min.js'),     mime: 'application/javascript' },
    '/ffmpeg-core.js':   { file: path.join(ROOT, 'demo/ffmpeg-core.js'),     mime: 'application/javascript' },
    '/ffmpeg-core.wasm': { file: path.join(ROOT, 'demo/ffmpeg-core.wasm'),   mime: 'application/wasm' },
};

const STATIC_DIRS = [
    { prefix: '/ffmpeg/',      dir: path.join(ROOT, 'node_modules/@ffmpeg/ffmpeg/dist/esm') },
    { prefix: '/ffmpeg-util/', dir: path.join(ROOT, 'node_modules/@ffmpeg/util/dist/esm') },
];

const COOP_HEADERS = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
};

// Cache static assets in memory (wasm etc.)
const fileCache = new Map();
function readCached(filePath) {
    if (!fileCache.has(filePath)) {
        fileCache.set(filePath, fs.readFileSync(filePath));
    }
    return fileCache.get(filePath);
}

const MIME_EXT = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };

function createServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const urlPath = req.url.split('?')[0];

            // /media: streaming endpoint for local video files (supports range requests)
            if (urlPath === '/media') {
                const filePath = new URL(req.url, 'http://localhost').searchParams.get('path');
                if (!filePath || !fs.existsSync(filePath)) {
                    res.writeHead(404, COOP_HEADERS); res.end(); return;
                }
                const stat = fs.statSync(filePath);
                const range = req.headers.range;
                if (range) {
                    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
                    const start = parseInt(startStr, 10);
                    const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
                    res.writeHead(206, {
                        ...COOP_HEADERS,
                        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': end - start + 1,
                        'Content-Type': 'video/mp4',
                    });
                    fs.createReadStream(filePath, { start, end }).pipe(res);
                } else {
                    res.writeHead(200, {
                        ...COOP_HEADERS,
                        'Content-Length': stat.size,
                        'Content-Type': 'video/mp4',
                        'Accept-Ranges': 'bytes',
                    });
                    fs.createReadStream(filePath).pipe(res);
                }
                return;
            }

            // Exact routes (HTML, JS, WASM)
            if (ROUTES[urlPath]) {
                const { file, mime } = ROUTES[urlPath];
                try {
                    const data = readCached(file);
                    res.writeHead(200, { 'Content-Type': mime, ...COOP_HEADERS });
                    res.end(data);
                } catch {
                    res.writeHead(404, COOP_HEADERS); res.end('Not found');
                }
                return;
            }

            // Static directories (ffmpeg ESM modules)
            for (const { prefix, dir } of STATIC_DIRS) {
                if (urlPath.startsWith(prefix)) {
                    const file = path.join(dir, urlPath.slice(prefix.length));
                    const mime = MIME_EXT[path.extname(file)] || 'application/octet-stream';
                    try {
                        const data = readCached(file);
                        res.writeHead(200, { 'Content-Type': mime, ...COOP_HEADERS });
                        res.end(data);
                    } catch {
                        res.writeHead(404, COOP_HEADERS); res.end('Not found');
                    }
                    return;
                }
            }

            res.writeHead(404, COOP_HEADERS);
            res.end('Not found');
        });

        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

// -----------------------------------------------------------------------
// IPC handlers
// -----------------------------------------------------------------------
ipcMain.handle('read-file', (_, filePath) => fs.readFileSync(filePath));
ipcMain.handle('stat-file', (_, filePath) => fs.statSync(filePath).size);

// -----------------------------------------------------------------------
// Window
// -----------------------------------------------------------------------
let mainWindow = null;
let serverPort = null;

async function createWindow() {
    const server = await createServer();
    serverPort = server.address().port;

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 760,
        minWidth: 640,
        minHeight: 400,
        title: 'DPlayer',
        backgroundColor: '#0f0f0f',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

    // Send file path from argv after page loads
    mainWindow.webContents.once('did-finish-load', () => {
        const filePath = getFileArg(process.argv);
        if (filePath) mainWindow.webContents.send('open-file', filePath);
    });
}

function getFileArg(argv) {
    // In dev: argv = [electron, script, ...args]
    // Packaged: argv = [exe, ...args]
    const skip = app.isPackaged ? 1 : 2;
    for (let i = skip; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('-') && fs.existsSync(a)) return path.resolve(a);
    }
    return null;
}

// -----------------------------------------------------------------------
// App lifecycle
// -----------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    // Windows: second instance opened with a file
    app.on('second-instance', (_, argv) => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        const filePath = getFileArg(argv);
        if (filePath) mainWindow.webContents.send('open-file', filePath);
    });

    // macOS: open-file event
    app.on('open-file', (event, filePath) => {
        event.preventDefault();
        if (mainWindow) mainWindow.webContents.send('open-file', filePath);
    });

    app.whenReady().then(() => {
        // HTTP サーバーのヘッダーに加え、Electron の session 側でも
        // COOP/COEP を注入して crossOriginIsolated を確実に有効化する
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Cross-Origin-Opener-Policy': ['same-origin'],
                    'Cross-Origin-Embedder-Policy': ['credentialless'],
                },
            });
        });
        createWindow();
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
}
