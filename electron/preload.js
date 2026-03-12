'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onOpenFile:      (callback) => ipcRenderer.on('open-file', (_, filePath) => callback(filePath)),
    readFile:        (filePath) => ipcRenderer.invoke('read-file', filePath),
    statFile:        (filePath) => ipcRenderer.invoke('stat-file', filePath),
    // ドラッグ&ドロップ等で得た File オブジェクトから実ファイルパスを取得 (Electron 32+)
    getPathForFile:  (file) => webUtils.getPathForFile(file),
    // 実行中の ffmpeg を全て終了させる（新ファイル読み込み前に呼ぶ）
    cancelFFmpeg:    ()          => ipcRenderer.invoke('cancel-ffmpeg'),
    // 字幕検出・抽出
    detectSubtitles: (filePath) => ipcRenderer.invoke('detect-subtitles', filePath),
    extractSubtitle: (opts)     => ipcRenderer.invoke('extract-subtitle', opts),
    // 抽出進捗コールバック
    onFFmpegProgress: (cb) => ipcRenderer.on('ffmpeg-progress', (_, time) => cb(time)),
});
