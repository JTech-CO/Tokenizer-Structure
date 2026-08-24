// benchmarkView.js — P3 말뭉치 비교 화면. 실패 항목은 색·평균·순위 어디에도 넣지 않는다.
import { el } from './dom.js';
import { state } from './state.js';
import { MODELS } from './artifacts.js';
import { loadTokenizer, tokenizeReal } from './tokenizer.js';
import {
    BUILTIN_CORPORA,
    corpusDomains,
    corpusLanguages,
    filterCorpus,
    findCorpus,
    parseCorpusLines,
} from './corpus.js';
import {
    BENCHMARK_COLUMN_LIMITS,
    BENCHMARK_METRICS,
    benchmarkCaveats,
    rowScale,
    serializeBenchmarkCsv,
    serializeBenchmarkJson,
    summarizeBenchmark,
} from './benchmarkDomain.js';
import { BENCHMARK_RUN_OUTCOMES, BenchmarkRunner } from './benchmarkRun.js';
import { encodeShareState } from './inspectorDomain.js';

const COPY = Object.freeze({
    ko: {
        tab: '말뭉치 비교',
        setupTitle: '말뭉치와 비교 열',
        setupNote: '고정 revision artifact 2~4개를 같은 조건으로 비교합니다. 실패한 항목은 평균·순위·색상에서 제외합니다.',
        corpus: '말뭉치', metric: '지표', languages: '언어 필터', domains: '도메인 필터',
        columnsTitle: '비교 열 (2~4개)',
        userCorpusLabel: '사용자 문장 (한 줄에 하나, 선택적 [언어,도메인] 접두사)',
        run: '실행', running: '실행 중', exportJson: 'JSON 저장', exportCsv: 'CSV 저장', share: '수업 링크 복사',
        tableTitle: '표본별 결과', summaryTitle: '열별 분포와 순위',
        sample: '표본', codePoints: 'cp', bytes: 'B',
        colColumn: '열', colN: 'n', colFailed: '실패', colMean: '평균', colMedian: '중앙값', colP50: 'p50', colP95: 'p95',
        colMin: '최소', colMax: '최대',
        comparable: '비교 가능 부분집합',
        comparableNote: '{count}/{total} 표본에서 성공한 열이 모두 결과를 냈습니다. 순위는 이 부분집합에서만 계산합니다.',
        ranking: '{metric} 평균 오름차순',
        failuresTitle: '실패한 항목',
        failedColumn: '열 전체 실패',
        noResult: '아직 실행하지 않았습니다.',
        needColumns: '비교 열을 2~4개 선택하세요.',
        needSamples: '필터 결과에 표본이 없습니다.',
        stale: '더 새로운 실행이 시작되어 이 결과는 버렸습니다.',
        progress: '{completed}/{total} 단계',
        done: '{ok}/{total} 셀 성공 · run {runId}',
        downloaded: '파일을 저장했습니다.', copied: '클립보드에 복사했습니다.', failed: '작업을 완료하지 못했습니다.',
        optionsNote: '적용 옵션: {options}',
        metrics: {
            tokens: '토큰 수', codePointsPerToken: 'cp/토큰',
            bytesPerToken: 'byte/토큰', contextShare: '컨텍스트 점유율',
        },
        caveats: {
            'small-sample-not-language-ranking': '이 보고서는 표본 {n}개만 비교합니다. 언어·문자·모델의 일반적 우열을 뜻하지 않습니다.',
            'token-count-is-not-quality': '토큰 수가 적다고 생성 품질·추론·언어 능력이 더 좋다는 근거가 되지 않습니다.',
            'context-share-uses-artifact-window': '컨텍스트 점유율은 고정 artifact의 컨텍스트 창 기준이며 제공사 API 한도가 아닙니다.',
            'partial-failure-excluded': '실패한 항목은 평균과 순위에서 제외했습니다.',
        },
    },
    en: {
        tab: 'Corpus benchmark',
        setupTitle: 'Corpus and columns',
        setupNote: 'Compare 2 to 4 pinned artifacts under identical options. Failed items are excluded from averages, ranking, and colour.',
        corpus: 'Corpus', metric: 'Metric', languages: 'Language filter', domains: 'Domain filter',
        columnsTitle: 'Comparison columns (2 to 4)',
        userCorpusLabel: 'User samples (one per line, optional [language,domain] prefix)',
        run: 'Run', running: 'Running', exportJson: 'Save JSON', exportCsv: 'Save CSV', share: 'Copy classroom link',
        tableTitle: 'Per-sample results', summaryTitle: 'Distribution and ranking',
        sample: 'Sample', codePoints: 'cp', bytes: 'B',
        colColumn: 'Column', colN: 'n', colFailed: 'failed', colMean: 'mean', colMedian: 'median', colP50: 'p50', colP95: 'p95',
        colMin: 'min', colMax: 'max',
        comparable: 'Comparable subset',
        comparableNote: 'Every successful column produced a result for {count} of {total} samples. Ranking uses only that subset.',
        ranking: '{metric}, mean ascending',
        failuresTitle: 'Failed items',
        failedColumn: 'whole column failed',
        noResult: 'Not run yet.',
        needColumns: 'Select 2 to 4 comparison columns.',
        needSamples: 'The filters leave no samples.',
        stale: 'A newer run started, so this result was discarded.',
        progress: '{completed}/{total} steps',
        done: '{ok}/{total} cells succeeded · run {runId}',
        downloaded: 'Saved the file.', copied: 'Copied to the clipboard.', failed: 'The action could not be completed.',
        optionsNote: 'Applied options: {options}',
        metrics: {
            tokens: 'Tokens', codePointsPerToken: 'cp/token',
            bytesPerToken: 'bytes/token', contextShare: 'Context share',
        },
        caveats: {
            'small-sample-not-language-ranking': 'This report compares {n} sample(s). It does not rank languages, scripts, or models in general.',
            'token-count-is-not-quality': 'Fewer tokens is not evidence of better generation quality, reasoning, or language ability.',
            'context-share-uses-artifact-window': 'Context share uses the pinned artifact context window, not a provider API limit.',
            'partial-failure-excluded': 'Failed items are excluded from averages and ranking.',
        },
    },
});

let runner = null;
let lastResult = null;
let onRevealChange = null;

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

function setStatus(text, kind = 'note') {
    const node = el('benchmarkStatus');
    node.dataset.kind = kind;
    node.textContent = text;
}

function shortLabel(label) {
    return label.replace(/\s*·.*$/, '');
}

function formatMetric(value, metric) {
    if (value === null || value === undefined) return '—';
    if (metric === 'tokens') return String(value);
    if (metric === 'contextShare') return `${(value * 100).toFixed(3)}%`;
    return value.toFixed(2);
}

// 행 안에서만 상대 비교하는 색. 적을수록 초록, 많을수록 빨강.
function cellColor(value, scale) {
    if (!scale || scale.max === scale.min) return 'hsl(90, 60%, 88%)';
    const t = (value - scale.min) / (scale.max - scale.min);
    return `hsl(${(1 - t) * 120}, 65%, 84%)`;
}

// ── 설정 ────────────────────────────────────────────────────────────────────

function activeCorpus() {
    const userText = el('benchmarkUserCorpus').value.trim();
    if (state.benchmarkCorpusId === 'user') {
        return parseCorpusLines(userText, { id: 'user-corpus', name: 'User corpus' });
    }
    return findCorpus(state.benchmarkCorpusId) || BUILTIN_CORPORA[0];
}

function selectedValues(select) {
    return [...select.selectedOptions].map((option) => option.value);
}

function buildCorpusSelect() {
    const select = clear(el('benchmarkCorpus'));
    for (const corpus of BUILTIN_CORPORA) {
        const option = document.createElement('option');
        option.value = corpus.id;
        option.textContent = corpus.name;
        select.append(option);
    }
    const user = document.createElement('option');
    user.value = 'user';
    user.textContent = copy().userCorpusLabel.split('(')[0].trim();
    select.append(user);
    select.value = state.benchmarkCorpusId;
}

function buildMetricSelect() {
    const select = clear(el('benchmarkMetric'));
    for (const metric of BENCHMARK_METRICS) {
        const option = document.createElement('option');
        option.value = metric;
        option.textContent = copy().metrics[metric];
        select.append(option);
    }
    select.value = state.benchmarkMetric;
}

function buildFilters() {
    let corpus;
    try {
        corpus = activeCorpus();
    } catch {
        return;
    }
    for (const [id, values, selected] of [
        ['benchmarkLanguages', corpusLanguages(corpus), state.benchmarkLanguages],
        ['benchmarkDomains', corpusDomains(corpus), state.benchmarkDomains],
    ]) {
        const select = clear(el(id));
        for (const value of values) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            option.selected = selected === null || selected.includes(value);
            select.append(option);
        }
    }
}

function buildColumnChoices() {
    const box = clear(el('benchmarkColumnChoices'));
    for (const model of MODELS) {
        const label = element('label', 'benchmark-column-choice');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = model.id;
        input.checked = state.benchmarkColumns.includes(model.id);
        input.disabled = !input.checked && state.benchmarkColumns.length >= BENCHMARK_COLUMN_LIMITS.max;
        input.addEventListener('change', () => {
            const next = input.checked
                ? [...state.benchmarkColumns, model.id]
                : state.benchmarkColumns.filter((id) => id !== model.id);
            state.benchmarkColumns = next;
            buildColumnChoices();
        });
        label.append(input, element('span', null, shortLabel(model.label)));
        box.append(label);
    }
}

// ── 실행 ────────────────────────────────────────────────────────────────────

function ensureRunner() {
    if (runner) return runner;
    runner = new BenchmarkRunner({
        loadTokenizer,
        // 단일 pipeline과 같은 실제 어댑터를 쓰고, 실패는 폴백으로 감추지 않고 그대로 던진다.
        analyze: (tok, text, modelId, options) => tokenizeReal(tok, text, options),
    });
    return runner;
}

export async function runBenchmark() {
    const text = copy();
    if (state.benchmarkColumns.length < BENCHMARK_COLUMN_LIMITS.min
        || state.benchmarkColumns.length > BENCHMARK_COLUMN_LIMITS.max) {
        setStatus(text.needColumns, 'error');
        return null;
    }

    let corpus;
    try {
        corpus = filterCorpus(activeCorpus(), {
            languages: state.benchmarkLanguages,
            domains: state.benchmarkDomains,
        });
    } catch (error) {
        setStatus(error.message, 'error');
        el('benchmarkUserCorpus').setAttribute('aria-invalid', 'true');
        return null;
    }
    el('benchmarkUserCorpus').removeAttribute('aria-invalid');
    if (corpus.samples.length === 0) {
        setStatus(text.needSamples, 'error');
        return null;
    }

    const columns = state.benchmarkColumns.map((modelId) => {
        const model = MODELS.find((item) => item.id === modelId);
        return {
            modelId,
            label: shortLabel(model.label),
            revision: model.revision,
            contextWindow: model.context,
        };
    });

    el('benchmarkRunBtn').disabled = true;
    setStatus(text.running);
    try {
        const outcome = await ensureRunner().run({
            corpus,
            columns,
            options: { ...state.analysisOptions },
            onProgress: ({ completed, total }) => setStatus(format(text.progress, { completed, total })),
        });
        if (outcome.outcome === BENCHMARK_RUN_OUTCOMES.STALE) {
            setStatus(text.stale);
            return null;
        }
        lastResult = outcome.result;
        renderBenchmarkResult();
        const ok = lastResult.cells.filter((cell) => cell.status === 'ok').length;
        setStatus([
            format(text.done, { ok, total: lastResult.cells.length, runId: lastResult.runId }),
            format(text.optionsNote, { options: JSON.stringify(lastResult.options) }),
        ].join(' · '));
        return lastResult;
    } catch (error) {
        setStatus(`${text.failed} ${error.message}`, 'error');
        return null;
    } finally {
        el('benchmarkRunBtn').disabled = false;
    }
}

// ── 렌더링 ──────────────────────────────────────────────────────────────────

function renderTable(result, summary) {
    const text = copy();
    const table = clear(el('benchmarkTable'));
    const metric = state.benchmarkMetric;
    const index = new Map(result.cells.map((cell) => [`${cell.sampleId} ${cell.modelId}`, cell]));

    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const sampleHeader = element('th', null, text.sample);
    sampleHeader.scope = 'col';
    headRow.append(sampleHeader);
    for (const column of result.columns) {
        const cell = element('th', column.status === 'failed' ? 'benchmark-failed' : null, column.label);
        cell.scope = 'col';
        if (column.status === 'failed') cell.title = `${text.failedColumn}: ${column.failure.code}`;
        headRow.append(cell);
    }
    head.append(headRow);
    table.append(head);

    const body = document.createElement('tbody');
    result.corpus.samples.forEach((sample, rowIndex) => {
        const row = document.createElement('tr');
        row.dataset.revealIndex = String(rowIndex);
        const header = element('th', 'benchmark-sample', sample.id);
        header.scope = 'row';
        header.append(element('span', 'benchmark-tag', `${sample.language} · ${sample.domain}`));
        header.append(element('span', 'benchmark-tag', `${sample.codePointLength}${text.codePoints}`));
        row.append(header);

        const scale = rowScale(result, sample.id, metric);
        for (const column of result.columns) {
            const cell = index.get(`${sample.id} ${column.modelId}`);
            if (cell.status !== 'ok' || cell.metrics[metric] === null) {
                const failedCell = element('td', 'benchmark-cell benchmark-failed', '—');
                const reason = cell.status === 'ok' ? 'metric-unavailable' : cell.failure.code;
                failedCell.title = `${column.label}: ${reason}`;
                failedCell.setAttribute('aria-label', `${column.label}: ${reason}`);
                row.append(failedCell);
                continue;
            }
            const value = cell.metrics[metric];
            const node = element('td', 'benchmark-cell', formatMetric(value, metric));
            node.style.backgroundColor = cellColor(value, scale);
            row.append(node);
        }
        body.append(row);
    });
    table.append(body);

    const caveatBox = clear(el('benchmarkCaveats'));
    caveatBox.append(element('strong', null, text.comparable));
    caveatBox.append(element('div', null, format(text.comparableNote, {
        count: summary.comparable.sampleCount,
        total: result.corpus.sampleIds.length,
    })));
    const list = document.createElement('ul');
    for (const caveat of benchmarkCaveats(result)) {
        const localized = text.caveats[caveat.code];
        list.append(element('li', null, localized
            ? format(localized, { n: result.corpus.sampleIds.length })
            : caveat.text));
    }
    caveatBox.append(list);
}

function renderSummary(result, summary) {
    const text = copy();
    const box = clear(el('benchmarkSummary'));
    const metric = state.benchmarkMetric;

    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of [text.colColumn, text.colN, text.colFailed, text.colMean, text.colMedian, text.colP50, text.colP95, text.colMin, text.colMax]) {
        const cell = element('th', null, label);
        cell.scope = 'col';
        headRow.append(cell);
    }
    head.append(headRow);
    table.append(head);

    const body = document.createElement('tbody');
    for (const column of result.columns) {
        const entry = summary.perColumn[column.modelId];
        const row = document.createElement('tr');
        row.dataset.status = column.status;
        const rowHeader = element('th', null, column.label);
        rowHeader.scope = 'row';
        row.append(rowHeader);
        row.append(element('td', null, String(entry.ok)));
        row.append(element('td', null, String(entry.failed)));
        const series = entry.metrics ? entry.metrics[metric] : null;
        for (const key of ['mean', 'median', 'p50', 'p95', 'min', 'max']) {
            row.append(element('td', null, series ? formatMetric(series[key], metric) : '—'));
        }
        body.append(row);
    }
    table.append(body);
    box.append(table);

    const rank = element('div', 'benchmark-rank');
    rank.append(element('strong', null, format(text.ranking, { metric: text.metrics[metric] })));
    const list = document.createElement('ol');
    for (const modelId of summary.comparable.ranking[metric] || []) {
        const column = result.columns.find((item) => item.modelId === modelId);
        const series = summary.comparable.columns[modelId]?.[metric] || null;
        list.append(element('li', null, `${column.label} — ${series ? formatMetric(series.mean, metric) : '—'}`));
    }
    rank.append(list);
    box.append(rank);

    const failures = clear(el('benchmarkFailures'));
    const failedCells = result.cells.filter((cell) => cell.status === 'failed');
    if (failedCells.length === 0 && summary.excludedSamples.length === 0) return;
    failures.append(element('strong', null, text.failuresTitle));
    const failureList = document.createElement('ul');
    for (const column of result.columns.filter((item) => item.status === 'failed')) {
        failureList.append(element('li', null, `${column.label} — ${text.failedColumn} (${column.failure.code})`));
    }
    for (const cell of failedCells) {
        const column = result.columns.find((item) => item.modelId === cell.modelId);
        if (column.status === 'failed') continue;
        failureList.append(element('li', null, `${cell.sampleId} × ${column.label} — ${cell.failure.code}`));
    }
    failures.append(failureList);
}

export function renderBenchmarkResult() {
    if (!lastResult) {
        clear(el('benchmarkTable'));
        clear(el('benchmarkSummary'));
        clear(el('benchmarkCaveats'));
        clear(el('benchmarkFailures'));
        setStatus(copy().noResult);
        if (onRevealChange) onRevealChange(0);
        return null;
    }
    const summary = summarizeBenchmark(lastResult);
    renderTable(lastResult, summary);
    renderSummary(lastResult, summary);
    if (onRevealChange) onRevealChange(lastResult.corpus.samples.length);
    return lastResult;
}

export function benchmarkResult() {
    return lastResult;
}

export function benchmarkRevealTargets() {
    return [...el('benchmarkTable').querySelectorAll('tbody tr[data-reveal-index]')];
}

// ── 동작 ────────────────────────────────────────────────────────────────────

function downloadText(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function copyText(value) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard API unavailable');
}

async function runAction(action) {
    const text = copy();
    try {
        if (action === 'share') {
            // 수업 링크는 원문을 담지 않는다. 말뭉치는 id로만 복원한다.
            const query = encodeShareState({
                view: 'benchmark',
                lang: state.lang,
                corpusId: state.benchmarkCorpusId,
                benchmarkColumns: [...state.benchmarkColumns],
                benchmarkMetric: state.benchmarkMetric,
                presentation: state.presentationOn,
            });
            await copyText(`${window.location.origin}${window.location.pathname}?${query}`);
            setStatus(text.copied);
            return;
        }
        if (!lastResult) {
            setStatus(text.noResult, 'error');
            return;
        }
        if (action === 'json') {
            downloadText('tokenizer-benchmark.json', serializeBenchmarkJson(lastResult), 'application/json;charset=utf-8');
        } else {
            downloadText('tokenizer-benchmark.csv', serializeBenchmarkCsv(lastResult), 'text/csv;charset=utf-8');
        }
        setStatus(text.downloaded);
    } catch (error) {
        setStatus(`${text.failed} ${error.message}`, 'error');
    }
}

/** 보고서용 영어 원문 대신 화면 언어로 된 문구를 돌려준다. */
export function localizeBenchmarkNote(code, fallbackText, values = {}) {
    const localized = copy().caveats[code];
    return localized ? format(localized, values) : fallbackText;
}

export function applyBenchmarkLanguage() {
    const text = copy();
    el('tabBenchmark').textContent = text.tab;
    el('benchmarkSetupTitle').textContent = text.setupTitle;
    el('benchmarkSetupNote').textContent = text.setupNote;
    el('labelBenchmarkCorpus').textContent = text.corpus;
    el('labelBenchmarkMetric').textContent = text.metric;
    el('labelBenchmarkLanguages').textContent = text.languages;
    el('labelBenchmarkDomains').textContent = text.domains;
    el('benchmarkColumnsTitle').textContent = text.columnsTitle;
    el('labelBenchmarkUserCorpus').textContent = text.userCorpusLabel;
    el('benchmarkRunBtn').textContent = text.run;
    el('benchmarkExportJsonBtn').textContent = text.exportJson;
    el('benchmarkExportCsvBtn').textContent = text.exportCsv;
    el('benchmarkShareBtn').textContent = text.share;
    el('benchmarkTableTitle').textContent = text.tableTitle;
    el('benchmarkSummaryTitle').textContent = text.summaryTitle;
    buildCorpusSelect();
    buildMetricSelect();
    buildFilters();
    buildColumnChoices();
    if (lastResult) renderBenchmarkResult();
    else setStatus(text.noResult);
}

export function initBenchmark({ onReveal = null } = {}) {
    onRevealChange = onReveal;
    buildCorpusSelect();
    buildMetricSelect();
    buildFilters();
    buildColumnChoices();

    el('benchmarkCorpus').addEventListener('change', () => {
        state.benchmarkCorpusId = el('benchmarkCorpus').value;
        state.benchmarkLanguages = null;
        state.benchmarkDomains = null;
        buildFilters();
    });
    el('benchmarkMetric').addEventListener('change', () => {
        state.benchmarkMetric = el('benchmarkMetric').value;
        renderBenchmarkResult();
    });
    el('benchmarkLanguages').addEventListener('change', () => {
        state.benchmarkLanguages = selectedValues(el('benchmarkLanguages'));
    });
    el('benchmarkDomains').addEventListener('change', () => {
        state.benchmarkDomains = selectedValues(el('benchmarkDomains'));
    });
    el('benchmarkUserCorpus').addEventListener('input', () => {
        if (state.benchmarkCorpusId === 'user') buildFilters();
    });
    el('benchmarkRunBtn').addEventListener('click', runBenchmark);
    el('benchmarkExportJsonBtn').addEventListener('click', () => runAction('json'));
    el('benchmarkExportCsvBtn').addEventListener('click', () => runAction('csv'));
    el('benchmarkShareBtn').addEventListener('click', () => runAction('share'));

    setStatus(copy().noResult);
}
