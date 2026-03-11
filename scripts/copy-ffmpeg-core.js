'use strict';

// @ffmpeg/core の wasm/js ファイルを demo/ にコピーする
// npm install (prepare フック) で自動実行される

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../node_modules/@ffmpeg/core/dist/esm');
const DEST = path.resolve(__dirname, '../demo');

for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
    const src = path.join(SRC, file);
    const dest = path.join(DEST, file);
    if (!fs.existsSync(src)) {
        console.warn(`[copy-ffmpeg-core] not found: ${src}`);
        continue;
    }
    fs.copyFileSync(src, dest);
    console.log(`[copy-ffmpeg-core] copied ${file}`);
}
