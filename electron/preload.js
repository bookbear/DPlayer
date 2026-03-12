'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onOpenFile: (callback) => ipcRenderer.on('open-file', (_, filePath) => callback(filePath)),
    readFile:   (filePath) => ipcRenderer.invoke('read-file', filePath),
    statFile:   (filePath) => ipcRenderer.invoke('stat-file', filePath),
});
