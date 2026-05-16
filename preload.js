const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getData: () => ipcRenderer.invoke('get-data'),
    setOpacity: (val) => ipcRenderer.send('set-opacity', val),
    openDiscord: () => ipcRenderer.send('open-discord'),
    openGithub: () => ipcRenderer.send('open-github'), // Регистрация метода
    close: () => ipcRenderer.send('close-app'),
    onFocus: (callback) => ipcRenderer.on('focus-input', callback)
});