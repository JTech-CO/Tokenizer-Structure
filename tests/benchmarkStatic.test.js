import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'llm_tokenizer_simulator.html'), 'utf8');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

test('the benchmark tab and panel live inside the single main landmark', () => {
    const tabButton = html.match(/<button[^>]*id="tabBenchmark"[^>]*>/);
    assert.ok(tabButton, 'Missing the benchmark tab button');
    assert.match(tabButton[0], /role="tab"/);
    assert.match(tabButton[0], /aria-controls="benchmarkView"/);
    assert.match(html, /<div id="benchmarkView"[^>]*role="tabpanel"[^>]*aria-labelledby="tabBenchmark"/);
    assert.match(html, /href="css\/p3\.css"/);

    const container = html.slice(html.indexOf('<main id="viewContainer"'), html.indexOf('</main>'));
    assert.ok(container.includes('id="benchmarkView"'));

    for (const id of [
        'benchmarkCorpus', 'benchmarkMetric', 'benchmarkLanguages', 'benchmarkDomains',
        'benchmarkColumnChoices', 'benchmarkUserCorpus', 'benchmarkRunBtn',
        'benchmarkExportJsonBtn', 'benchmarkExportCsvBtn', 'benchmarkShareBtn', 'benchmarkStatus',
        'benchmarkTableWrap', 'benchmarkTable', 'benchmarkCaveats', 'benchmarkSummary', 'benchmarkFailures',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `Missing benchmark element: ${id}`);
    }
});

test('benchmark scroll regions stay keyboard reachable', () => {
    // aria-label을 쓰는 div는 role 없이는 aria-prohibited-attr 위반이 된다.
    assert.match(html, /id="benchmarkTableWrap"[^>]*role="group"[^>]*tabindex="0"/);
    // 요약 패널은 포커스 가능한 자식이 없어 영역 자체가 포커스를 받아야 한다.
    assert.match(html, /aria-labelledby="benchmarkSummaryTitle"[^>]*tabindex="0"/);
});

test('the presentation bar is a landmark so its content is not orphaned', () => {
    // main 밖에 두더라도 aside(complementary)면 region 규칙을 통과한다.
    assert.match(html, /<aside id="presentationBar"[^>]*aria-label="[^"]+"[^>]*hidden>/);
    assert.match(html, /id="presentationToggleBtn"[^>]*aria-pressed="false"/);
    assert.match(html, /id="presentationNotesBtn"[^>]*aria-expanded="false"[^>]*aria-controls="presentationNotes"/);
    assert.match(html, /id="presentationNotes"[^>]*role="group"[^>]*tabindex="0"/);
    for (const id of ['presentationPrevBtn', 'presentationNextBtn', 'presentationAllBtn', 'presentationResetBtn', 'presentationCounter']) {
        assert.match(html, new RegExp(`id="${id}"`), `Missing presentation control: ${id}`);
    }
});

test('the benchmark view is registered and re-rendered on view changes', () => {
    const main = read('js/main.js');
    assert.match(main, /VIEW_NAMES = new Set\(\[[^\]]*'benchmark'/);
    assert.match(main, /initBenchmark\(\{ onReveal/);
    assert.match(main, /initPresentation\(\)/);
    assert.match(main, /applyBenchmarkLanguage\(\)/);
    assert.match(main, /applyPresentationLanguage\(\)/);
    assert.match(main, /if \(name === 'benchmark'\) renderBenchmarkResult\(\);/);
    // 말뭉치 비교는 자체 표본을 쓰므로 공용 입력줄과 preset을 숨긴다.
    assert.match(main, /inputRow[^\n]*'benchmark'/);
    assert.match(main, /presetBtns[^\n]*'benchmark'/);
    // 다시 그린 DOM에서 발표 reveal 상태가 사라지지 않아야 한다.
    assert.ok((main.match(/refreshPresentation\(/g) || []).length >= 5);
});

test('the reveal attribute contract matches between CSS and the view', () => {
    const css = read('css/p3.css');
    const view = read('js/presentationView.js');
    assert.match(css, /body\.presentation \[data-reveal="hidden"\]/);
    assert.match(view, /dataset\.reveal = isRevealed\(reveal, index\) \? 'shown' : 'hidden'/);
    assert.match(css, /body\.presentation \{/);
    assert.match(view, /classList\.toggle\('presentation'/);
});

test('the benchmark uses the real adapter and never a silent heuristic fallback', () => {
    const view = read('js/benchmarkView.js');
    // tokenizeWith는 실패 시 조용히 휴리스틱으로 대체하므로 벤치마크에서 쓰면 안 된다.
    assert.doesNotMatch(view, /tokenizeWith/);
    assert.match(view, /analyze: \(tok, text, modelId, options\) => tokenizeReal\(tok, text, options\)/);

    const run = read('js/benchmarkRun.js');
    assert.match(run, /engine: 'real'|createBenchmarkResult/);
    const domain = read('js/benchmarkDomain.js');
    assert.match(domain, /benchmark columns must use the real engine/);
});

test('classroom links never carry corpus text, only identifiers', () => {
    const view = read('js/benchmarkView.js');
    const shareBlock = view.slice(view.indexOf("if (action === 'share')"), view.indexOf('setStatus(text.copied)'));
    assert.match(shareBlock, /corpusId: state\.benchmarkCorpusId/);
    assert.match(shareBlock, /benchmarkColumns: \[\.\.\.state\.benchmarkColumns\]/);
    assert.doesNotMatch(shareBlock, /text:/, 'a classroom link must not embed sample text');
    assert.doesNotMatch(shareBlock, /includeInput/);
});

test('benchmark and corpus modules perform no network requests of their own', () => {
    for (const name of ['js/corpus.js', 'js/benchmarkDomain.js', 'js/benchmarkRun.js', 'js/presentation.js']) {
        const source = read(name);
        assert.doesNotMatch(source, /\bfetch\s*\(/, `${name} must stay pure`);
        assert.doesNotMatch(source, /XMLHttpRequest|navigator\.sendBeacon|new WebSocket/, name);
        assert.doesNotMatch(source, /document\.|window\./, `${name} must not touch the DOM`);
    }
});
