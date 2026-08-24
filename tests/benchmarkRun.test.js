import test from 'node:test';
import assert from 'node:assert/strict';

import { BENCHMARK_RUN_OUTCOMES, BenchmarkRunner } from '../js/benchmarkRun.js';
import { summarizeBenchmark } from '../js/benchmarkDomain.js';
import { normalizeCorpus } from '../js/corpus.js';

const CORPUS = normalizeCorpus({
    id: 'run-corpus',
    name: 'Run corpus',
    samples: [
        { id: 's1', text: 'aaaa', language: 'en', domain: 'prose' },
        { id: 's2', text: 'bbbbbb', language: 'en', domain: 'prose' },
    ],
});

function columns(...modelIds) {
    return modelIds.map((modelId) => ({
        modelId,
        label: modelId,
        revision: `rev-${modelId}`,
        contextWindow: 1000,
    }));
}

// 토큰 수를 모델별로 다르게 만들어 열이 섞이면 바로 드러나게 한다.
const SPLIT = { m1: 1, m2: 2, m3: 3 };

function analyzeByModel(tok, text, modelId) {
    const size = SPLIT[modelId] || 1;
    const count = Math.max(1, Math.ceil([...text].length / size));
    return { ids: Array.from({ length: count }, (_, index) => index) };
}

function immediateRunner(overrides = {}) {
    return new BenchmarkRunner({
        loadTokenizer: async (modelId) => ({ modelId }),
        analyze: async (...args) => analyzeByModel(...args),
        ...overrides,
    });
}

test('a completed run produces one cell per sample per column', async () => {
    const runner = immediateRunner();
    const outcome = await runner.run({ corpus: CORPUS, columns: columns('m1', 'm2') });

    assert.equal(outcome.outcome, BENCHMARK_RUN_OUTCOMES.OK);
    assert.equal(outcome.result.cells.length, 4);
    assert.equal(outcome.result.columns.every((column) => column.status === 'ok'), true);

    const byKey = Object.fromEntries(outcome.result.cells.map((cell) => [`${cell.sampleId} ${cell.modelId}`, cell]));
    assert.equal(byKey['s1 m1'].metrics.tokens, 4);
    assert.equal(byKey['s1 m2'].metrics.tokens, 2);
    assert.equal(byKey['s2 m1'].metrics.tokens, 6);
    assert.equal(byKey['s2 m2'].metrics.tokens, 3);
    assert.equal(byKey['s1 m1'].metrics.contextShare, 0.004);
});

test('a load failure fails the whole column without touching other columns', async () => {
    const runner = immediateRunner({
        loadTokenizer: async (modelId) => {
            if (modelId === 'm2') throw new Error('404 not found');
            return { modelId };
        },
    });
    const outcome = await runner.run({ corpus: CORPUS, columns: columns('m1', 'm2') });
    const summary = summarizeBenchmark(outcome.result);

    assert.deepEqual(summary.failedColumns, ['m2']);
    assert.equal(summary.perColumn.m2.metrics, null);
    assert.equal(summary.perColumn.m1.ok, 2);
    const failed = outcome.result.cells.filter((cell) => cell.modelId === 'm2');
    assert.equal(failed.length, 2);
    assert.ok(failed.every((cell) => cell.failure.code === 'tokenizer-load-failed'));
    assert.ok(failed[0].failure.message.includes('404'));
});

test('one bad sample does not fail the column, but every bad sample does', async () => {
    const partial = immediateRunner({
        analyze: async (tok, text, modelId) => {
            if (modelId === 'm2' && text.startsWith('b')) throw new Error('tokenize exploded');
            return analyzeByModel(tok, text, modelId);
        },
    });
    const partialSummary = summarizeBenchmark((await partial.run({ corpus: CORPUS, columns: columns('m1', 'm2') })).result);
    assert.deepEqual(partialSummary.failedColumns, []);
    assert.equal(partialSummary.perColumn.m2.ok, 1);
    assert.equal(partialSummary.perColumn.m2.failed, 1);
    assert.deepEqual(partialSummary.comparable.sampleIds, ['s1']);

    const total = immediateRunner({
        analyze: async (tok, text, modelId) => {
            if (modelId === 'm2') throw new Error('always fails');
            return analyzeByModel(tok, text, modelId);
        },
    });
    const totalSummary = summarizeBenchmark((await total.run({ corpus: CORPUS, columns: columns('m1', 'm2') })).result);
    assert.deepEqual(totalSummary.failedColumns, ['m2']);
});

test('an analysis that returns no token ids is a failure, not a zero', async () => {
    const runner = immediateRunner({ analyze: async () => ({ ids: [] }) });
    const outcome = await runner.run({ corpus: CORPUS, columns: columns('m1', 'm2') });
    assert.ok(outcome.result.cells.every((cell) => cell.status === 'failed'));
    assert.ok(outcome.result.cells.every((cell) => cell.metrics === null));
});

test('a superseded run is discarded instead of overwriting the newer one', async () => {
    const pending = [];
    const runner = new BenchmarkRunner({
        loadTokenizer: (modelId) => new Promise((resolve, reject) => pending.push({ modelId, resolve, reject })),
        analyze: async (...args) => analyzeByModel(...args),
    });

    const first = runner.run({ runId: 'run-a', corpus: CORPUS, columns: columns('m1', 'm2') });
    await Promise.resolve();
    const second = runner.run({ runId: 'run-b', corpus: CORPUS, columns: columns('m3', 'm2') });
    await Promise.resolve();

    assert.equal(runner.latestRunId, 'run-b');
    assert.equal(pending.length, 2);
    assert.deepEqual(pending.map((item) => item.modelId), ['m1', 'm3']);

    // 나중에 시작한 run이 먼저 끝난다.
    pending[1].resolve({ modelId: 'm3' });
    for (let i = 0; i < 6 && pending.length < 3; i += 1) await Promise.resolve();
    pending[2].resolve({ modelId: 'm2' });
    const secondOutcome = await second;

    // 먼저 시작한 run이 뒤늦게 응답해도 결과로 인정되지 않는다.
    pending[0].resolve({ modelId: 'm1' });
    const firstOutcome = await first;

    assert.equal(secondOutcome.outcome, BENCHMARK_RUN_OUTCOMES.OK);
    assert.deepEqual(secondOutcome.result.columns.map((column) => column.modelId), ['m3', 'm2']);
    assert.equal(firstOutcome.outcome, BENCHMARK_RUN_OUTCOMES.STALE);
    assert.equal(firstOutcome.runId, 'run-a');
    assert.equal(firstOutcome.latestRunId, 'run-b');
    assert.equal(runner.latestRunId, 'run-b');
});

test('columns and cells never mix across runs with different model sets', async () => {
    const runner = immediateRunner();
    const first = await runner.run({ corpus: CORPUS, columns: columns('m1', 'm2') });
    const second = await runner.run({ corpus: CORPUS, columns: columns('m2', 'm3') });

    assert.deepEqual(first.result.columns.map((column) => column.modelId), ['m1', 'm2']);
    assert.deepEqual(second.result.columns.map((column) => column.modelId), ['m2', 'm3']);
    assert.ok(second.result.cells.every((cell) => cell.modelId !== 'm1'));
    assert.notEqual(first.runId, second.runId);

    // m2는 두 run에 모두 있으나 각 run의 결과는 자기 run의 셀만 갖는다.
    const firstM2 = first.result.cells.filter((cell) => cell.modelId === 'm2');
    const secondM2 = second.result.cells.filter((cell) => cell.modelId === 'm2');
    assert.equal(firstM2.length, 2);
    assert.equal(secondM2.length, 2);
    assert.deepEqual(
        firstM2.map((cell) => cell.metrics.tokens),
        secondM2.map((cell) => cell.metrics.tokens),
    );
});

test('progress is reported for every load and sample step', async () => {
    const runner = immediateRunner();
    const seen = [];
    const outcome = await runner.run({
        corpus: CORPUS,
        columns: columns('m1', 'm2'),
        onProgress: (event) => seen.push(event),
    });
    assert.equal(seen.length, 2 * (1 + CORPUS.samples.length));
    assert.equal(seen.at(-1).completed, seen.at(-1).total);
    assert.ok(seen.every((event) => event.runId === outcome.runId));
});

test('the runner rejects malformed inputs instead of guessing', () => {
    assert.throws(() => new BenchmarkRunner({}), /loadTokenizer/);
    assert.throws(() => new BenchmarkRunner({ loadTokenizer: () => {} }), /analyze/);
    const runner = immediateRunner();
    assert.rejects(() => runner.run({ corpus: null, columns: [] }), /corpus/);
    assert.rejects(() => runner.run({ corpus: CORPUS, columns: 'nope' }), /columns/);
});
