const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getData: () => ipcRenderer.invoke('get-data'),
    getMacros: () => ipcRenderer.invoke('get-macros'),
    setOpacity: (value) => ipcRenderer.send('set-opacity', value),
    openDiscord: () => ipcRenderer.send('open-discord'),
    openGithub: () => ipcRenderer.send('open-github'),
    openExternal: (url) => ipcRenderer.send('open-external', url), // НОВАЯ СТРОКА
    close: () => ipcRenderer.send('close-app'),
    onFocus: (callback) => ipcRenderer.on('focus-input', callback)
});