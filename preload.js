const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getData: () => ipcRenderer.invoke('get-data'),
    getMacros: () => ipcRenderer.invoke('get-macros'),
    getHotkey: () => ipcRenderer.invoke('get-hotkey'),
    changeHotkey: (newHotkey) => ipcRenderer.invoke('change-hotkey', newHotkey),
    setOpacity: (value) => ipcRenderer.send('set-opacity', value),
    openDiscord: () => ipcRenderer.send('open-discord'),
    openGithub: () => ipcRenderer.send('open-github'),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    close: () => ipcRenderer.send('close-app'),
    onFocus: (callback) => ipcRenderer.on('focus-input', callback),
    
    onUpdateStarted: (callback) => ipcRenderer.on('update-download-started', callback),
    onUpdateProgress: (callback) => ipcRenderer.on('update-download-progress', (_event, percent) => callback(percent)),
    onUpdateFinished: (callback) => ipcRenderer.on('update-download-finished', callback),
    onUpdateError: (callback) => ipcRenderer.on('update-download-error', callback)
});