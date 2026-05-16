const { app, BrowserWindow, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win;

function createWindow() {
    win = new BrowserWindow({
        width: 950,
        height: 650,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    win.loadFile('index.html');

    win.on('blur', () => {
        win.hide();
    });
}

app.whenReady().then(() => {
    createWindow();

    let currentHotkey = 'Alt+E';
    globalShortcut.register(currentHotkey, () => {
        if (win.isVisible()) {
            win.hide();
        } else {
            win.show();
            win.focus();
            win.webContents.send('focus-input');
        }
    });

    ipcMain.handle('get-data', () => {
        const p = path.join(__dirname, 'data.json');
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { laws: [], rules: [] };
    });

    ipcMain.on('set-opacity', (event, value) => {
        if (win) win.setOpacity(parseFloat(value));
    });

    ipcMain.on('open-discord', () => {
        shell.openExternal('https://discord.gg/cheterin');
    });

    // Новый канал маршрутизации на GitHub
    ipcMain.on('open-github', () => {
        shell.openExternal('https://github.com/nanda070/');
    });

    ipcMain.on('close-app', () => app.quit());
});

app.on('will-quit', () => globalShortcut.unregisterAll());