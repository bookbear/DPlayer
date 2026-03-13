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

// -----------------------------------------------------------------------
// MKVToolNix (mkvmerge / mkvextract) — MKV ファイルの高速字幕抽出
// -----------------------------------------------------------------------
let _mkvToolsChecked = false;
let _mkvToolsAvailable = false;

function getMkvToolPath(tool) {
    const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
    const candidates = [
        process.env.MKVTOOLNIX_PATH ? path.join(process.env.MKVTOOLNIX_PATH, exe) : null,
        path.join(ROOT, exe),
        ...(process.platform === 'win32' ? [
            path.join('C:\\Program Files\\MKVToolNix', exe),
            path.join('C:\\Program Files (x86)\\MKVToolNix', exe),
        ] : []),
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return tool;
}

async function hasMkvTools() {
    if (_mkvToolsChecked) return _mkvToolsAvailable;
    _mkvToolsChecked = true;
    try {
        for (const tool of ['mkvmerge', 'mkvextract']) {
            await new Promise((resolve, reject) => {
                const proc = spawn(getMkvToolPath(tool), ['--version'],
                    { stdio: 'ignore', windowsHide: true });
                proc.on('close', (code) => code === 0 ? resolve() : reject());
                proc.on('error', reject);
            });
        }
        _mkvToolsAvailable = true;
    } catch {
        _mkvToolsAvailable = false;
    }
    return _mkvToolsAvailable;
}

function mapMkvCodec(codecId) {
    const id = (codecId || '').toUpperCase();
    if (id.includes('ASS') || id === 'S_TEXT/ASS') return 'ass';
    if (id.includes('SSA') || id === 'S_TEXT/SSA') return 'ssa';
    if (id.includes('SRT') || id.includes('SUBRIP') || id === 'S_TEXT/UTF8') return 'subrip';
    if (id.includes('PGS') || id === 'S_HDMV/PGS') return 'hdmv_pgs_subtitle';
    if (id.includes('VOBSUB') || id === 'S_VOBSUB') return 'dvd_subtitle';
    if (id.includes('WEBVTT') || id === 'S_TEXT/WEBVTT') return 'webvtt';
    return codecId?.toLowerCase() || 'unknown';
}

// 実行中の子プロセスを追跡（新ファイル読み込み時に kill するため）
const _runningProcs = new Set();

function spawnFFmpeg(args, onStderr) {
    return new Promise((resolve, reject) => {
        const proc = spawn(getFFmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        _runningProcs.add(proc);
        // 動画ストリーミングとの I/O 競合を減らすため優先度を下げる
        if (proc.pid) {
            try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
        }
        const stderr = [];
        const stdout = [];
        proc.stderr.on('data', (d) => {
            const s = d.toString();
            stderr.push(s);
            if (onStderr) onStderr(s);
        });
        proc.stdout.on('data', (d) => stdout.push(d));
        proc.on('close', (code) => {
            _runningProcs.delete(proc);
            resolve({ code, stderr: stderr.join(''), stdout: Buffer.concat(stdout) });
        });
        proc.on('error', (e) => {
            _runningProcs.delete(proc);
            reject(new Error(`ffmpeg が見つかりません。ffmpeg を PATH に追加するか、${ROOT} に ffmpeg.exe を置いてください。\n(${e.message})`));
        });
    });
}

// 新しいファイルを開く前に呼ぶ: 実行中の子プロセスを全て終了させる
ipcMain.handle('cancel-ffmpeg', () => {
    for (const proc of _runningProcs) proc.kill();
    _runningProcs.clear();
});

// 字幕トラック検出
ipcMain.handle('detect-subtitles', async (_, filePath) => {
    const isMkv = /\.mkv$/i.test(filePath);

    // MKV + MKVToolNix: mkvmerge -J で高速検出（構造化 JSON 出力）
    if (isMkv && await hasMkvTools()) {
        return new Promise((resolve, reject) => {
            const proc = spawn(getMkvToolPath('mkvmerge'), ['-J', filePath],
                { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
            const chunks = [];
            proc.stdout.on('data', (d) => chunks.push(d));
            proc.on('close', () => {
                try {
                    const info = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    let i = 0;
                    const subtitles = (info.tracks || [])
                        .filter(t => t.type === 'subtitles')
                        .map(t => ({
                            index: i++,
                            streamIndex: t.id,
                            lang: t.properties?.language ?? null,
                            codec: mapMkvCodec(t.properties?.codec_id ?? t.codec),
                            mkvTrackId: t.id,
                        }));
                    resolve({ tracks: subtitles, tool: 'mkvmerge' });
                } catch (e) { reject(e); }
            });
            proc.on('error', reject);
        });
    }

    // フォールバック: ffmpeg -i
    const { stderr } = await spawnFFmpeg(['-i', filePath]);
    let i = 0;
    const subtitles = stderr.split('\n').flatMap((line) => {
        const m = line.match(/Stream #0:(\d+)(?:\((\w+)\))?[^:]*:\s*Subtitle:\s*(\w+)/i);
        return m ? [{ index: i++, streamIndex: +m[1], lang: m[2] ?? null, codec: m[3].toLowerCase() }] : [];
    });
    return { tracks: subtitles, tool: 'ffmpeg' };
});

// 字幕抽出: 進捗を renderer にリアルタイム送信
ipcMain.handle('extract-subtitle', async (event, { filePath, streamIndex, codec, mkvTrackId }) => {
    const isAss = codec === 'ass' || codec === 'ssa';

    // MKV + MKVToolNix: mkvextract で高速抽出（cue インデックスで直接シーク）
    if (mkvTrackId !== undefined && await hasMkvTools()) {
        const ext = isAss ? 'ass' : 'srt';
        const outFile = path.join(os.tmpdir(), `dplayer_sub_${Date.now()}.${ext}`);
        return new Promise((resolve, reject) => {
            const proc = spawn(
                getMkvToolPath('mkvextract'),
                ['tracks', filePath, `${mkvTrackId}:${outFile}`],
                { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
            );
            _runningProcs.add(proc);
            proc.stderr.on('data', (d) => {
                const m = d.toString().match(/progress:\s*(\d+)%/i);
                if (m) event.sender.send('ffmpeg-progress', `${m[1]}%`);
            });
            proc.on('close', (code) => {
                _runningProcs.delete(proc);
                try {
                    if (code !== 0 || !fs.existsSync(outFile)) {
                        reject(new Error(`mkvextract が終了コード ${code} で失敗しました`));
                        return;
                    }
                    const text = fs.readFileSync(outFile, 'utf8');
                    resolve({ text, filename: path.basename(outFile), tool: 'mkvextract' });
                } finally {
                    try { fs.unlinkSync(outFile); } catch {}
                }
            });
            proc.on('error', (e) => {
                _runningProcs.delete(proc);
                reject(new Error(`mkvextract が見つかりません: ${e.message}`));
            });
        });
    }

    // フォールバック: ffmpeg（stdout パイプで一時ファイル不要）
    const fmt = isAss ? 'ass' : 'srt';
    const args = ['-y', '-nostdin', '-i', filePath, '-map', `0:${streamIndex}`,
        '-c:s', isAss ? 'copy' : 'srt', '-f', fmt, 'pipe:1'];
    const { code, stdout } = await spawnFFmpeg(args, (chunk) => {
        const m = chunk.match(/time=(\d{2}:\d{2}:\d{2})/);
        if (m) event.sender.send('ffmpeg-progress', m[1]);
    });
    if (code !== 0 || stdout.length === 0) {
        throw new Error(`ffmpeg が終了コード ${code} で失敗しました`);
    }
    return { text: stdout.toString('utf8'), filename: `subtitle.${fmt}`, tool: 'ffmpeg' };
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
