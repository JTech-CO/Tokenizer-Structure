// Chromium / Firefox / WebKit 교차 브라우저 검증.
//
// Playwright는 이 저장소의 의존성이 아니다. 별도 위치에 설치해 실행한다.
// 절차는 tools/cross-browser/README.md 참고.
//
//   node verify.mjs            # 세 엔진 모두
//   node verify.mjs firefox    # 하나만
import { chromium, firefox, webkit } from 'playwright';

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:8020';
const PAGE = `${BASE}/llm_tokenizer_simulator.html`;
const ENGINE_TIMEOUT = 180_000;

const BROWSERS = [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
];

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function runAxe(page) {
    return page.evaluate(async (tags) => {
        const result = await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
        return {
            violations: result.violations.map((item) => ({
                id: item.id,
                impact: item.impact,
                nodes: item.nodes.length,
                targets: item.nodes.slice(0, 2).map((node) => node.target.join(' ')),
            })),
            incomplete: result.incomplete.map((item) => `${item.id}:${item.nodes.length}`),
        };
    }, AXE_TAGS);
}

async function sweepViews(page, { withAxe = true } = {}) {
    const labels = await page.$$eval('[role="tab"]', (tabs) => tabs.map((tab) => tab.textContent.trim()));
    const results = [];
    for (const [index, label] of labels.entries()) {
        await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(), index);
        await page.waitForTimeout(700);
        const info = await page.evaluate(() => {
            const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
            return {
                panel: panel ? panel.id : null,
                textLength: panel ? panel.innerText.trim().length : 0,
                scrollWidth: document.documentElement.scrollWidth,
            };
        });
        results.push({ label, ...info, ...(withAxe ? await runAxe(page) : {}) });
    }
    return results;
}

async function verify(name, launcher) {
    const browser = await launcher.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    const badResponses = [];
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
    });
    page.on('pageerror', (error) => pageErrors.push(String(error && error.message).slice(0, 200)));
    page.on('response', (response) => {
        if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url().slice(0, 120)}`);
    });

    const report = { browser: name, version: browser.version() };

    try {
        await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // 1) 실제 엔진이 붙을 때까지 기다린다. 폴백으로 떨어지면 그대로 기록한다.
        //    Playwright 시그니처는 (fn, arg, options)이므로 timeout은 세 번째 인자다.
        await page.waitForFunction(
            () => {
                const status = document.getElementById('engineStatus');
                return status && /실제 엔진|Real engine|폴백|fallback/i.test(status.textContent);
            },
            null,
            { timeout: ENGINE_TIMEOUT },
        );
        report.engine = await page.$eval('#engineStatus', (node) => node.textContent.trim());
        report.pipeline = await page.$eval('#tokenCount', (node) => node.textContent.trim());

        // 2) 플랫폼 기능 지원 현황
        report.platform = await page.evaluate(() => ({
            intlSegmenter: typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function',
            objectHasOwn: typeof Object.hasOwn === 'function',
            atMethod: typeof Array.prototype.at === 'function',
            caches: typeof caches !== 'undefined',
            indexedDB: typeof indexedDB !== 'undefined',
            serviceWorker: 'serviceWorker' in navigator,
            secureContext: window.isSecureContext,
            subtleCrypto: Boolean(globalThis.crypto && globalThis.crypto.subtle),
            storageEstimate: Boolean(navigator.storage && navigator.storage.estimate),
            moduleWorker: (() => {
                try {
                    let supported = false;
                    const url = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
                    const worker = new Worker(url, { get type() { supported = true; return 'module'; } });
                    worker.terminate();
                    URL.revokeObjectURL(url);
                    return supported;
                } catch { return false; }
            })(),
        }));

        // 3) Unicode 측정이 브라우저별로 무엇을 보고하는지
        report.unicode = await page.evaluate(async () => {
            const { measureText } = await import('./js/unicodeMetrics.js');
            const metrics = measureText('한글 A🤗');
            return {
                codePoints: metrics.codePoints,
                utf8Bytes: metrics.utf8Bytes,
                graphemes: metrics.graphemes,
                graphemesUnavailableReason: metrics.graphemesUnavailableReason,
            };
        });

        // 4) axe 주입 (저장소 의존성이 아니라 임시 폴더에서 서빙한다)
        await page.addScriptTag({ url: `${BASE}/_axe_tmp/axe.min.js` });

        // 5) Builder: 네트워크가 필요 없는 순수 JS 경로
        await page.evaluate(() => document.getElementById('tabBuilder').click());
        await page.waitForTimeout(500);
        await page.evaluate(() => document.getElementById('builderRunBtn').click());
        await page.waitForTimeout(1200);
        report.builder = await page.evaluate(() => ({
            status: document.getElementById('builderStatus').textContent.slice(0, 120),
            counter: document.getElementById('builderStepCounter').textContent,
            metrics: document.getElementById('builderStepMetrics').innerText.replace(/\n/g, ' | ').slice(0, 120),
        }));

        // 6) Request Lab: chat template 능력 판정
        await page.evaluate(() => document.getElementById('tabRequest').click());
        await page.waitForTimeout(900);
        report.requestLab = await page.evaluate(() => ({
            overhead: document.getElementById('requestOverhead').innerText.replace(/\n/g, ' | ').slice(0, 140),
            provider: document.getElementById('requestProviderSlots').innerText.replace(/\n/g, ' | ').slice(0, 90),
        }));

        // 7) Inspector: 실제 결과 계약
        await page.evaluate(() => document.getElementById('tabInspector').click());
        await page.waitForTimeout(900);
        report.inspector = await page.evaluate(() => ({
            summary: document.getElementById('inspectorSummary')
                ? document.getElementById('inspectorSummary').innerText.replace(/\n/g, ' | ').slice(0, 140)
                : null,
            tokenRows: document.querySelectorAll('#inspectorTokenRows tr').length,
        }));

        // 8) 말뭉치 비교: 실제 artifact 2개
        await page.evaluate(async () => {
            document.getElementById('tabBenchmark').click();
            const wanted = new Set(['Xenova/gpt-4o', 'Xenova/bert-base-multilingual-cased']);
            // change 이벤트마다 목록이 다시 그려지므로 클릭할 때마다 다시 찾는다.
            for (let guard = 0; guard < 20; guard += 1) {
                const boxes = [...document.querySelectorAll('#benchmarkColumnChoices input')];
                const target = boxes.find((box) => box.checked !== wanted.has(box.value) && !box.disabled);
                if (!target) break;
                target.click();
                await new Promise((done) => setTimeout(done, 60));
            }
        });
        await page.waitForTimeout(600);
        await page.evaluate(() => document.getElementById('benchmarkRunBtn').click());
        await page.waitForFunction(
            () => /성공|succeeded|오류|could not/.test(document.getElementById('benchmarkStatus').textContent),
            null,
            { timeout: ENGINE_TIMEOUT },
        );
        report.benchmark = await page.evaluate(() => ({
            status: document.getElementById('benchmarkStatus').textContent.slice(0, 90),
            summary: document.getElementById('benchmarkSummary').innerText.replace(/\n/g, ' | ').slice(0, 200),
        }));

        // 9) 전체 view 훑기는 벤치마크 뒤에 한다.
        //    입력 샘플 매트릭스가 artifact 6개를 동시에 받기 시작하면 벤치마크가 대역폭에 굶는다.
        report.desktop = await sweepViews(page);

        // 10) Service Worker
        await page.waitForTimeout(1500);
        report.serviceWorker = await page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return { supported: false };
            const registration = await navigator.serviceWorker.getRegistration();
            return {
                supported: true,
                registered: Boolean(registration),
                active: Boolean(registration && registration.active),
                scope: registration ? registration.scope : null,
                caches: typeof caches !== 'undefined' ? await caches.keys() : null,
            };
        });

        // 11) 320px reflow
        await page.setViewportSize({ width: 320, height: 720 });
        await page.waitForTimeout(700);
        report.mobile = await sweepViews(page);

        // 12) 영어 전환
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(400);
        await page.evaluate(() => document.getElementById('langToggleBtn').click());
        await page.waitForTimeout(1600);
        report.english = await sweepViews(page);
    } catch (error) {
        report.fatal = String((error && error.message) || error).slice(0, 400);
    }

    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    report.badResponses = badResponses;

    await context.close();
    await browser.close();
    return report;
}

const only = process.argv[2];
const targets = only ? BROWSERS.filter(([name]) => name === only) : BROWSERS;
const results = [];
for (const [name, launcher] of targets) {
    process.stderr.write(`running ${name}…\n`);
    results.push(await verify(name, launcher));
}
console.log(JSON.stringify(results, null, 1));
