// 운영 화면의 저장소 표시를 브라우저별로 확인한다.
// WebKit은 navigator.storage.estimate를 노출하지 않으므로 그 경로가 어떻게 보이는지가 핵심이다.
//
//   node operate.mjs webkit
import { chromium, firefox, webkit } from 'playwright';

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:8020';
const PAGE = `${BASE}/llm_tokenizer_simulator.html`;
const BROWSERS = { chromium, firefox, webkit };

const name = process.argv[2];
if (!BROWSERS[name]) {
    process.stderr.write('usage: node operate.mjs <chromium|firefox|webkit>\n');
    process.exit(1);
}

const browser = await BROWSERS[name].launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error && error.message).slice(0, 200)));

await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
    () => /실제 엔진|폴백/.test(document.getElementById('engineStatus').textContent),
    null,
    { timeout: 180_000 },
);

await page.evaluate(() => document.getElementById('tabOperate').click());
// 운영 화면은 cache와 manifest를 비동기로 읽으므로 표가 채워질 때까지 기다린다.
await page.waitForFunction(
    () => document.querySelectorAll('#operateArtifacts tr').length > 1,
    null,
    { timeout: 30_000 },
);
await page.waitForTimeout(800);

const before = await page.evaluate(() => ({
    storage: document.getElementById('operateStorage').innerText.replace(/\n/g, ' | '),
    rows: [...document.querySelectorAll('#operateArtifacts tr')].slice(1)
        .map((row) => `${row.cells[0].textContent.slice(0, 18)}=${row.dataset.status}`),
    freshness: document.getElementById('operateFreshness').innerText.replace(/\n/g, ' | ').slice(0, 160),
}));

// BERT를 pin해 offline 표시가 실제와 맞는지 확인한다.
await page.evaluate(() => {
    const row = [...document.querySelectorAll('#operateArtifacts tr')].find((r) => r.textContent.includes('BERT'));
    const pin = [...row.querySelectorAll('button')].find((b) => /^pin$/i.test(b.textContent.trim()));
    if (pin) pin.click();
});
await page.waitForFunction(
    () => {
        const row = [...document.querySelectorAll('#operateArtifacts tr')].find((r) => r.textContent.includes('BERT'));
        return row && (row.dataset.status === 'pinned' || row.dataset.status === 'error');
    },
    null,
    { timeout: 120_000 },
).catch(() => {});

const after = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('#operateArtifacts tr')].find((r) => r.textContent.includes('BERT'));
    const shell = typeof caches !== 'undefined' ? await caches.open('tokenizer-app-shell-v1') : null;
    const art = typeof caches !== 'undefined' ? await caches.open('transformers-cache') : null;
    const shellUrls = shell ? (await shell.keys()).map((r) => r.url) : [];
    const artUrls = art ? (await art.keys()).map((r) => r.url) : [];
    return {
        bert: row ? `${row.dataset.status} · ${row.cells[4].textContent}` : null,
        storage: document.getElementById('operateStorage').innerText.replace(/\n/g, ' | '),
        shellCount: shellUrls.length,
        artCount: artUrls.length,
        // app shell과 artifact cache가 같은 파일을 갖지 않아야 한다.
        overlap: shellUrls.filter((url) => artUrls.includes(url)).length,
    };
});

console.log(JSON.stringify({ browser: name, version: browser.version(), before, after, errors }, null, 1));
await context.close();
await browser.close();
