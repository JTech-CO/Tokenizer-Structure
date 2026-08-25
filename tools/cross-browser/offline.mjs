// 지연 로딩 view(모델 비교·입력 샘플 매트릭스)와 offline pin 동작을 브라우저별로 확인한다.
//
//   node offline.mjs firefox
//
// 이 스크립트는 artifact 6개를 모두 내려받으므로(약 90MB) verify.mjs와 분리해 둔다.
import { chromium, firefox, webkit } from 'playwright';

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:8020';
const PAGE = `${BASE}/llm_tokenizer_simulator.html`;
const BROWSERS = { chromium, firefox, webkit };
const LONG = 600_000;

const name = process.argv[2];
if (!BROWSERS[name]) {
    process.stderr.write('usage: node offline.mjs <chromium|firefox|webkit>\n');
    process.exit(1);
}

const browser = await BROWSERS[name].launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error && error.message).slice(0, 200)));

const report = { browser: name, version: browser.version() };
try {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () => /실제 엔진|폴백/.test(document.getElementById('engineStatus').textContent),
        null,
        { timeout: 180_000 },
    );

    // 1) 모델 비교: tokenizer 2개가 붙어야 결과가 나온다.
    await page.evaluate(() => document.getElementById('tabCompare').click());
    await page.waitForFunction(
        () => document.querySelectorAll('#cmpSubA .token-badge').length > 0
            && document.querySelectorAll('#cmpSubB .token-badge').length > 0,
        null,
        { timeout: LONG },
    );
    report.compare = await page.evaluate(() => ({
        a: document.getElementById('cmpEffA').textContent.trim().slice(0, 70),
        b: document.getElementById('cmpEffB').textContent.trim().slice(0, 70),
        diff: document.getElementById('compareDiff').textContent.trim().slice(0, 70),
    }));

    // 2) 입력 샘플 매트릭스: artifact 6개를 모두 받는다.
    await page.evaluate(() => document.getElementById('tabMatrix').click());
    await page.waitForFunction(
        () => document.querySelectorAll('#matrixTable tbody tr').length >= 7,
        null,
        { timeout: LONG },
    );
    report.matrix = await page.evaluate(() => ({
        rows: document.querySelectorAll('#matrixTable tbody tr').length,
        columns: document.querySelectorAll('#matrixTable thead th').length,
        unavailableCells: document.querySelectorAll('#matrixTable .matrix-unavailable').length,
        status: document.getElementById('matrixStatus').textContent.trim().slice(0, 80),
    }));

    // 3) offline: pin한 artifact가 네트워크 없이 동작하는지
    report.offline = await page.evaluate(async () => {
        const { loadTokenizer, disposeTokenizer } = await import('./js/tokenizer.js');
        const { getCacheManager } = await import('./js/operateView.js');
        const id = 'Xenova/bert-base-multilingual-cased';
        const revision = '17016e764a76e30ed904bc251df4510f27b7f23f';
        const files = ['tokenizer.json', 'tokenizer_config.json']
            .map((file) => `https://huggingface.co/${id}/resolve/${revision}/${file}`);

        const pinned = await getCacheManager().pin({ id, revision, files, expectedBytes: 3_915_328 });
        disposeTokenizer(id);

        const realFetch = window.fetch;
        let blocked = 0;
        window.fetch = (input, init) => {
            const url = typeof input === 'string' ? input : input.url;
            if (url.includes('huggingface.co')) {
                blocked += 1;
                return Promise.reject(new TypeError('offline (simulated)'));
            }
            return realFetch(input, init);
        };
        let tokens = null;
        let error = null;
        try {
            const tok = await loadTokenizer(id);
            const encoded = tok('안녕 hello', { add_special_tokens: true, return_tensor: false });
            const ids = Array.isArray(encoded.input_ids[0]) ? encoded.input_ids[0] : encoded.input_ids;
            tokens = ids.length;
        } catch (failure) {
            error = String(failure && failure.message).slice(0, 120);
        }
        window.fetch = realFetch;
        // 차단된 호출이 0이면 네트워크를 시도조차 하지 않고 cache에서 읽었다는 뜻이다.
        return { pinned: pinned.ok, status: pinned.entry ? pinned.entry.status : null, blockedCalls: blocked, tokens, error };
    });
} catch (failure) {
    report.fatal = String((failure && failure.message) || failure).slice(0, 300);
}

report.errors = errors;
console.log(JSON.stringify(report, null, 1));
await context.close();
await browser.close();
