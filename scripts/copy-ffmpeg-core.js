'use strict';

// ffmpeg.wasm 関連ファイルを demo/ にコピーする
// npm install (prepare フック) および electron:build 前に実行される
//
// コピー先:
//   @ffmpeg/core/dist/esm/        → demo/ffmpeg-core.js, demo/ffmpeg-core.wasm
//   @ffmpeg/ffmpeg/dist/esm/      → demo/vendor/ffmpeg/
//   @ffmpeg/util/dist/esm/        → demo/vendor/ffmpeg-util/

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function copyDir(src, dest) {
    if (!fs.existsSync(src)) {
        console.warn(`[copy-ffmpeg] not found: ${src}`);
        return;
    }
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
        const s = path.join(src, entry);
        const d = path.join(dest, entry);
        if (fs.statSync(s).isDirectory()) {
            copyDir(s, d);
        } else {
            fs.copyFileSync(s, d);
        }
    }
    console.log(`[copy-ffmpeg] copied ${path.relative(ROOT, src)} → ${path.relative(ROOT, dest)}`);
}

// ffmpeg-core (wasm本体)
copyDir(
    path.join(ROOT, 'node_modules/@ffmpeg/core/dist/esm'),
    path.join(ROOT, 'demo'),
);

// ffmpeg ESM モジュール
copyDir(
    path.join(ROOT, 'node_modules/@ffmpeg/ffmpeg/dist/esm'),
    path.join(ROOT, 'demo/vendor/ffmpeg'),
);

// ffmpeg-util ESM モジュール
copyDir(
    path.join(ROOT, 'node_modules/@ffmpeg/util/dist/esm'),
    path.join(ROOT, 'demo/vendor/ffmpeg-util'),
);
