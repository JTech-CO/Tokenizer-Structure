// benchmarkRun.js — 말뭉치 실행 순서 보호. 모델 전환이나 역순 응답에서도
// 열과 결과가 뒤섞이지 않도록 최신 run만 결과로 인정한다.
import { computeCellMetrics, createBenchmarkResult } from './benchmarkDomain.js';

export const BENCHMARK_RUN_OUTCOMES = Object.freeze({
    OK: 'ok',
    STALE: 'stale',
});

function fail(path, message) {
    throw new TypeError(path + ': ' + message);
}

function failureFrom(error, stage) {
    const message = String((error && error.message) || error || '').slice(0, 300);
    return {
        stage,
        code: stage === 'load' ? 'tokenizer-load-failed' : 'tokenize-failed',
        message,
    };
}

export class BenchmarkRunner {
    constructor({ loadTokenizer, analyze } = {}) {
        if (typeof loadTokenizer !== 'function') fail('loadTokenizer', 'expected a function');
        if (typeof analyze !== 'function') fail('analyze', 'expected a function');
        this._loadTokenizer = loadTokenizer;
        this._analyze = analyze;
        this._sequence = 0;
        this._latestRunId = null;
    }

    get latestRunId() {
        return this._latestRunId;
    }

    nextRunId() {
        this._sequence += 1;
        return `benchmark-${this._sequence}`;
    }

    /**
     * 시작 시점에 run을 최신으로 표시하고, 완료 시점에도 여전히 최신인지 확인한다.
     * 중간에 새 run이 시작되면 이 run의 결과는 버린다.
     */
    async run({ runId = null, corpus, columns, options = {}, createdAt = null, onProgress = null }) {
        if (!corpus || !Array.isArray(corpus.samples)) fail('corpus', 'expected a normalized corpus');
        if (!Array.isArray(columns)) fail('columns', 'expected an array');
        if (onProgress !== null && typeof onProgress !== 'function') {
            fail('onProgress', 'expected a function or null');
        }

        const id = runId || this.nextRunId();
        this._latestRunId = id;

        const stale = () => ({
            outcome: BENCHMARK_RUN_OUTCOMES.STALE,
            runId: id,
            latestRunId: this._latestRunId,
        });

        const resolvedColumns = [];
        const cells = [];
        let completed = 0;
        const totalSteps = columns.length * (1 + corpus.samples.length);

        for (const column of columns) {
            let tok = null;
            let loadFailure = null;
            try {
                tok = await this._loadTokenizer(column.modelId);
                if (!tok) throw new Error('Tokenizer was not returned');
            } catch (error) {
                loadFailure = failureFrom(error, 'load');
            }
            if (this._latestRunId !== id) return stale();
            completed += 1;
            if (onProgress) onProgress({ runId: id, completed, total: totalSteps, modelId: column.modelId });

            if (loadFailure) {
                resolvedColumns.push({ ...column, revision: column.revision ?? null, status: 'failed', failure: loadFailure });
                for (const sample of corpus.samples) {
                    cells.push({
                        sampleId: sample.id,
                        modelId: column.modelId,
                        status: 'failed',
                        failure: loadFailure,
                    });
                }
                continue;
            }

            let columnFailures = 0;
            for (const sample of corpus.samples) {
                try {
                    const analysis = await this._analyze(tok, sample.text, column.modelId, options);
                    const tokens = Array.isArray(analysis?.ids) ? analysis.ids.length : null;
                    if (!Number.isSafeInteger(tokens) || tokens <= 0) {
                        throw new Error('Analysis returned no token ids');
                    }
                    cells.push({
                        sampleId: sample.id,
                        modelId: column.modelId,
                        status: 'ok',
                        metrics: computeCellMetrics({
                            tokens,
                            codePointLength: sample.codePointLength,
                            utf8ByteLength: sample.utf8ByteLength,
                            contextWindow: column.contextWindow ?? null,
                        }),
                    });
                } catch (error) {
                    columnFailures += 1;
                    cells.push({
                        sampleId: sample.id,
                        modelId: column.modelId,
                        status: 'failed',
                        failure: failureFrom(error, 'tokenize'),
                    });
                }
                if (this._latestRunId !== id) return stale();
                completed += 1;
                if (onProgress) {
                    onProgress({ runId: id, completed, total: totalSteps, modelId: column.modelId, sampleId: sample.id });
                }
            }

            // 개별 표본만 실패한 열은 실패 열이 아니다. 성공 결과는 그대로 유지한다.
            resolvedColumns.push({
                ...column,
                revision: column.revision ?? null,
                status: 'ok',
                failure: null,
            });
            if (columnFailures === corpus.samples.length) {
                const last = resolvedColumns[resolvedColumns.length - 1];
                last.status = 'failed';
                last.failure = { stage: 'tokenize', code: 'all-samples-failed', message: '' };
            }
        }

        if (this._latestRunId !== id) return stale();

        return {
            outcome: BENCHMARK_RUN_OUTCOMES.OK,
            runId: id,
            result: createBenchmarkResult({
                runId: id,
                createdAt: createdAt || new Date().toISOString(),
                corpus,
                options,
                columns: resolvedColumns,
                cells,
            }),
        };
    }
}
