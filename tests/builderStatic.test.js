import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BPE_LIMITS, trainBpe } from '../js/bpeTrainer.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'llm_tokenizer_simulator.html'), 'utf8');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

test('the builder tab and panel live inside the single main landmark', () => {
    const tabButton = html.match(/<button[^>]*id="tabBuilder"[^>]*>/);
    assert.ok(tabButton, 'Missing the builder tab button');
    assert.match(tabButton[0], /role="tab"/);
    assert.match(tabButton[0], /aria-controls="builderView"/);
    assert.match(html, /<div id="builderView"[^>]*role="tabpanel"[^>]*aria-labelledby="tabBuilder"/);
    assert.match(html, /href="css\/p5\.css"/);

    const container = html.slice(html.indexOf('<main id="viewContainer"'), html.indexOf('</main>'));
    assert.ok(container.includes('id="builderView"'));

    for (const id of [
        'builderCorpus', 'builderMerges', 'builderLowercase', 'builderSpecialTokens', 'builderProbe',
        'builderRunBtn', 'builderScale', 'builderStatus',
        'builderFirstBtn', 'builderPrevBtn', 'builderNextBtn', 'builderLastBtn',
        'builderStepRange', 'builderStepCounter', 'builderStepMetrics',
        'builderCandidates', 'builderWords', 'builderEncode', 'builderCompare',
        'builderDetailTitle',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `Missing builder element: ${id}`);
    }
});

test('the two builder panels do not share one landmark name', () => {
    // 같은 이름의 region이 둘이면 axe landmark-unique 위반이 난다.
    const labels = [...html.matchAll(/<section[^>]*aria-labelledby="(builder[^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(labels).size, labels.length, `duplicate landmark names: ${labels.join(', ')}`);
    assert.ok(labels.length >= 2);
});

test('the builder view is registered and wired into the app', () => {
    const main = read('js/main.js');
    assert.match(main, /VIEW_NAMES = new Set\(\[[^\]]*'builder'/);
    assert.match(main, /initBuilder\(\)/);
    assert.match(main, /applyBuilderLanguage\(\)/);
    // Builder는 자체 말뭉치를 쓰므로 공용 입력줄과 preset을 숨긴다.
    assert.match(main, /inputRow[^\n]*'builder'/);
    assert.match(main, /presetBtns[^\n]*'builder'/);
});

test('the trainer stays a pure module with no DOM or network access', () => {
    const trainer = read('js/bpeTrainer.js');
    assert.doesNotMatch(trainer, /document\.|window\./, 'the trainer must stay pure');
    assert.doesNotMatch(trainer, /\bfetch\s*\(/);
    assert.doesNotMatch(trainer, /XMLHttpRequest|new WebSocket|new Worker/);
    assert.doesNotMatch(trainer, /\bnew Function\b|\beval\s*\(/);
    // 무한 학습을 막는 상한이 코드에 있어야 한다.
    for (const limit of ['maxCorpusCodePoints', 'maxUniqueWords', 'maxMerges', 'maxSymbolsPerWord', 'maxVocab']) {
        assert.match(trainer, new RegExp(limit), `missing limit: ${limit}`);
    }
});

test('the view never promises real-time training on large corpora', () => {
    const view = read('js/builderView.js');
    // 규모를 먼저 보여주고, 끝난 뒤 실제 소요 시간과 한계를 함께 표시한다.
    assert.match(view, /estimateTrainingScale/);
    assert.match(view, /notRealtime/);
    assert.match(view, /performance\.now\(\)/);
    assert.match(view, /대형 모델 학습 도구가 아니며/);
    assert.match(view, /not a training tool for large models/);
});

test('the default corpus stays inside the stated limits', () => {
    const stateSource = read('js/state.js');
    const corpus = stateSource.match(/builderCorpus: '([^']+)'/)[1];
    assert.ok([...corpus].length <= BPE_LIMITS.maxCorpusCodePoints);

    // 기본값은 실제로 학습이 되고 관찰할 merge가 남아야 한다.
    const training = trainBpe(corpus, { numMerges: 20 });
    assert.ok(training.steps.length >= 5, 'the default corpus must produce merges to look at');
    assert.ok(training.merges.length > 0);
});

test('the builder assets are precached by the service worker', () => {
    const sw = read('sw.js');
    for (const path of ['js/bpeTrainer.js', 'js/builderView.js', 'css/p5.css']) {
        assert.ok(sw.includes(`'${path}'`), `sw.js is missing ${path}`);
    }
});
