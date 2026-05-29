const { app, BrowserWindow, globalShortcut, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Базовый URL до папки сервера на GitHub
const GITHUB_BASE_URL = 'https://raw.githubusercontent.com/ChetTeam/MEMO-BB/main/servers/blackberry';
const localDir = path.join(__dirname, 'servers', 'blackberry');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

let win;
let tray = null;
let dbCache = { laws: [], rules: [], macros: [], miniforum: [] };
let appConfig = { hotkey: 'Alt+E' };

// Загрузка конфигурации пользователя
if (fs.existsSync(CONFIG_PATH)) {
    try {
        appConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        console.error('[Config] Ошибка чтения конфига:', e);
    }
}

// Универсальная функция загрузки: пробует GitHub, при неудаче берет локальный файл
async function fetchFromGithubOrLocal(subPath, isArray = true) {
    try {
        // Кодируем URI для безопасной передачи кириллицы (например: банд.json)
        const encodedPath = encodeURI(subPath);
        const res = await fetch(`${GITHUB_BASE_URL}/${encodedPath}?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        // Игнорируем сетевые ошибки, переходим к локальному фоллбэку
    }
    
    // Локальный фоллбэк
    const localPath = path.join(localDir, subPath);
    if (fs.existsSync(localPath)) {
        return JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }
    
    return isArray ? [] : null;
}

// Гибридная сборка базы
async function syncDatabase() {
    const cachedDbPath = path.join(app.getPath('userData'), 'cache_blackberry.json');
    let assembledData = { laws: [], rules: [], macros: [], miniforum: [] };

    console.log('[SYSTEM] Запуск синхронизации базы данных...');

    try {
        // 1. Запрашиваем манифест (точка входа)
        const manifest = await fetchFromGithubOrLocal('manifest.json', false);

        if (!manifest) {
            throw new Error('Манифест сервера не найден ни удаленно, ни локально.');
        }

        // 2. Параллельная загрузка законодательной базы
        if (manifest.modules && manifest.modules.laws) {
            const lawPromises = manifest.modules.laws.map(file => fetchFromGithubOrLocal(`laws/${file}`, true));
            const lawsData = await Promise.all(lawPromises);
            assembledData.laws = lawsData.flat();
        }

        // 3. Параллельная загрузка регламентов (правил)
        if (manifest.modules && manifest.modules.rules) {
            const rulePromises = manifest.modules.rules.map(file => fetchFromGithubOrLocal(`rules/${file}`, true));
            const rulesData = await Promise.all(rulePromises);
            assembledData.rules = rulesData.flat();
        }

        // 4. Загрузка ядра (макросы и мини-форум)
        assembledData.macros = await fetchFromGithubOrLocal('core/macros.json', true) || [];
        assembledData.miniforum = await fetchFromGithubOrLocal('core/miniforum.json', true) || [];

        // 5. Фиксация в кэш
        if (assembledData.laws.length > 0 || assembledData.rules.length > 0) {
            fs.writeFileSync(cachedDbPath, JSON.stringify(assembledData, null, 2), 'utf-8');
        }

        console.log(`[SYSTEM] База собрана. Законов: ${assembledData.laws.length}, Правил: ${assembledData.rules.length}`);
        return assembledData;

    } catch (error) {
        console.error(`[ERROR] Сбой сборки: ${error.message}`);
        
        // Поднятие последнего успешного кэша при тотальном сбое
        if (fs.existsSync(cachedDbPath)) {
            console.log(`[SYSTEM] Активирован резервный кэш приложения.`);
            return JSON.parse(fs.readFileSync(cachedDbPath, 'utf-8'));
        }
        
        return assembledData;
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
    const uppercaseHotkey = shortcutString.split('+').map(k => k.length === 1 ? k.toUpperCase() : k).join('+');
    
    const registerSuccess = globalShortcut.register(uppercaseHotkey, () => {
        toggleWindow();
    });

    if (registerSuccess) {
        appConfig.hotkey = shortcutString;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(appConfig, null, 2), 'utf8');
        return true;
    }
    
    globalShortcut.register('Alt+E', () => { toggleWindow(); });
    return false;
}

function createWindow() {
    win = new BrowserWindow({
        width: 950,
        height: 650,
        transparent: true,
        frame: false,
        type: 'toolbar',
        skipTaskbar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    win.loadFile('index.html');
    win.on('blur', () => { if (win) win.hide(); });
}

function createTray() {
    const iconPath = path.join(__dirname, 'icon.ico');
    let icon = nativeImage.createEmpty();
    
    if (fs.existsSync(iconPath)) {
        icon = nativeImage.createFromPath(iconPath);
        icon = icon.resize({ width: 16, height: 16 });
    }
    
    tray = new Tray(icon);
    
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Показать / Скрыть', click: () => toggleWindow() },
        { type: 'separator' },
        { label: 'Выйти из приложения', click: () => { app.quit(); } }
    ]);

    tray.setToolTip('LIFE5RP MEMO LAWS');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => toggleWindow());
}

app.whenReady().then(async () => {
    dbCache = await syncDatabase();
    
    createWindow();
    createTray();
    setupAutoUpdater();

    registerHotkey(appConfig.hotkey || 'Alt+E');

    ipcMain.handle('get-data', () => dbCache);
    ipcMain.handle('get-hotkey', () => appConfig.hotkey || 'Alt+E');
    
    ipcMain.handle('change-hotkey', (event, newHotkey) => {
        return registerHotkey(newHotkey);
    });
    
    ipcMain.on('set-opacity', (event, value) => { if (win) win.setOpacity(parseFloat(value)); });
    ipcMain.on('open-discord', () => shell.openExternal('https://discord.gg/cheterin'));
    ipcMain.on('open-github', () => shell.openExternal('https://github.com/ChetTeam/MEMO-BB'));
    ipcMain.on('open-external', (event, url) => shell.openExternal(url));
    ipcMain.on('close-app', () => { if (win) win.hide(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());