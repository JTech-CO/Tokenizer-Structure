import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BENCHMARK_METRICS,
    BENCHMARK_SCHEMA_VERSION,
    PERCENTILE_METHOD,
    benchmarkCaveats,
    computeCellMetrics,
    createBenchmarkResult,
    median,
    percentile,
    rowScale,
    serializeBenchmarkCsv,
    serializeBenchmarkJson,
    summarizeBenchmark,
    summarizeSeries,
} from '../js/benchmarkDomain.js';
import { normalizeCorpus } from '../js/corpus.js';

const CORPUS = normalizeCorpus({
    id: 'test-corpus',
    name: 'Test corpus',
    samples: [
        { id: 's1', text: 'aaaa', language: 'en', domain: 'prose' },
        { id: 's2', text: 'bbbbbb', language: 'en', domain: 'code' },
        { id: 's3', text: 'cc', language: 'ko', domain: 'prose' },
    ],
});

function column(modelId, overrides = {}) {
    return {
        modelId,
        label: modelId,
        revision: 'rev-' + modelId,
        engine: 'real',
        contextWindow: 1000,
        status: 'ok',
        failure: null,
        ...overrides,
    };
}

function okCell(sampleId, modelId, tokens) {
    const sample = CORPUS.samples.find((item) => item.id === sampleId);
    return {
        sampleId,
        modelId,
        status: 'ok',
        metrics: computeCellMetrics({
            tokens,
            codePointLength: sample.codePointLength,
            utf8ByteLength: sample.utf8ByteLength,
            contextWindow: 1000,
        }),
    };
}

function failedCell(sampleId, modelId, code = 'tokenize-failed') {
    return {
        sampleId,
        modelId,
        status: 'failed',
        failure: { stage: 'tokenize', code, message: 'boom' },
    };
}

function build({ columns, cells, options = {} }) {
    return createBenchmarkResult({
        runId: 'benchmark-1',
        createdAt: '2026-08-25T00:00:00.000Z',
        corpus: CORPUS,
        options,
        columns,
        cells,
    });
}

test('nearest-rank percentiles never invent a value between data points', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentile(values, 0), 1);
    assert.equal(percentile(values, 50), 5);
    assert.equal(percentile(values, 95), 10);
    assert.equal(percentile(values, 100), 10);
    assert.equal(percentile([7], 50), 7);
    assert.equal(percentile([], 50), null);
    for (const p of [0, 25, 50, 95, 100]) {
        assert.ok(values.includes(percentile(values, p)), `p${p} must be an observed value`);
    }
    assert.throws(() => percentile(values, 101), /0 to 100/);
});

test('median averages the two middle values for an even count', () => {
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), null);
});

test('series summary reports spread, not only the mean', () => {
    const summary = summarizeSeries([4, 1, 3, 2]);
    assert.deepEqual(summary, { n: 4, mean: 2.5, median: 2.5, p50: 2, p95: 4, min: 1, max: 4, range: 3 });
    assert.equal(summarizeSeries([]), null);
});

test('context share is unavailable rather than zero without an artifact window', () => {
    const withWindow = computeCellMetrics({ tokens: 10, codePointLength: 40, utf8ByteLength: 60, contextWindow: 1000 });
    assert.equal(withWindow.codePointsPerToken, 4);
    assert.equal(withWindow.bytesPerToken, 6);
    assert.equal(withWindow.contextShare, 0.01);

    const withoutWindow = computeCellMetrics({ tokens: 10, codePointLength: 40, utf8ByteLength: 60, contextWindow: null });
    assert.equal(withoutWindow.contextShare, null);
    assert.throws(() => computeCellMetrics({ tokens: 0, codePointLength: 1, utf8ByteLength: 1 }), /at least one token/);
});

test('a result requires 2 to 4 columns and one cell per sample per column', () => {
    const columns = [column('a'), column('b')];
    const cells = CORPUS.samples.flatMap((sample) => [
        okCell(sample.id, 'a', 4),
        okCell(sample.id, 'b', 2),
    ]);
    const result = build({ columns, cells });
    assert.equal(result.schemaVersion, BENCHMARK_SCHEMA_VERSION);
    assert.equal(result.percentileMethod, PERCENTILE_METHOD);
    assert.equal(result.cells.length, 6);

    assert.throws(() => build({ columns: [column('a')], cells: [] }), /2 to 4 columns/);
    assert.throws(
        () => build({ columns: [column('a'), column('b'), column('c'), column('d'), column('e')], cells: [] }),
        /2 to 4 columns/,
    );
    assert.throws(() => build({ columns, cells: cells.slice(1) }), /every sample must have a cell/);
    assert.throws(() => build({ columns, cells: [...cells, okCell('s1', 'a', 4)] }), /duplicate cell/);
    assert.throws(() => build({ columns: [column('a'), column('a')], cells }), /duplicate column/);
});

test('a successful column must carry a pinned revision', () => {
    const columns = [column('a', { revision: null }), column('b')];
    const cells = CORPUS.samples.flatMap((sample) => [okCell(sample.id, 'a', 4), okCell(sample.id, 'b', 2)]);
    assert.throws(() => build({ columns, cells }), /revision/);
});

test('a failed column may not leak successful cells into the report', () => {
    const columns = [
        column('a', { status: 'failed', revision: null, failure: { stage: 'load', code: 'tokenizer-load-failed' } }),
        column('b'),
    ];
    const cells = CORPUS.samples.flatMap((sample) => [
        sample.id === 's1' ? okCell(sample.id, 'a', 4) : failedCell(sample.id, 'a'),
        okCell(sample.id, 'b', 2),
    ]);
    assert.throws(() => build({ columns, cells }), /must not report successful cells/);
});

test('partial failures stay out of averages, ranking, and the comparable subset', () => {
    const columns = [column('a'), column('b'), column('c')];
    const cells = [
        okCell('s1', 'a', 4), okCell('s2', 'a', 6), okCell('s3', 'a', 2),
        okCell('s1', 'b', 2), failedCell('s2', 'b'), okCell('s3', 'b', 1),
        okCell('s1', 'c', 8), okCell('s2', 'c', 12), okCell('s3', 'c', 4),
    ];
    const summary = summarizeBenchmark(build({ columns, cells }));

    // 열 자체 통계는 그 열의 성공 표본만 쓰고 실패 수를 따로 보고한다.
    assert.equal(summary.perColumn.b.ok, 2);
    assert.equal(summary.perColumn.b.failed, 1);
    assert.equal(summary.perColumn.b.metrics.tokens.n, 2);
    assert.equal(summary.perColumn.b.metrics.tokens.mean, 1.5);
    assert.equal(summary.perColumn.a.metrics.tokens.mean, 4);

    // 비교 가능 부분집합은 모든 성공 열이 함께 성공한 표본만 쓴다.
    assert.deepEqual(summary.comparable.sampleIds, ['s1', 's3']);
    assert.equal(summary.comparable.sampleCount, 2);
    assert.equal(summary.comparable.columns.a.tokens.mean, 3);
    assert.equal(summary.comparable.columns.b.tokens.mean, 1.5);
    assert.equal(summary.comparable.columns.c.tokens.mean, 6);
    assert.deepEqual(summary.comparable.ranking.tokens, ['b', 'a', 'c']);
    assert.equal(summary.comparable.rankingBasis, 'mean-ascending-over-comparable-samples');

    assert.deepEqual(summary.excludedSamples, [{ sampleId: 's2', failedColumns: ['b'] }]);
    assert.deepEqual(summary.failedColumns, []);
});

test('a fully failed column is excluded from ranking but still reported', () => {
    const columns = [
        column('a'),
        column('b', { status: 'failed', failure: { stage: 'load', code: 'tokenizer-load-failed' } }),
    ];
    const cells = CORPUS.samples.flatMap((sample) => [
        okCell(sample.id, 'a', 4),
        failedCell(sample.id, 'b', 'tokenizer-load-failed'),
    ]);
    const result = build({ columns, cells });
    const summary = summarizeBenchmark(result);

    assert.deepEqual(summary.failedColumns, ['b']);
    assert.equal(summary.perColumn.b.metrics, null);
    assert.equal(summary.perColumn.b.failed, 3);
    // 실패 열은 비교 가능 집합 판정에서 빠지므로 나머지 표본은 그대로 비교된다.
    assert.deepEqual(summary.comparable.sampleIds, ['s1', 's2', 's3']);
    assert.deepEqual(summary.comparable.ranking.tokens, ['a']);
    assert.ok(benchmarkCaveats(result).some((item) => item.code === 'partial-failure-excluded'));
});

test('row colour scale ignores failed cells', () => {
    const columns = [column('a'), column('b'), column('c')];
    const cells = [
        okCell('s1', 'a', 4), okCell('s2', 'a', 6), okCell('s3', 'a', 2),
        failedCell('s1', 'b'), okCell('s2', 'b', 3), okCell('s3', 'b', 1),
        okCell('s1', 'c', 8), okCell('s2', 'c', 12), okCell('s3', 'c', 4),
    ];
    const result = build({ columns, cells });
    assert.deepEqual(rowScale(result, 's1'), { min: 4, max: 8, n: 2 });
    assert.deepEqual(rowScale(result, 's2'), { min: 3, max: 12, n: 3 });
    assert.throws(() => rowScale(result, 's1', 'quality'), /unknown benchmark metric/);
});

test('every report carries the do-not-generalize caveats', () => {
    const columns = [column('a'), column('b')];
    const cells = CORPUS.samples.flatMap((sample) => [okCell(sample.id, 'a', 4), okCell(sample.id, 'b', 2)]);
    const result = build({ columns, cells });
    const codes = benchmarkCaveats(result).map((item) => item.code);
    assert.ok(codes.includes('small-sample-not-language-ranking'));
    assert.ok(codes.includes('token-count-is-not-quality'));
    assert.ok(codes.includes('context-share-uses-artifact-window'));
    assert.ok(!codes.includes('partial-failure-excluded'));

    const json = JSON.parse(serializeBenchmarkJson(result));
    assert.equal(json.summary.comparable.sampleCount, 3);
    assert.ok(json.caveats.length >= 3);
    assert.equal(json.percentileMethod, PERCENTILE_METHOD);

    const csv = serializeBenchmarkCsv(result);
    const header = csv.split('\n')[0];
    for (const metric of BENCHMARK_METRICS) assert.ok(header.includes(`a:${metric}`));
    assert.ok(csv.includes('small-sample-not-language-ranking'));
    assert.ok(csv.includes('token-count-is-not-quality'));
});

test('CSV export defends against spreadsheet formula injection', () => {
    const corpus = normalizeCorpus({
        id: 'inject',
        name: 'inject',
        samples: [{ id: 'formula', text: '=cmd|calc', language: 'und', domain: 'prose' }],
    });
    const result = createBenchmarkResult({
        runId: 'benchmark-2',
        createdAt: '2026-08-25T00:00:00.000Z',
        corpus,
        options: {},
        columns: [column('a'), column('b')],
        cells: [
            { sampleId: 'formula', modelId: 'a', status: 'ok', metrics: computeCellMetrics({ tokens: 4, codePointLength: 9, utf8ByteLength: 9, contextWindow: 1000 }) },
            { sampleId: 'formula', modelId: 'b', status: 'failed', failure: { stage: 'tokenize', code: '=danger' } },
        ],
    });
    const csv = serializeBenchmarkCsv(result);
    assert.ok(!/(^|,)=/m.test(csv), 'no cell may start with an unescaped formula prefix');
    assert.ok(csv.includes('failed:'));
});
