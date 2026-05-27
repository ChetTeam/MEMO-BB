const { app, BrowserWindow, globalShortcut, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const REMOTE_DB_URL = 'https://raw.githubusercontent.com/ChetTeam/MEMO-BB/main/data.json';
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

let win;
let tray = null;
let dbCache = { laws: [], rules: [] };
let appConfig = { hotkey: 'Alt+E' };

// Загрузка конфигурации пользователя
if (fs.existsSync(CONFIG_PATH)) {
    try {
        appConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        console.error('[Config] Ошибка чтения конфига:', e);
    }
}

async function syncDatabase() {
    const localDbPath = path.join(app.getPath('userData'), 'data.json');
    const bundledDbPath = path.join(__dirname, 'data.json');

    try {
        // Добавляем ?t=таймстэмп, чтобы GitHub всегда отдавал свежий файл, минуя кэш
        const response = await fetch(`${REMOTE_DB_URL}?t=${Date.now()}`, { cache: 'no-store' });
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
            message: `Вышла новая версия MEMO LAWS (${info.version}). Обновить сейчас?`,
            buttons: ['Обновить', 'Позже'],
            defaultId: 0,
            cancelId: 1
        }).then((result) => {
            if (result.response === 0) {
                if (win) win.webContents.send('update-download-started');
                autoUpdater.downloadUpdate();
            }
        });
    });

    autoUpdater.on('download-progress', (progressObj) => {
        if (win) {
            win.webContents.send('update-download-progress', progressObj.percent);
            win.setProgressBar(progressObj.percent / 100); 
        }
    });

    autoUpdater.on('update-downloaded', () => {
        if (win) {
            win.setProgressBar(-1); 
            win.webContents.send('update-download-finished');
        }
        dialog.showMessageBox({
            type: 'question',
            title: 'Установка обновления',
            message: 'Пакет успешно загружен. Приложение будет перезапущено для установки.',
            buttons: ['Перезапустить и установить']
        }).then(() => {
            setImmediate(() => autoUpdater.quitAndInstall());
        });
    });

    autoUpdater.on('error', (err) => {
        if (win) {
            win.setProgressBar(-1);
            win.webContents.send('update-download-error');
        }
        dialog.showErrorBox('Сбой обновления', err == null ? "Неизвестная ошибка" : (err.stack || err).toString());
    });
}

function toggleWindow() {
    if (!win) return;
    if (win.isVisible()) {
        win.hide();
    } else {
        win.show();
        win.focus();
        win.webContents.send('focus-input');
    }
}

function registerHotkey(shortcutString) {
    globalShortcut.unregisterAll();
    const registerSuccess = globalShortcut.register(shortcutString, () => {
        toggleWindow();
    });

    if (registerSuccess) {
        appConfig.hotkey = shortcutString;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(appConfig, null, 2), 'utf8');
        return true;
    }
    
    // Фолбэк на дефолт, если кастомный бинд некорректен
    globalShortcut.register('Alt+E', () => { toggleWindow(); });
    return false;
}

function createWindow() {
    win = new BrowserWindow({
        width: 950,
        height: 650,
        transparent: true,
        frame: false,
        type: 'toolbar', // Ключевой фикс: ОС перестает триггерить таскбар при фокусе
        skipTaskbar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // Агрессивный форс Z-индекса поверх всех окон и полноэкранных приложений
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    win.loadFile('index.html');
    win.on('blur', () => { if (win) win.hide(); });
}

function createTray() {
    // Ищем строго .ico
    const iconPath = path.join(__dirname, 'icon.ico');
    
    let icon = nativeImage.createEmpty();
    if (fs.existsSync(iconPath)) {
        icon = nativeImage.createFromPath(iconPath);
        // Принудительно подгоняем под системный размер трея Windows
        icon = icon.resize({ width: 16, height: 16 });
    }
    
    tray = new Tray(icon);
    
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Показать / Скрыть', click: () => toggleWindow() },
        { type: 'separator' },
        { label: 'Выйти из приложения', click: () => { app.quit(); } }
    ]);

    tray.setToolTip('GTA5RP MEMO LAWS');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => toggleWindow());
}

app.whenReady().then(async () => {
    dbCache = await syncDatabase();
    
    createWindow();
    createTray();
    setupAutoUpdater();

    // Регистрация хоткея из конфигурации
    registerHotkey(appConfig.hotkey || 'Alt+E');

    ipcMain.handle('get-data', () => dbCache);
    ipcMain.handle('get-hotkey', () => appConfig.hotkey || 'Alt+E');
    
    ipcMain.handle('change-hotkey', (event, newHotkey) => {
        return registerHotkey(newHotkey);
    });

    ipcMain.handle('get-macros', () => {
        const p = path.join(__dirname, 'macros.json');
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
    });
    
    ipcMain.on('set-opacity', (event, value) => { if (win) win.setOpacity(parseFloat(value)); });
    ipcMain.on('open-discord', () => shell.openExternal('https://discord.gg/cheterin'));
    ipcMain.on('open-github', () => shell.openExternal('https://github.com/ChetTeam/MEMO-BB'));
    ipcMain.on('open-external', (event, url) => shell.openExternal(url));
    ipcMain.on('close-app', () => { if (win) win.hide(); }); // Кнопка Х теперь просто скрывает окно в трей
});

app.on('will-quit', () => globalShortcut.unregisterAll());