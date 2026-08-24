// builderView.js — P5 소형 BPE Builder 화면.
// 학습을 한 번 계산해 두고 단계별로 되짚어 보는 replay가 기본 동작이다.
import { el } from './dom.js';
import { state } from './state.js';
import {
    BPE_LIMITS,
    compareMergeCounts,
    encodeWithMerges,
    estimateTrainingScale,
    replayState,
    trainBpe,
} from './bpeTrainer.js';

const COPY = Object.freeze({
    ko: {
        tab: 'Builder',
        setupTitle: '작은 말뭉치로 BPE 만들기',
        setupNote: '작은 말뭉치에서 merge 규칙이 쌓이는 과정을 관찰하는 도구입니다. 대형 모델 학습 도구가 아니며, 아래 상한을 넘으면 계산하지 않고 거부합니다.',
        corpusLabel: '말뭉치 (공백으로 단어 구분)',
        mergesLabel: 'merge 횟수',
        lowercaseLabel: '소문자로 통일',
        specialLabel: '특수 토큰 (쉼표 구분)',
        probeLabel: '인코딩해 볼 단어',
        run: '학습 실행',
        scale: '규모 미리보기: 단어 {unique}종 · 심볼 {symbols}개 · 단계당 최대 {scans} 비교',
        limits: '상한: 말뭉치 {corpus} code points · 단어 {words}종 · merge {merges}회 · 단어 길이 {word}',
        done: 'merge {steps}회 · vocab {vocab}개 · {ms}ms · 종료 사유 {reason}',
        rejected: '거부: {code}',
        stepTitle: '단계 되짚기',
        detailTitle: '단어 분해와 인코딩',
        first: '처음', prev: '이전', next: '다음', last: '끝',
        stepOf: '{step}/{total} 단계',
        beforeStart: '아직 병합하지 않은 처음 상태입니다.',
        chosen: '선택한 쌍',
        newToken: '새 토큰',
        pairCount: '빈도',
        affected: '영향받은 단어',
        vocabSize: 'vocab 크기',
        totalSymbols: '전체 심볼 수',
        candidatesTitle: '이 단계의 후보 빈도',
        wordsTitle: '단어 분해 상태',
        colWord: '단어', colFreq: '빈도', colSymbols: '조각',
        encodeTitle: '학습한 규칙으로 인코딩',
        encodeResult: '{tokens}조각 · 적용한 merge {applied}회',
        compareTitle: 'merge 횟수에 따른 조각 수',
        colMerges: 'merge', colVocab: 'vocab', colTokens: '조각 수',
        reasons: {
            'reached-target': '요청한 횟수 도달',
            'no-pairs-left': '2회 이상 반복되는 쌍이 없음',
            'vocab-limit': 'vocab 상한 도달',
        },
        notRealtime: '이 값은 위 말뭉치를 한 번 계산한 결과이며, 큰 말뭉치의 실시간 학습 성능을 뜻하지 않습니다.',
    },
    en: {
        tab: 'Builder',
        setupTitle: 'Build a BPE from a small corpus',
        setupNote: 'A tool for watching merge rules accumulate on a small corpus. It is not a training tool for large models, and inputs beyond the limits below are refused rather than truncated.',
        corpusLabel: 'Corpus (words separated by whitespace)',
        mergesLabel: 'Merge count',
        lowercaseLabel: 'Lowercase first',
        specialLabel: 'Special tokens (comma separated)',
        probeLabel: 'Word to encode',
        run: 'Train',
        scale: 'Scale preview: {unique} unique words · {symbols} symbols · up to {scans} comparisons',
        limits: 'Limits: {corpus} code points · {words} unique words · {merges} merges · word length {word}',
        done: '{steps} merges · vocab {vocab} · {ms}ms · stopped: {reason}',
        rejected: 'Rejected: {code}',
        stepTitle: 'Step replay',
        detailTitle: 'Word splits and encoding',
        first: 'First', prev: 'Back', next: 'Next', last: 'Last',
        stepOf: 'step {step} of {total}',
        beforeStart: 'The starting state, before any merge.',
        chosen: 'Chosen pair',
        newToken: 'New token',
        pairCount: 'Count',
        affected: 'Words affected',
        vocabSize: 'Vocabulary size',
        totalSymbols: 'Total symbols',
        candidatesTitle: 'Candidate frequencies at this step',
        wordsTitle: 'Word splits',
        colWord: 'Word', colFreq: 'Freq', colSymbols: 'Pieces',
        encodeTitle: 'Encode with the learned rules',
        encodeResult: '{tokens} pieces · {applied} merges applied',
        compareTitle: 'Pieces by merge count',
        colMerges: 'Merges', colVocab: 'Vocab', colTokens: 'Pieces',
        reasons: {
            'reached-target': 'reached the requested count',
            'no-pairs-left': 'no pair repeats at least twice',
            'vocab-limit': 'vocabulary limit reached',
        },
        notRealtime: 'These numbers come from one run over the corpus above. They do not describe real-time training performance on a large corpus.',
    },
});

let training = null;
let elapsedMs = null;

function copy() {
    return COPY[state.lang] || COPY.ko;
}

function format(template, values) {
    return Object.entries(values).reduce(
        (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
        template,
    );
}

function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function metric(parent, label, value) {
    const box = element('div', 'builder-metric');
    box.append(element('span', null, label), element('strong', null, value));
    parent.append(box);
    return box;
}

function setStatus(text, kind = 'note') {
    const node = el('builderStatus');
    node.dataset.kind = kind;
    node.textContent = text;
}

function readOptions() {
    const specials = el('builderSpecialTokens').value
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token !== '');
    return {
        numMerges: Math.max(0, Number.parseInt(el('builderMerges').value, 10) || 0),
        lowercase: el('builderLowercase').checked,
        specialTokens: [...new Set(specials)],
    };
}

function renderScale() {
    const text = copy();
    const node = el('builderScale');
    try {
        const scale = estimateTrainingScale(el('builderCorpus').value, readOptions());
        node.dataset.kind = 'note';
        node.textContent = [
            format(text.scale, {
                unique: scale.uniqueWords,
                symbols: scale.initialSymbols,
                scans: scale.estimatedPairScans,
            }),
            format(text.limits, {
                corpus: BPE_LIMITS.maxCorpusCodePoints,
                words: BPE_LIMITS.maxUniqueWords,
                merges: BPE_LIMITS.maxMerges,
                word: BPE_LIMITS.maxSymbolsPerWord,
            }),
        ].join(' · ');
        el('builderCorpus').removeAttribute('aria-invalid');
    } catch (error) {
        node.dataset.kind = 'error';
        node.textContent = format(text.rejected, { code: error.code || error.message });
        el('builderCorpus').setAttribute('aria-invalid', 'true');
    }
}

function renderCandidates(step) {
    const text = copy();
    const box = clear(el('builderCandidates'));
    if (!step) return;
    box.append(element('h3', 'p1-subheading', text.candidatesTitle));

    const max = Math.max(...step.topPairs.map((entry) => entry.count));
    for (const candidate of step.topPairs) {
        const row = element('div', 'builder-candidate');
        row.dataset.chosen = String(candidate.pair[0] === step.pair[0] && candidate.pair[1] === step.pair[1]);
        row.append(element('span', 'builder-pair', `${candidate.pair[0]} + ${candidate.pair[1]}`));
        const bar = element('span', 'builder-bar');
        const fill = element('span', 'builder-bar-fill');
        fill.style.width = `${(candidate.count / max) * 100}%`;
        bar.append(fill);
        row.append(bar, element('span', 'builder-count', String(candidate.count)));
        box.append(row);
    }
}

function renderWords(replay) {
    const text = copy();
    const box = clear(el('builderWords'));
    box.append(element('h3', 'p1-subheading', text.wordsTitle));

    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const label of [text.colWord, text.colFreq, text.colSymbols]) {
        const cell = element('th', null, label);
        cell.scope = 'col';
        head.append(cell);
    }
    table.append(head);

    for (const entry of replay.words) {
        const row = document.createElement('tr');
        const name = element('th', null, entry.word);
        name.scope = 'row';
        row.append(name, element('td', 'builder-num', String(entry.frequency)));
        const pieces = element('td', 'builder-pieces');
        for (const symbol of entry.symbols) pieces.append(element('span', 'builder-piece', symbol));
        row.append(pieces);
        table.append(row);
    }
    box.append(table);
}

function renderEncode() {
    const text = copy();
    const box = clear(el('builderEncode'));
    if (!training) return;
    box.append(element('h3', 'p1-subheading', text.encodeTitle));

    const merges = training.merges.slice(0, state.builderStep);
    const encoded = encodeWithMerges(el('builderProbe').value, merges, {
        endOfWordMarker: training.options.endOfWordMarker,
        lowercase: training.options.lowercase,
    });
    const pieces = element('div', 'builder-pieces');
    for (const symbol of encoded.symbols) pieces.append(element('span', 'builder-piece', symbol));
    box.append(pieces);
    box.append(element('div', 'p1-note', format(text.encodeResult, {
        tokens: encoded.symbols.length,
        applied: encoded.applied.length,
    })));
}

function renderCompare() {
    const text = copy();
    const box = clear(el('builderCompare'));
    if (!training || training.merges.length === 0) return;
    box.append(element('h3', 'p1-subheading', text.compareTitle));

    const total = training.merges.length;
    const counts = [...new Set([0, Math.floor(total / 3), Math.floor((total * 2) / 3), total])]
        .filter((count) => count >= 0 && count <= total)
        .sort((left, right) => left - right);
    const rows = compareMergeCounts(training, el('builderProbe').value, counts);

    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const label of [text.colMerges, text.colVocab, text.colTokens, text.colSymbols]) {
        const cell = element('th', null, label);
        cell.scope = 'col';
        head.append(cell);
    }
    table.append(head);
    for (const row of rows) {
        const tr = document.createElement('tr');
        tr.append(element('td', 'builder-num', String(row.merges)));
        tr.append(element('td', 'builder-num', String(row.vocabSize)));
        tr.append(element('td', 'builder-num', String(row.tokens)));
        const pieces = element('td', 'builder-pieces');
        for (const symbol of row.symbols) pieces.append(element('span', 'builder-piece', symbol));
        tr.append(pieces);
        table.append(tr);
    }
    box.append(table);
}

function renderStep() {
    const text = copy();
    if (!training) {
        clear(el('builderStepMetrics'));
        clear(el('builderCandidates'));
        clear(el('builderWords'));
        clear(el('builderEncode'));
        clear(el('builderCompare'));
        el('builderStepCounter').textContent = '';
        return;
    }

    const total = training.merges.length;
    state.builderStep = Math.min(total, Math.max(0, state.builderStep));
    const slider = el('builderStepRange');
    slider.max = String(total);
    slider.value = String(state.builderStep);
    el('builderStepCounter').textContent = format(text.stepOf, { step: state.builderStep, total });

    el('builderFirstBtn').disabled = state.builderStep === 0;
    el('builderPrevBtn').disabled = state.builderStep === 0;
    el('builderNextBtn').disabled = state.builderStep >= total;
    el('builderLastBtn').disabled = state.builderStep >= total;

    const replay = replayState(training, state.builderStep);
    const step = state.builderStep > 0 ? training.steps[state.builderStep - 1] : null;

    const metrics = clear(el('builderStepMetrics'));
    if (step) {
        metric(metrics, text.chosen, `${step.pair[0]} + ${step.pair[1]}`);
        metric(metrics, text.newToken, step.newToken);
        metric(metrics, text.pairCount, String(step.count));
        metric(metrics, text.affected, String(step.affectedWords));
    } else {
        metrics.append(element('div', 'p1-note', text.beforeStart));
    }
    metric(metrics, text.vocabSize, String(replay.vocabSize));
    metric(metrics, text.totalSymbols, String(replay.totalSymbols));

    // 후보 빈도는 "그 단계에서 무엇 중에 골랐는지"이므로 다음 단계의 후보를 보여준다.
    renderCandidates(state.builderStep < total ? training.steps[state.builderStep] : null);
    renderWords(replay);
    renderEncode();
    renderCompare();
}

export function runBuilder() {
    const text = copy();
    try {
        const started = performance.now();
        training = trainBpe(el('builderCorpus').value, readOptions());
        elapsedMs = Math.round(performance.now() - started);
        state.builderStep = training.merges.length;
        setStatus([
            format(text.done, {
                steps: training.steps.length,
                vocab: training.vocab.length,
                ms: elapsedMs,
                reason: text.reasons[training.stoppedReason] || training.stoppedReason,
            }),
            text.notRealtime,
        ].join(' · '));
        el('builderCorpus').removeAttribute('aria-invalid');
    } catch (error) {
        training = null;
        elapsedMs = null;
        setStatus(format(text.rejected, { code: error.code || error.message }), 'error');
        el('builderCorpus').setAttribute('aria-invalid', 'true');
    }
    renderStep();
    return training;
}

export function builderTraining() {
    return training;
}

export function applyBuilderLanguage() {
    const text = copy();
    el('tabBuilder').textContent = text.tab;
    el('builderSetupTitle').textContent = text.setupTitle;
    el('builderSetupNote').textContent = text.setupNote;
    el('labelBuilderCorpus').textContent = text.corpusLabel;
    el('labelBuilderMerges').textContent = text.mergesLabel;
    el('labelBuilderLowercase').textContent = text.lowercaseLabel;
    el('labelBuilderSpecial').textContent = text.specialLabel;
    el('labelBuilderProbe').textContent = text.probeLabel;
    el('builderRunBtn').textContent = text.run;
    el('builderStepTitle').textContent = text.stepTitle;
    el('builderDetailTitle').textContent = text.detailTitle;
    el('builderFirstBtn').textContent = text.first;
    el('builderPrevBtn').textContent = text.prev;
    el('builderNextBtn').textContent = text.next;
    el('builderLastBtn').textContent = text.last;
    el('builderStepRange').setAttribute('aria-label', text.stepTitle);
    renderScale();
    renderStep();
}

export function initBuilder() {
    el('builderCorpus').value = state.builderCorpus;
    el('builderMerges').value = String(state.builderMerges);
    el('builderLowercase').checked = state.builderLowercase;
    el('builderSpecialTokens').value = state.builderSpecialTokens;
    el('builderProbe').value = state.builderProbe;

    for (const id of ['builderCorpus', 'builderMerges', 'builderLowercase', 'builderSpecialTokens']) {
        el(id).addEventListener('input', () => {
            state.builderCorpus = el('builderCorpus').value;
            state.builderMerges = readOptions().numMerges;
            state.builderLowercase = el('builderLowercase').checked;
            state.builderSpecialTokens = el('builderSpecialTokens').value;
            renderScale();
        });
        el(id).addEventListener('change', renderScale);
    }
    el('builderProbe').addEventListener('input', () => {
        state.builderProbe = el('builderProbe').value;
        renderEncode();
        renderCompare();
    });
    el('builderRunBtn').addEventListener('click', runBuilder);

    const move = (next) => {
        if (!training) return;
        state.builderStep = next;
        renderStep();
    };
    el('builderFirstBtn').addEventListener('click', () => move(0));
    el('builderPrevBtn').addEventListener('click', () => move(state.builderStep - 1));
    el('builderNextBtn').addEventListener('click', () => move(state.builderStep + 1));
    el('builderLastBtn').addEventListener('click', () => move(training ? training.merges.length : 0));
    el('builderStepRange').addEventListener('input', () => {
        move(Number.parseInt(el('builderStepRange').value, 10) || 0);
    });

    renderScale();
    renderStep();
}
