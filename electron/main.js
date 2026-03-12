'use strict';

const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('fs');
const path = require('path');

// app:// スキームをアプリ起動前に登録する（app.ready より前に呼ぶ必要あり）
// secure: true → HTTPS 相当の secure context → SharedArrayBuffer が使える
// standard: true → 通常の URL として扱う（相対パス・クッキーなど）
protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
    },
}]);

// -----------------------------------------------------------------------
// Path resolution (dev vs packaged)
// -----------------------------------------------------------------------
const ROOT = app.isPackaged
    ? app.getAppPath()
    : path.resolve(__dirname, '..');

// -----------------------------------------------------------------------
// Route mapping
// -----------------------------------------------------------------------
const ROUTES = {
    '/':                 { file: path.join(ROOT, 'demo/local-player.html'),  mime: 'text/html' },
    '/DPlayer.js':       { file: path.join(ROOT, 'dist/DPlayer.min.js'),     mime: 'application/javascript' },
    '/ffmpeg-core.js':   { file: path.join(ROOT, 'demo/ffmpeg-core.js'),     mime: 'application/javascript' },
    '/ffmpeg-core.wasm': { file: path.join(ROOT, 'demo/ffmpeg-core.wasm'),   mime: 'application/wasm' },
};

const STATIC_DIRS = [
    { prefix: '/ffmpeg/',      dir: path.join(ROOT, 'demo/vendor/ffmpeg') },
    { prefix: '/ffmpeg-util/', dir: path.join(ROOT, 'demo/vendor/ffmpeg-util') },
];

const MIME_EXT = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };

const COOP_HEADERS = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Access-Control-Allow-Origin': '*',
};

// 静的アセットのメモリキャッシュ
const fileCache = new Map();
function readCached(filePath) {
    if (!fileCache.has(filePath)) {
        fileCache.set(filePath, fs.readFileSync(filePath));
    }
    return fileCache.get(filePath);
}

// Node.js の Readable ストリームを Web ReadableStream に変換
function toWebStream(nodeStream) {
    return new ReadableStream({
        start(controller) {
            nodeStream.on('data', (chunk) => controller.enqueue(chunk));
            nodeStream.on('end',  ()      => controller.close());
            nodeStream.on('error', (err)  => controller.error(err));
        },
        cancel() { nodeStream.destroy(); },
    });
}

// -----------------------------------------------------------------------
// app:// プロトコルハンドラー
// -----------------------------------------------------------------------
function handleAppRequest(request) {
    const url = new URL(request.url);
    const urlPath = url.pathname;

    // /media: ローカル動画ファイルのストリーミング（range request 対応）
    if (urlPath === '/media') {
        const filePath = url.searchParams.get('path');
        if (!filePath || !fs.existsSync(filePath)) {
            return new Response('Not found', { status: 404, headers: COOP_HEADERS });
        }
        const stat = fs.statSync(filePath);
        const rangeHeader = request.headers.get('range');

        if (rangeHeader) {
            const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
            const start = parseInt(startStr, 10);
            const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
            return new Response(toWebStream(fs.createReadStream(filePath, { start, end })), {
                status: 206,
                headers: {
                    ...COOP_HEADERS,
                    'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
                    'Accept-Ranges':  'bytes',
                    'Content-Length': String(end - start + 1),
                    'Content-Type':   'video/mp4',
                },
            });
        }

        return new Response(toWebStream(fs.createReadStream(filePath)), {
            status: 200,
            headers: {
                ...COOP_HEADERS,
                'Content-Length': String(stat.size),
                'Content-Type':   'video/mp4',
                'Accept-Ranges':  'bytes',
            },
        });
    }

    // 静的ファイル（exact match）
    if (ROUTES[urlPath]) {
        const { file, mime } = ROUTES[urlPath];
        try {
            return new Response(readCached(file), {
                status: 200,
                headers: { 'Content-Type': mime, ...COOP_HEADERS },
            });
        } catch {
            return new Response('Not found', { status: 404, headers: COOP_HEADERS });
        }
    }

    // 静的ディレクトリ（ffmpeg ESM モジュール）
    for (const { prefix, dir } of STATIC_DIRS) {
        if (urlPath.startsWith(prefix)) {
            const file = path.join(dir, urlPath.slice(prefix.length));
            const mime = MIME_EXT[path.extname(file)] || 'application/octet-stream';
            try {
                return new Response(readCached(file), {
                    status: 200,
                    headers: { 'Content-Type': mime, ...COOP_HEADERS },
                });
            } catch {
                return new Response('Not found', { status: 404, headers: COOP_HEADERS });
            }
        }
    }

    return new Response('Not found', { status: 404, headers: COOP_HEADERS });
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

function createWindow() {
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
    mainWindow.loadURL('app://localhost/');

    mainWindow.webContents.once('did-finish-load', () => {
        const filePath = getFileArg(process.argv);
        if (filePath) mainWindow.webContents.send('open-file', filePath);
    });
}

function getFileArg(argv) {
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
    app.on('second-instance', (_, argv) => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        const filePath = getFileArg(argv);
        if (filePath) mainWindow.webContents.send('open-file', filePath);
    });

    app.on('open-file', (event, filePath) => {
        event.preventDefault();
        if (mainWindow) mainWindow.webContents.send('open-file', filePath);
    });

    app.whenReady().then(() => {
        protocol.handle('app', handleAppRequest);
        createWindow();
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
}
