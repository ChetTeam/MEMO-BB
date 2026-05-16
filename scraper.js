const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const TARGET_CODES = [
    { category: 'АК', url: 'https://forum.gta5rp.com/threads/administrativnyi-kodeks-shtata-san-andreas-redakcija-ot-29-marta-2025-goda.827016/' },
    { category: 'УК', url: 'https://forum.gta5rp.com/threads/ugolovnyi-kodeks-shtata-san-andreas-redakcija-ot-29-marta-2026-goda.826988/' },
    { category: 'ДК', url: 'https://forum.gta5rp.com/threads/dorozhnyi-kodeks-shtata-san-andreas-redakcija-ot-29-marta-2025-goda.826974/' },
    { category: 'ПК', url: 'https://forum.gta5rp.com/threads/processualnyi-kodeks-shtata-san-andreas-redakcija-ot-29-marta-2026-goda.826899/' }
];

const TARGET_RULES = [
    { category: 'проекта', url: 'https://forum.gta5rp.com/threads/pravila-proekta.652405/' },
    { category: 'FZ/FT', url: 'https://forum.gta5rp.com/threads/pravila-napadenija-na-fort-zankudo-federalnuju-tjurmu.270403/' },
    { category: 'ГШ', url: 'https://forum.gta5rp.com/threads/pravila-ograblenija-ammunation.270412/' },
    { category: 'Огр', url: 'https://forum.gta5rp.com/threads/pravila-ograblenii-poxischenii.270404/' },
    { category: 'ПГС', url: 'https://forum.gta5rp.com/threads/pravila-gosudarstvennyx-struktur.268600/' },
    { category: 'Облав', url: 'https://forum.gta5rp.com/threads/pravila-shturma-titulnogo-raiona.295874/' },
    { category: 'Рейдов', url: 'https://forum.gta5rp.com/threads/pravila-reidov.270390/' },
    { category: 'Мафий', url: 'https://forum.gta5rp.com/threads/obschie-pravila-mafii.270406/' },
    { category: 'Банд', url: 'https://forum.gta5rp.com/threads/obschie-pravila-band.270408/' }
];

function getChromePath() {
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        process.env.LOCALAPPDATA + '\\Yandex\\YandexBrowser\\Application\\browser.exe'
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error('Исполняемый файл браузера не найден.');
}

function sortDatabase(items) {
    const order = { 'УК': 1, 'ДК': 2, 'АК': 3, 'ПК': 4 };
    return items.sort((a, b) => {
        const catA = order[a.category] || 99;
        const catB = order[b.category] || 99;
        if (catA !== catB) return catA - catB;
        const parseNum = (str) => str.replace(/[^\d.]/g, '').split('.').map(n => parseInt(n, 10) || 0);
        const partsA = parseNum(a.article);
        const partsB = parseNum(b.article);
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            if ((partsA[i] || 0) !== (partsB[i] || 0)) return (partsA[i] || 0) - (partsB[i] || 0);
        }
        return 0;
    });
}

function sanitizeText(text) {
    return text
        .replace(/[\u200b\u200c\u200d\ufeff]/g, '') 
        .replace(/\*/g, '') 
        .replace(/\u00A0/g, ' ') 
        .replace(/ {2,}/g, ' ') 
        .replace(/^[ \t]*Глава.*$/gim, '') // Тотальное уничтожение Глав
        .replace(/\n\s*\n\s*\n/g, '\n\n') 
        .trim();
}

async function parseAll() {
    console.log('[SYSTEM] Запуск парсера. Лимиты сняты, сбор до последней страницы...');
    const browser = await puppeteer.launch({
        executablePath: getChromePath(),
        headless: false,
        args: ['--start-minimized']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    let parsedDatabase = { laws: [], rules: [] };

    // КОДЕКСЫ
    for (const target of TARGET_CODES) {
        console.log(`[PROCESS] Индексация кодекса: ${target.category}`);
        const rawText = await getThreadRawText(page, target.url);
        
        let cleanText = sanitizeText(rawText);
        let lines = cleanText.split('\n').filter(line => line.trim() !== '');
        let processedText = lines.join('\n');

        // Принудительная замена лет на сутки для АК до работы парсера наказаний
        if (target.category === 'АК') {
            processedText = processedText.replace(/\bлет\b/gi, 'суток');
        }

        const articleRegex = /(?:^|\n)\s*[^a-zA-Zа-яА-Я0-9]*Статья\s+(\d+[\d.]*)/gi;
        let matches = [];
        let match;
        
        while ((match = articleRegex.exec(processedText)) !== null) {
            matches.push({ index: match.index, artNum: match[1].replace(/\.$/, '').trim() });
        }

        for (let i = 0; i < matches.length; i++) {
            const start = matches[i].index;
            const end = (i + 1 < matches.length) ? matches[i+1].index : processedText.length;
            const fullText = processedText.slice(start, end).trim();
            const artNum = matches[i].artNum;

            let fineValue = "";
            let jailValue = "";

            // Нормализация текста для точного поиска цифр (убираем пробелы в тысячах)
            const textForRegex = fullText.replace(/(\d)\s+(\d)/g, '$1$2');

            // Извлечение штрафов (везде, кроме УК)
            if (target.category !== 'УК') {
                const fineMatch = textForRegex.match(/(?:(?:от|до)\s*)?\d+[\d.,]*(?:\s*(?:до|-)\s*\d+[\d.,]*)?\s*\$/i);
                if (fineMatch) {
                    fineValue = fineMatch[0].trim();
                } else {
                    const fb = textForRegex.match(/(?:штраф|взыскание)[^\d]*(\d+[\d.,]*)/i);
                    if (fb) fineValue = fb[1] + '$';
                }
            }

            // Извлечение сроков ареста/КПЗ (универсально для всех кодексов)
            const jailMatch = textForRegex.match(/(?:(?:от|до)\s*)?\d+(?:\s*(?:до|-)\s*\d+)?\s*(?:лет|суток|месяцев|минут|мин|м\.)/i);
            if (jailMatch) {
                jailValue = jailMatch[0].trim();
            }

            parsedDatabase.laws.push({
                id: `${target.category}-${artNum}`,
                category: target.category,
                article: artNum,
                title: `Статья ${artNum} ${target.category}`,
                fullText: fullText,
                fine: fineValue,
                jail: jailValue
            });
        }
    }

    // ПРАВИЛА
    for (const target of TARGET_RULES) {
        console.log(`[PROCESS] Группировка регламента: ${target.category}`);
        const rawText = await getThreadRawText(page, target.url);
        const cleanText = sanitizeText(rawText);
        
        const lines = cleanText.split('\n').filter(line => line.trim() !== '');
        let groups = {};
        let currentGroup = null;

        for (const line of lines) {
            const lineTrim = line.trim();
            const matchPoint = lineTrim.match(/^\s*[^a-zA-Zа-яА-Я0-9]*(\d+)\.(\d+)/);
            if (matchPoint) {
                currentGroup = matchPoint[1];
                if (!groups[currentGroup]) groups[currentGroup] = [];
                groups[currentGroup].push(lineTrim);
            } else if (currentGroup) {
                if (groups[currentGroup].length > 0) {
                    groups[currentGroup][groups[currentGroup].length - 1] += '\n' + lineTrim;
                } else {
                    groups[currentGroup].push(lineTrim);
                }
            }
        }

        for (const majorNum in groups) {
            const fullGroupText = groups[majorNum].join('\n\n');
            if (fullGroupText.trim().length < 10) continue;

            parsedDatabase.rules.push({
                id: `rules-${target.category}-${majorNum}`,
                category: target.category,
                article: majorNum,
                title: `Пункт ${majorNum} | Правил ${target.category}`,
                fullText: fullGroupText.trim()
            });
        }
    }

    parsedDatabase.laws = sortDatabase(parsedDatabase.laws);
    await browser.close();
    
    fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(parsedDatabase, null, 2), 'utf-8');
    console.log(`\n[SYSTEM] Компиляция базы успешно завершена. Законов: ${parsedDatabase.laws.length}, Правил: ${parsedDatabase.rules.length}`);
}

async function getThreadRawText(page, url) {
    let currentPageUrl = url;
    let hasNextPage = true;
    let textBlocks = [];
    let pageNum = 1;

    while (hasNextPage) {
        try {
            console.log(`[PARSER] Чтение страницы ${pageNum}: ${currentPageUrl}`);
            await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await new Promise(r => setTimeout(r, 2000));

            const pageBlocks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.message-inner .message-body .bbWrapper')).map(el => el.innerText);
            });
            if (pageBlocks.length > 0) textBlocks.push(...pageBlocks);

            // Хардкодный пробив пагинации
            const nextPageUrl = await page.evaluate(() => {
                const headLink = document.querySelector('link[rel="next"]');
                if (headLink) return headLink.href;
                const nextBtn = document.querySelector('a.pageNav-next, a.pageNav-jump--next');
                return nextBtn ? nextBtn.href : null;
            });

            if (nextPageUrl && nextPageUrl !== currentPageUrl) {
                currentPageUrl = nextPageUrl;
                pageNum++;
            } else {
                hasNextPage = false;
            }
        } catch (e) {
            hasNextPage = false;
        }
    }
    return textBlocks.join('\n\n');
}

parseAll();