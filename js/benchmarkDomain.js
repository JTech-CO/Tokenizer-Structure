// benchmarkDomain.js — P3 말뭉치 비교의 순수 도메인.
// 실패한 항목은 평균·순위·색상 어디에도 섞이지 않는다.
import { escapeCsvCell } from './inspectorDomain.js';

export const BENCHMARK_SCHEMA_VERSION = 1;

export const BENCHMARK_METRICS = Object.freeze([
    'tokens', 'codePointsPerToken', 'bytesPerToken', 'contextShare',
]);

// 값 사이를 보간하면 존재하지 않는 토큰 수가 만들어지므로 nearest-rank를 쓴다.
export const PERCENTILE_METHOD = 'nearest-rank';

export const BENCHMARK_COLUMN_LIMITS = Object.freeze({ min: 2, max: 4 });

export const BENCHMARK_CAVEAT_CODES = Object.freeze([
    'small-sample-not-language-ranking',
    'token-count-is-not-quality',
    'partial-failure-excluded',
    'context-share-uses-artifact-window',
]);

function fail(path, message) {
    throw new TypeError(path + ': ' + message);
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(value, allowed, path) {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) fail(path + '.' + key, 'unknown field');
    }
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function finiteNumber(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(path, 'expected a finite number');
    }
    return value;
}

export function percentile(values, p) {
    if (!Array.isArray(values) || values.length === 0) return null;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) {
        fail('percentile.p', 'expected a number from 0 to 100');
    }
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.ceil((p / 100) * sorted.length);
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
    return sorted[index];
}

export function median(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeSeries(values) {
    if (!Array.isArray(values)) fail('values', 'expected an array');
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
        n: sorted.length,
        mean: sum / sorted.length,
        median: median(sorted),
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        range: sorted[sorted.length - 1] - sorted[0],
    };
}

export function computeCellMetrics({ tokens, codePointLength, utf8ByteLength, contextWindow }) {
    if (!Number.isSafeInteger(tokens) || tokens < 0) fail('tokens', 'expected a non-negative safe integer');
    if (tokens === 0) fail('tokens', 'expected at least one token for a non-empty sample');
    finiteNumber(codePointLength, 'codePointLength');
    finiteNumber(utf8ByteLength, 'utf8ByteLength');

    return {
        tokens,
        codePointsPerToken: codePointLength / tokens,
        bytesPerToken: utf8ByteLength / tokens,
        // artifact 카탈로그의 컨텍스트 창이 없으면 점유율을 추정하지 않는다.
        contextShare: Number.isSafeInteger(contextWindow) && contextWindow > 0
            ? tokens / contextWindow
            : null,
    };
}

function normalizeFailure(value, path) {
    if (!isPlainObject(value)) fail(path, 'expected a plain object');
    assertKnownKeys(value, ['stage', 'code', 'message'], path);
    for (const key of ['stage', 'code']) {
        if (typeof value[key] !== 'string' || value[key] === '') {
            fail(`${path}.${key}`, 'expected a non-empty string');
        }
    }
    const message = hasOwn(value, 'message') ? value.message : '';
    if (typeof message !== 'string') fail(`${path}.message`, 'expected a string');
    return { stage: value.stage, code: value.code, message: message.slice(0, 300) };
}

function normalizeColumn(value, path) {
    if (!isPlainObject(value)) fail(path, 'expected a plain object');
    assertKnownKeys(value, ['modelId', 'label', 'revision', 'engine', 'contextWindow', 'status', 'failure'], path);
    for (const key of ['modelId', 'label']) {
        if (typeof value[key] !== 'string' || value[key] === '') {
            fail(`${path}.${key}`, 'expected a non-empty string');
        }
    }
    if (value.status !== 'ok' && value.status !== 'failed') {
        fail(`${path}.status`, 'expected ok or failed');
    }
    const revision = hasOwn(value, 'revision') ? value.revision : null;
    if (revision !== null && (typeof revision !== 'string' || revision === '')) {
        fail(`${path}.revision`, 'expected a non-empty string or null');
    }
    // 재현을 위해 성공한 열은 항상 고정 revision을 남긴다.
    if (value.status === 'ok' && revision === null) {
        fail(`${path}.revision`, 'is required for a successful column');
    }
    const engine = hasOwn(value, 'engine') ? value.engine : 'real';
    if (engine !== 'real') fail(`${path}.engine`, 'benchmark columns must use the real engine');

    const contextWindow = hasOwn(value, 'contextWindow') ? value.contextWindow : null;
    if (contextWindow !== null && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0)) {
        fail(`${path}.contextWindow`, 'expected a positive safe integer or null');
    }
    const failure = value.status === 'failed'
        ? normalizeFailure(hasOwn(value, 'failure') ? value.failure : {}, `${path}.failure`)
        : null;
    if (value.status === 'ok' && hasOwn(value, 'failure') && value.failure !== null) {
        fail(`${path}.failure`, 'must be null for a successful column');
    }

    return { modelId: value.modelId, label: value.label, revision, engine, contextWindow, status: value.status, failure };
}

function normalizeCell(value, path) {
    if (!isPlainObject(value)) fail(path, 'expected a plain object');
    assertKnownKeys(value, ['sampleId', 'modelId', 'status', 'metrics', 'failure'], path);
    for (const key of ['sampleId', 'modelId']) {
        if (typeof value[key] !== 'string' || value[key] === '') {
            fail(`${path}.${key}`, 'expected a non-empty string');
        }
    }
    if (value.status !== 'ok' && value.status !== 'failed') {
        fail(`${path}.status`, 'expected ok or failed');
    }

    if (value.status === 'failed') {
        if (hasOwn(value, 'metrics') && value.metrics !== null) {
            fail(`${path}.metrics`, 'must be null for a failed cell');
        }
        return {
            sampleId: value.sampleId,
            modelId: value.modelId,
            status: 'failed',
            metrics: null,
            failure: normalizeFailure(hasOwn(value, 'failure') ? value.failure : {}, `${path}.failure`),
        };
    }

    if (!isPlainObject(value.metrics)) fail(`${path}.metrics`, 'expected a plain object');
    assertKnownKeys(value.metrics, BENCHMARK_METRICS, `${path}.metrics`);
    const metrics = {};
    for (const name of BENCHMARK_METRICS) {
        const raw = hasOwn(value.metrics, name) ? value.metrics[name] : null;
        if (name === 'contextShare' && raw === null) {
            metrics[name] = null;
            continue;
        }
        metrics[name] = finiteNumber(raw, `${path}.metrics.${name}`);
    }
    if (!Number.isSafeInteger(metrics.tokens) || metrics.tokens <= 0) {
        fail(`${path}.metrics.tokens`, 'expected a positive safe integer');
    }
    if (hasOwn(value, 'failure') && value.failure !== null) {
        fail(`${path}.failure`, 'must be null for a successful cell');
    }
    return { sampleId: value.sampleId, modelId: value.modelId, status: 'ok', metrics, failure: null };
}

export function createBenchmarkResult(input) {
    if (!isPlainObject(input)) fail('benchmarkResult', 'expected a plain object');
    assertKnownKeys(input, ['runId', 'createdAt', 'corpus', 'options', 'columns', 'cells'], 'benchmarkResult');

    if (typeof input.runId !== 'string' || input.runId === '') {
        fail('benchmarkResult.runId', 'expected a non-empty string');
    }
    const createdAt = hasOwn(input, 'createdAt') ? input.createdAt : new Date().toISOString();
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
        fail('benchmarkResult.createdAt', 'expected an ISO timestamp');
    }

    if (!isPlainObject(input.corpus)) fail('benchmarkResult.corpus', 'expected a plain object');
    const corpus = {
        id: input.corpus.id,
        name: input.corpus.name,
        source: input.corpus.source,
        sampleIds: input.corpus.samples.map((item) => item.id),
        samples: input.corpus.samples.map((item) => ({
            id: item.id,
            language: item.language,
            domain: item.domain,
            codePointLength: item.codePointLength,
            utf8ByteLength: item.utf8ByteLength,
        })),
    };

    if (!Array.isArray(input.columns)) fail('benchmarkResult.columns', 'expected an array');
    if (input.columns.length < BENCHMARK_COLUMN_LIMITS.min || input.columns.length > BENCHMARK_COLUMN_LIMITS.max) {
        fail(
            'benchmarkResult.columns',
            `expected ${BENCHMARK_COLUMN_LIMITS.min} to ${BENCHMARK_COLUMN_LIMITS.max} columns`,
        );
    }
    const columns = input.columns.map((item, index) => normalizeColumn(item, `benchmarkResult.columns[${index}]`));
    const columnIds = new Set();
    for (const column of columns) {
        if (columnIds.has(column.modelId)) fail('benchmarkResult.columns', `duplicate column: ${column.modelId}`);
        columnIds.add(column.modelId);
    }

    if (!Array.isArray(input.cells)) fail('benchmarkResult.cells', 'expected an array');
    const cells = input.cells.map((item, index) => normalizeCell(item, `benchmarkResult.cells[${index}]`));

    const sampleIds = new Set(corpus.sampleIds);
    const seen = new Set();
    for (const cell of cells) {
        if (!sampleIds.has(cell.sampleId)) fail('benchmarkResult.cells', `unknown sample: ${cell.sampleId}`);
        if (!columnIds.has(cell.modelId)) fail('benchmarkResult.cells', `unknown column: ${cell.modelId}`);
        const key = `${cell.sampleId} ${cell.modelId}`;
        if (seen.has(key)) fail('benchmarkResult.cells', `duplicate cell: ${cell.sampleId} × ${cell.modelId}`);
        seen.add(key);
    }
    if (cells.length !== corpus.sampleIds.length * columns.length) {
        fail('benchmarkResult.cells', 'every sample must have a cell for every column');
    }
    // 실패한 열이 일부 성공 셀을 남기면 순위와 평균이 섞인다.
    for (const column of columns) {
        if (column.status !== 'failed') continue;
        const leaked = cells.some((cell) => cell.modelId === column.modelId && cell.status === 'ok');
        if (leaked) fail('benchmarkResult.cells', `failed column ${column.modelId} must not report successful cells`);
    }

    const options = hasOwn(input, 'options') ? input.options : {};
    if (!isPlainObject(options)) fail('benchmarkResult.options', 'expected a plain object');

    return {
        schemaVersion: BENCHMARK_SCHEMA_VERSION,
        type: 'benchmark-result',
        runId: input.runId,
        createdAt,
        percentileMethod: PERCENTILE_METHOD,
        corpus,
        options: JSON.parse(JSON.stringify(options)),
        columns,
        cells,
    };
}

function cellIndex(result) {
    const index = new Map();
    for (const cell of result.cells) index.set(`${cell.sampleId} ${cell.modelId}`, cell);
    return index;
}

/**
 * 열별 통계와, 모든 성공 열이 함께 성공한 표본만 쓰는 비교 가능 통계를 나눈다.
 * 순위는 비교 가능 부분집합에서만 계산한다.
 */
export function summarizeBenchmark(result) {
    const index = cellIndex(result);
    const okColumns = result.columns.filter((column) => column.status === 'ok');

    const perColumn = {};
    for (const column of result.columns) {
        const columnCells = result.corpus.sampleIds.map((id) => index.get(`${id} ${column.modelId}`));
        const okCells = columnCells.filter((cell) => cell.status === 'ok');
        const metrics = {};
        for (const name of BENCHMARK_METRICS) {
            const values = okCells
                .map((cell) => cell.metrics[name])
                .filter((value) => typeof value === 'number' && Number.isFinite(value));
            metrics[name] = summarizeSeries(values);
        }
        perColumn[column.modelId] = {
            status: column.status,
            attempted: columnCells.length,
            ok: okCells.length,
            failed: columnCells.length - okCells.length,
            metrics: okCells.length === 0 ? null : metrics,
        };
    }

    const comparableSampleIds = result.corpus.sampleIds.filter((id) => okColumns.every(
        (column) => index.get(`${id} ${column.modelId}`).status === 'ok',
    ));
    const excludedSamples = result.corpus.sampleIds
        .filter((id) => !comparableSampleIds.includes(id))
        .map((id) => ({
            sampleId: id,
            failedColumns: okColumns
                .filter((column) => index.get(`${id} ${column.modelId}`).status === 'failed')
                .map((column) => column.modelId),
        }));

    const comparableColumns = {};
    for (const column of okColumns) {
        const metrics = {};
        for (const name of BENCHMARK_METRICS) {
            const values = comparableSampleIds
                .map((id) => index.get(`${id} ${column.modelId}`).metrics[name])
                .filter((value) => typeof value === 'number' && Number.isFinite(value));
            metrics[name] = summarizeSeries(values);
        }
        comparableColumns[column.modelId] = metrics;
    }

    const ranking = {};
    for (const name of BENCHMARK_METRICS) {
        const entries = okColumns
            .map((column) => ({ modelId: column.modelId, mean: comparableColumns[column.modelId][name]?.mean ?? null }))
            .filter((entry) => entry.mean !== null);
        // 동점은 임의 순서가 되지 않도록 modelId로 안정 정렬한다.
        entries.sort((left, right) => (left.mean - right.mean) || left.modelId.localeCompare(right.modelId));
        ranking[name] = entries.map((entry) => entry.modelId);
    }

    return {
        percentileMethod: PERCENTILE_METHOD,
        perColumn,
        comparable: {
            sampleIds: comparableSampleIds,
            sampleCount: comparableSampleIds.length,
            columns: comparableColumns,
            ranking,
            // 순위는 토큰 수만 비교한 것이며 품질 판정이 아니다.
            rankingBasis: 'mean-ascending-over-comparable-samples',
        },
        excludedSamples,
        failedColumns: result.columns.filter((column) => column.status === 'failed').map((column) => column.modelId),
    };
}

/**
 * 한 행 안에서만 상대 비교하는 색상 축척. 실패 셀은 축척에 들어가지 않는다.
 */
export function rowScale(result, sampleId, metric = 'tokens') {
    if (!BENCHMARK_METRICS.includes(metric)) fail('metric', 'unknown benchmark metric');
    const index = cellIndex(result);
    const values = result.columns
        .filter((column) => column.status === 'ok')
        .map((column) => index.get(`${sampleId} ${column.modelId}`))
        .filter((cell) => cell && cell.status === 'ok')
        .map((cell) => cell.metrics[metric])
        .filter((value) => typeof value === 'number' && Number.isFinite(value));

    if (values.length === 0) return null;
    return { min: Math.min(...values), max: Math.max(...values), n: values.length };
}

export function benchmarkCaveats(result) {
    const summary = summarizeBenchmark(result);
    const caveats = [
        {
            code: 'small-sample-not-language-ranking',
            text: `This report compares ${result.corpus.sampleIds.length} sample(s). It does not rank languages, scripts, or models in general.`,
        },
        {
            code: 'token-count-is-not-quality',
            text: 'Fewer tokens is not evidence of better generation quality, reasoning, or language ability.',
        },
        {
            code: 'context-share-uses-artifact-window',
            text: 'Context share uses the pinned artifact context window, not a provider API limit.',
        },
    ];
    if (summary.failedColumns.length > 0 || summary.excludedSamples.length > 0) {
        caveats.push({
            code: 'partial-failure-excluded',
            text: `Failed items are excluded from averages and ranking. Failed columns: ${summary.failedColumns.length}. Samples outside the comparable subset: ${summary.excludedSamples.length}.`,
        });
    }
    return caveats;
}

export function serializeBenchmarkJson(result, { space = 2 } = {}) {
    return JSON.stringify({
        ...result,
        summary: summarizeBenchmark(result),
        caveats: benchmarkCaveats(result),
    }, null, space);
}

function formatNumber(value) {
    if (value === null || value === undefined) return '';
    return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

export function serializeBenchmarkCsv(result) {
    const index = cellIndex(result);
    const lines = [];
    const header = ['sampleId', 'language', 'domain', 'codePoints', 'utf8Bytes'];
    for (const column of result.columns) {
        for (const metric of BENCHMARK_METRICS) header.push(`${column.modelId}:${metric}`);
        header.push(`${column.modelId}:status`);
    }
    lines.push(header.map(escapeCsvCell).join(','));

    for (const sample of result.corpus.samples) {
        const row = [sample.id, sample.language, sample.domain, sample.codePointLength, sample.utf8ByteLength];
        for (const column of result.columns) {
            const cell = index.get(`${sample.id} ${column.modelId}`);
            for (const metric of BENCHMARK_METRICS) {
                row.push(cell.status === 'ok' ? formatNumber(cell.metrics[metric]) : '');
            }
            row.push(cell.status === 'ok' ? 'ok' : `failed:${cell.failure.code}`);
        }
        lines.push(row.map(escapeCsvCell).join(','));
    }

    lines.push('');
    lines.push(escapeCsvCell('# caveats'));
    for (const caveat of benchmarkCaveats(result)) {
        lines.push([caveat.code, caveat.text].map(escapeCsvCell).join(','));
    }
    return lines.join('\n');
}
