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
    '/':           { file: path.join(ROOT, 'demo/local-player.html'), mime: 'text/html' },
    '/DPlayer.js': { file: path.join(ROOT, 'dist/DPlayer.min.js'),    mime: 'application/javascript' },
};

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

    return new Response('Not found', { status: 404, headers: COOP_HEADERS });
}

// -----------------------------------------------------------------------
// IPC handlers
// -----------------------------------------------------------------------
ipcMain.handle('stat-file', (_, filePath) => fs.statSync(filePath).size);

// -----------------------------------------------------------------------
// Native ffmpeg (child_process.spawn) で大容量ファイルの字幕を処理
// -----------------------------------------------------------------------
const { spawn } = require('child_process');
const os = require('os');

// ffmpeg のパス解決: 環境変数 FFMPEG_PATH > アプリ同梱 > PATH
function getFFmpegPath() {
    if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
        return process.env.FFMPEG_PATH;
    }
    // アプリと同じディレクトリに ffmpeg.exe / ffmpeg を置いた場合
    const bundled = path.join(ROOT, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(bundled)) return bundled;
    // PATH 上の ffmpeg
    return 'ffmpeg';
}

function spawnFFmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(getFFmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const stderr = [];
        proc.stderr.on('data', (d) => stderr.push(d.toString()));
        proc.stdout.on('data', () => {});
        proc.on('close', (code) => resolve({ code, stderr: stderr.join('') }));
        proc.on('error', (e) => reject(
            new Error(`ffmpeg が見つかりません。ffmpeg を PATH に追加するか、${ROOT} に ffmpeg.exe を置いてください。\n(${e.message})`),
        ));
    });
}

ipcMain.handle('detect-subtitles', async (_, filePath) => {
    const { stderr } = await spawnFFmpeg(['-i', filePath, '-f', 'null', '-']);
    let i = 0;
    return stderr.split('\n').flatMap((line) => {
        const m = line.match(/Stream #0:(\d+)(?:\((\w+)\))?[^:]*:\s*Subtitle:\s*(\w+)/i);
        return m ? [{ index: i++, streamIndex: +m[1], lang: m[2] ?? null, codec: m[3].toLowerCase() }] : [];
    });
});

ipcMain.handle('extract-subtitle', async (_, { filePath, streamIndex, codec }) => {
    const isAss = codec === 'ass' || codec === 'ssa';
    const outFile = path.join(os.tmpdir(), `dplayer_sub_${Date.now()}.${isAss ? 'ass' : 'srt'}`);
    const args = isAss
        ? ['-y', '-i', filePath, '-map', `0:${streamIndex}`, '-c:s', 'copy', outFile]
        : ['-y', '-i', filePath, '-map', `0:${streamIndex}`, '-c:s', 'srt', outFile];
    const { code, stderr } = await spawnFFmpeg(args);
    try {
        if (code !== 0 || !fs.existsSync(outFile)) {
            throw new Error(`ffmpeg が終了コード ${code} で失敗しました`);
        }
        const text = fs.readFileSync(outFile, 'utf8');
        return { text, filename: path.basename(outFile) };
    } finally {
        try { fs.unlinkSync(outFile); } catch {}
    }
});

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

    // F12 で DevTools を開閉
    mainWindow.webContents.on('before-input-event', (_, input) => {
        if (input.key === 'F12') mainWindow.webContents.toggleDevTools();
    });

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
