'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onOpenFile:      (callback) => ipcRenderer.on('open-file', (_, filePath) => callback(filePath)),
    readFile:        (filePath) => ipcRenderer.invoke('read-file', filePath),
    statFile:        (filePath) => ipcRenderer.invoke('stat-file', filePath),
    // ドラッグ&ドロップ等で得た File オブジェクトから実ファイルパスを取得 (Electron 32+)
    getPathForFile:  (file) => webUtils.getPathForFile(file),
    // メインプロセスの ffmpeg (NODEFS) で字幕を検出・抽出 (ファイルサイズ制限なし)
    detectSubtitles: (filePath) => ipcRenderer.invoke('detect-subtitles', filePath),
    extractSubtitle: (opts)     => ipcRenderer.invoke('extract-subtitle', opts),
});
