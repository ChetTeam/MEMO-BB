const { app, BrowserWindow, globalShortcut, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const REMOTE_DB_URL = 'https://raw.githubusercontent.com/ChetTeam/MEMO-BB/main/data.json';

let win;
let dbCache = { laws: [], rules: [] };

async function syncDatabase() {
    const localDbPath = path.join(app.getPath('userData'), 'data.json');
    const bundledDbPath = path.join(__dirname, 'data.json');

    try {
        const response = await fetch(REMOTE_DB_URL, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf-8');
        return data;
    } catch (error) {
        console.error(`[Hot-Swap] Ошибка: ${error.message}`);
        if (fs.existsSync(localDbPath)) return JSON.parse(fs.readFileSync(localDbPath, 'utf-8'));
        if (fs.existsSync(bundledDbPath)) return JSON.parse(fs.readFileSync(bundledDbPath, 'utf-8'));
        return { laws: [], rules: [] };
    }
}

function setupAutoUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.checkForUpdates();

    autoUpdater.on('update-available', (info) => {
        dialog.showMessageBox({
            type: 'info',
            title: 'Доступно обновление',
            message: `Вышла новая версия GTA5RP MEMO LAWS (${info.version}). Обновить сейчас?`,
            buttons: ['Обновить', 'Позже'],
            defaultId: 0,
            cancelId: 1
        }).then((result) => {
            if (result.response === 0) {
                // Выводим уведомление, что процесс пошел
                dialog.showMessageBox({
                    type: 'info',
                    title: 'Загрузка...',
                    message: 'Обновление загружается в фоновом режиме. Это может занять пару минут. Окно установки появится автоматически.',
                    buttons: ['Понятно']
                });
                autoUpdater.downloadUpdate();
            }
        });
    });

    autoUpdater.on('update-downloaded', () => {
        dialog.showMessageBox({
            type: 'question',
            title: 'Установка обновления',
            message: 'Пакет успешно загружен. Приложение будет перезапущено для установки.',
            buttons: ['Перезапустить и установить']
        }).then(() => {
            setImmediate(() => autoUpdater.quitAndInstall());
        });
    });

    // Теперь ошибки будут вылетать прямо в интерфейс, а не в скрытую консоль
    autoUpdater.on('error', (err) => {
        dialog.showErrorBox('Сбой обновления', err == null ? "Неизвестная ошибка" : (err.stack || err).toString());
    });
}

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

app.whenReady().then(async () => {
    dbCache = await syncDatabase();
    
    createWindow();
    
    // Инициализация автообновлений после рендера окна
    setupAutoUpdater();

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

    ipcMain.handle('get-data', () => dbCache);
    
    ipcMain.handle('get-macros', () => {
        const p = path.join(__dirname, 'macros.json');
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
    });
    
    ipcMain.on('set-opacity', (event, value) => { if (win) win.setOpacity(parseFloat(value)); });
    ipcMain.on('open-discord', () => shell.openExternal('https://discord.gg/cheterin'));
    ipcMain.on('open-github', () => shell.openExternal('https://github.com/ChetTeam/MEMO-BB'));
    ipcMain.on('open-external', (event, url) => shell.openExternal(url));
    ipcMain.on('close-app', () => app.quit());
});

app.on('will-quit', () => globalShortcut.unregisterAll());