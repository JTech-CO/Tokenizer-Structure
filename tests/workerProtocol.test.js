import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TOKENIZER_WORKER_PROTOCOL_VERSION,
    WORKER_REQUEST_TYPES,
    WORKER_RESPONSE_TYPES,
    TokenizerResourceLRU,
    WorkerRequestError,
    createCancelledResponse,
    createErrorResponse,
    createProgressResponse,
    createResultResponse,
    createWorkerRequest,
    validateWorkerRequest,
    validateWorkerResponse,
} from '../js/workerProtocol.js';
import {
    WORKER_CLIENT_OUTCOME_TYPES,
    TokenizerWorkerClient,
} from '../js/tokenizerWorkerClient.js';
import { createTokenizerWorkerRuntime } from '../js/tokenizerWorker.js';

const MODEL_ID = 'Xenova/gpt-4o';

class FakeWorker {
    constructor() {
        this.messages = [];
        this.listeners = new Map();
        this.terminated = false;
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }

    postMessage(message) {
        this.messages.push(message);
    }

    terminate() {
        this.terminated = true;
    }

    emit(type, value) {
        const event = type === 'message' ? new MessageEvent('message', { data: value }) : value;
        for (const listener of this.listeners.get(type) || []) listener(event);
    }
}

async function waitFor(predicate, message = 'condition was not reached') {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(message);
}

test('worker requests are versioned, canonical, and JSON-safe', () => {
    const load = createWorkerRequest({ type: 'load', requestId: 'load-1', modelId: MODEL_ID });
    const analyze = createWorkerRequest({
        type: 'analyze',
        requestId: 'analyze-1',
        modelId: MODEL_ID,
        payload: { text: 'A🤗', options: { addSpecialTokens: true } },
    });
    const dispose = createWorkerRequest({ type: 'dispose', requestId: 'dispose-1' });
    const cancel = createWorkerRequest({
        type: 'cancel',
        requestId: 'analyze-1',
        hard: true,
        reason: 'user-requested',
    });

    assert.deepEqual(load, {
        protocolVersion: TOKENIZER_WORKER_PROTOCOL_VERSION,
        type: 'load',
        requestId: 'load-1',
        modelId: MODEL_ID,
    });
    assert.deepEqual(dispose, {
        protocolVersion: TOKENIZER_WORKER_PROTOCOL_VERSION,
        type: 'dispose',
        requestId: 'dispose-1',
        modelId: null,
    });
    assert.deepEqual(cancel, {
        protocolVersion: TOKENIZER_WORKER_PROTOCOL_VERSION,
        type: 'cancel',
        requestId: 'analyze-1',
        hard: true,
        reason: 'user-requested',
    });
    assert.notEqual(analyze.payload.options, analyze);
    for (const request of [load, analyze, dispose, cancel]) {
        assert.equal(validateWorkerRequest(request), true);
        assert.deepEqual(JSON.parse(JSON.stringify(request)), request);
    }
});

test('worker request validation rejects schema drift and unsafe payloads', () => {
    assert.throws(
        () => validateWorkerRequest({
            protocolVersion: 999,
            type: 'load',
            requestId: 'load-1',
            modelId: MODEL_ID,
        }),
        /protocol version/,
    );
    assert.throws(
        () => validateWorkerRequest({
            protocolVersion: TOKENIZER_WORKER_PROTOCOL_VERSION,
            type: 'load',
            requestId: 'load-1',
            modelId: MODEL_ID,
            unexpected: true,
        }),
        /unknown field/,
    );
    const cyclic = {};
    cyclic.self = cyclic;
    assert.throws(
        () => createWorkerRequest({
            type: 'analyze',
            requestId: 'analyze-1',
            modelId: MODEL_ID,
            payload: cyclic,
        }),
        /cyclic/,
    );
});

test('progress, result, retryable error, and cancellation responses are structured', () => {
    const responses = [
        createProgressResponse({
            requestId: 'load-1',
            operation: 'load',
            phase: 'fetching',
            ratio: 0.5,
            message: '50%',
            details: { file: 'tokenizer.json' },
        }),
        createResultResponse({
            requestId: 'load-1',
            operation: 'load',
            result: { cacheHit: false },
        }),
        createErrorResponse({
            requestId: 'load-2',
            operation: 'load',
            error: {
                code: 'NETWORK_UNAVAILABLE',
                message: 'Network unavailable',
                retryable: true,
                details: { status: 503 },
            },
        }),
        createCancelledResponse({
            requestId: 'analyze-1',
            operation: 'analyze',
            hard: true,
            terminated: true,
            cacheLost: true,
            reason: 'user-requested',
        }),
    ];

    for (const response of responses) {
        assert.equal(validateWorkerResponse(response), true);
        assert.deepEqual(JSON.parse(JSON.stringify(response)), response);
    }
    assert.deepEqual(responses[3], {
        protocolVersion: TOKENIZER_WORKER_PROTOCOL_VERSION,
        type: WORKER_RESPONSE_TYPES.CANCELLED,
        requestId: 'analyze-1',
        operation: 'analyze',
        hard: true,
        terminated: true,
        cacheLost: true,
        reason: 'user-requested',
    });
    assert.throws(
        () => createProgressResponse({
            requestId: 'load-1',
            operation: 'load',
            phase: 'fetching',
            ratio: 1.1,
        }),
        /between 0 and 1/,
    );
});

test('TokenizerResourceLRU evicts deterministically by recency and byte budget', async () => {
    const disposed = [];
    const cache = new TokenizerResourceLRU({
        maxEntries: 2,
        maxEstimatedBytes: 10,
        dispose: async (resource, key, reason) => disposed.push([resource, key, reason]),
    });

    await cache.set('a', 'A', { estimatedBytes: 6 });
    await cache.set('b', 'B', { estimatedBytes: 4 });
    assert.equal(cache.get('a'), 'A');
    await cache.set('c', 'C', { estimatedBytes: 4 });
    assert.deepEqual(cache.keys(), ['a', 'c']);
    assert.deepEqual(disposed, [['B', 'b', 'lru-evicted']]);

    await cache.set('d', 'D', { estimatedBytes: 8 });
    assert.deepEqual(cache.keys(), ['d']);
    assert.deepEqual(disposed, [
        ['B', 'b', 'lru-evicted'],
        ['A', 'a', 'lru-evicted'],
        ['C', 'c', 'lru-evicted'],
    ]);
    assert.deepEqual(cache.stats(), {
        activeCount: 1,
        pendingCount: 0,
        estimatedBytes: 8,
        maxEntries: 2,
        maxEstimatedBytes: 10,
        keysLeastToMostRecent: ['d'],
    });
});

test('TokenizerResourceLRU coalesces concurrent loads and exposes pending count', async () => {
    const cache = new TokenizerResourceLRU();
    let loads = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const loader = async () => {
        loads += 1;
        await gate;
        return { resource: { id: 'tokenizer' }, estimatedBytes: 7 };
    };

    const first = cache.acquire('model', loader);
    const second = cache.acquire('model', loader);
    assert.equal(cache.pendingCount, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.strictEqual(a, b);
    assert.equal(loads, 1);
    assert.equal(cache.activeCount, 1);
    assert.equal(cache.estimatedBytes, 7);
});

test('client default factory targets the executable worker entry', async () => {
    const OriginalWorker = globalThis.Worker;
    const created = [];
    class CapturingWorker extends FakeWorker {
        constructor(url, options) {
            super();
            this.url = url;
            this.options = options;
            created.push(this);
        }
    }
    globalThis.Worker = CapturingWorker;
    try {
        const client = new TokenizerWorkerClient();
        const handle = client.load(MODEL_ID, { requestId: 'default-worker-load' });
        assert.equal(created.length, 1);
        assert.equal(created[0].url.pathname.endsWith('/js/tokenizerWorkerEntry.js'), true);
        assert.deepEqual(created[0].options, { type: 'module', name: 'tokenizer-worker' });
        created[0].emit('message', createResultResponse({
            requestId: 'default-worker-load',
            operation: 'load',
            result: { modelId: MODEL_ID },
        }));
        assert.equal((await handle.promise).type, WORKER_RESPONSE_TYPES.RESULT);
        await client.terminate();
        assert.equal(created[0].terminated, true);
    } finally {
        if (OriginalWorker === undefined) delete globalThis.Worker;
        else globalThis.Worker = OriginalWorker;
    }
});

test('client forwards progress and resolves a validated worker result', async () => {
    const worker = new FakeWorker();
    const progress = [];
    const client = new TokenizerWorkerClient({
        workerFactory: () => worker,
        onProgress: (message) => progress.push(['global', message.progress.ratio]),
    });
    const handle = client.load(MODEL_ID, {
        requestId: 'load-1',
        onProgress: (message) => progress.push(['local', message.progress.ratio]),
    });

    assert.deepEqual(worker.messages, [handle.request]);
    worker.emit('message', createProgressResponse({
        requestId: 'load-1',
        operation: 'load',
        phase: 'fetching',
        ratio: 0.25,
    }));
    worker.emit('message', createResultResponse({
        requestId: 'load-1',
        operation: 'load',
        result: { modelId: MODEL_ID, cacheHit: false },
    }));

    assert.deepEqual(progress, [['local', 0.25], ['global', 0.25]]);
    assert.deepEqual((await handle.promise).result, { modelId: MODEL_ID, cacheHit: false });
    assert.deepEqual(client.state.activeRequestIds, []);
});

test('client suppresses an older analysis in the same request scope', async () => {
    const worker = new FakeWorker();
    const progress = [];
    const client = new TokenizerWorkerClient({
        workerFactory: () => worker,
        onProgress: (message) => progress.push(message.requestId),
    });
    const first = client.analyze({
        modelId: MODEL_ID,
        payload: { text: 'old' },
        requestId: 'analysis-old',
        scope: 'editor',
    });
    const second = client.analyze({
        modelId: MODEL_ID,
        payload: { text: 'new' },
        requestId: 'analysis-new',
        scope: 'editor',
    });

    assert.deepEqual(await first.promise, {
        type: WORKER_CLIENT_OUTCOME_TYPES.STALE,
        requestId: 'analysis-old',
        operation: 'analyze',
        latestRequestId: 'analysis-new',
        reason: 'superseded-by-newer-request',
    });
    worker.emit('message', createProgressResponse({
        requestId: 'analysis-old',
        operation: 'analyze',
        phase: 'analyzing',
        ratio: 1,
    }));
    worker.emit('message', createResultResponse({
        requestId: 'analysis-old',
        operation: 'analyze',
        result: { text: 'old' },
    }));
    worker.emit('message', createResultResponse({
        requestId: 'analysis-new',
        operation: 'analyze',
        result: { text: 'new' },
    }));

    assert.deepEqual((await second.promise).result, { text: 'new' });
    assert.deepEqual(progress, []);
});

test('client exposes retryable WorkerRequestError and can replay with a new requestId', async () => {
    const worker = new FakeWorker();
    const client = new TokenizerWorkerClient({ workerFactory: () => worker });
    const first = client.load(MODEL_ID, { requestId: 'load-failed' });
    worker.emit('message', createErrorResponse({
        requestId: 'load-failed',
        operation: 'load',
        error: {
            code: 'NETWORK_UNAVAILABLE',
            message: 'Try again',
            retryable: true,
            details: { status: 503 },
        },
    }));

    await assert.rejects(first.promise, (error) => {
        assert.ok(error instanceof WorkerRequestError);
        assert.equal(error.code, 'NETWORK_UNAVAILABLE');
        assert.equal(error.retryable, true);
        assert.deepEqual(error.details, { status: 503 });
        return true;
    });
    const retry = client.retry('load-failed', { requestId: 'load-retry' });
    assert.equal(worker.messages.at(-1).requestId, 'load-retry');
    assert.equal(worker.messages.at(-1).modelId, MODEL_ID);
    worker.emit('message', createResultResponse({
        requestId: 'load-retry',
        operation: 'load',
        result: { cacheHit: false },
    }));
    assert.equal((await retry.promise).type, WORKER_RESPONSE_TYPES.RESULT);
});

test('hard cancel terminates the worker and reports cache loss to every active request', async () => {
    const workers = [];
    const client = new TokenizerWorkerClient({
        workerFactory: () => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
    });
    const load = client.load(MODEL_ID, { requestId: 'load-1' });
    const analyze = client.analyze({
        modelId: MODEL_ID,
        payload: { text: 'hello' },
        requestId: 'analyze-1',
        scope: 'editor',
    });

    const cancelOutcome = await analyze.cancel({ hard: true, reason: 'stop-now' });
    const loadOutcome = await load.promise;
    const analyzeOutcome = await analyze.promise;
    assert.equal(workers[0].terminated, true);
    assert.deepEqual(
        [cancelOutcome.hard, cancelOutcome.terminated, cancelOutcome.cacheLost, cancelOutcome.reason],
        [true, true, true, 'stop-now'],
    );
    assert.deepEqual(
        [loadOutcome.hard, loadOutcome.terminated, loadOutcome.cacheLost, loadOutcome.reason],
        [true, true, true, 'worker-terminated-by-hard-cancel'],
    );
    assert.deepEqual(analyzeOutcome, cancelOutcome);

    client.load(MODEL_ID, { requestId: 'load-after-restart' });
    assert.equal(workers.length, 2);
    assert.equal(client.state.workerGeneration >= 2, true);
});

test('worker runtime reports missing adapter as a non-retryable structured error', async () => {
    const responses = [];
    const runtime = createTokenizerWorkerRuntime({
        postMessage: (message) => responses.push(message),
        adapter: null,
    });
    runtime.handle(createWorkerRequest({
        type: 'load',
        requestId: 'load-missing-adapter',
        modelId: MODEL_ID,
    }));
    await waitFor(() => responses.some((message) => message.type === 'error'));

    const error = responses.find((message) => message.type === 'error');
    assert.equal(error.error.code, 'WORKER_ADAPTER_MISSING');
    assert.equal(error.error.retryable, false);
    assert.deepEqual(error.error.details, { method: 'load' });
});

test('worker runtime loads once, emits progress, and analyzes through its injected adapter', async () => {
    const responses = [];
    let loads = 0;
    const adapter = {
        async load(modelId, { onProgress }) {
            loads += 1;
            onProgress({ phase: 'fetching', progress: 50, details: { modelId } });
            return { resource: { modelId }, estimatedBytes: 12 };
        },
        async analyze(resource, payload, { onProgress }) {
            onProgress({ phase: 'encoding', ratio: 1 });
            return { modelId: resource.modelId, text: payload.text, ids: [1, 2] };
        },
    };
    const runtime = createTokenizerWorkerRuntime({
        postMessage: (message) => responses.push(message),
        adapter,
    });

    runtime.handle(createWorkerRequest({
        type: 'analyze',
        requestId: 'analyze-1',
        modelId: MODEL_ID,
        payload: { text: '안녕' },
    }));
    await waitFor(() => responses.some((message) => message.type === 'result'));
    assert.equal(loads, 1);
    assert.deepEqual(
        responses.filter((message) => message.type === 'progress').map((message) => [
            message.progress.phase,
            message.progress.ratio,
        ]),
        [['fetching', 0.5], ['encoding', 1]],
    );
    assert.deepEqual(responses.at(-1).result, {
        modelId: MODEL_ID,
        text: '안녕',
        ids: [1, 2],
    });
    assert.equal(runtime.cache.activeCount, 1);

    responses.length = 0;
    runtime.handle(createWorkerRequest({
        type: 'load',
        requestId: 'load-cached',
        modelId: MODEL_ID,
    }));
    await waitFor(() => responses.some((message) => message.type === 'result'));
    assert.equal(loads, 1);
    assert.equal(responses.at(-1).result.cacheHit, true);
});

test('worker runtime soft cancel aborts an active request without claiming cache loss', async () => {
    const responses = [];
    let analyzeStarted = false;
    const adapter = {
        async load() {
            return { resource: {}, estimatedBytes: 1 };
        },
        async analyze(resource, payload, { signal }) {
            analyzeStarted = true;
            return new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => {
                    const error = new Error('aborted');
                    error.name = 'AbortError';
                    reject(error);
                }, { once: true });
            });
        },
    };
    const runtime = createTokenizerWorkerRuntime({
        postMessage: (message) => responses.push(message),
        adapter,
    });
    runtime.handle(createWorkerRequest({
        type: 'analyze',
        requestId: 'analyze-cancel',
        modelId: MODEL_ID,
        payload: { text: 'long input' },
    }));
    await waitFor(() => analyzeStarted);
    runtime.handle(createWorkerRequest({
        type: 'cancel',
        requestId: 'analyze-cancel',
        reason: 'user-stopped',
    }));
    await waitFor(() => responses.some((message) => message.type === 'cancelled'));

    const cancelled = responses.filter((message) => message.type === 'cancelled');
    assert.equal(cancelled.length, 1);
    assert.deepEqual(cancelled[0], createCancelledResponse({
        requestId: 'analyze-cancel',
        operation: 'analyze',
        reason: 'user-stopped',
    }));
});

test('worker runtime hard cancel clears resources before closing', async () => {
    const responses = [];
    const disposed = [];
    let closed = false;
    const adapter = {
        async load(modelId) {
            return { resource: { modelId }, estimatedBytes: 4 };
        },
        async dispose(resource, context) {
            disposed.push([resource.modelId, context.reason]);
        },
    };
    const runtime = createTokenizerWorkerRuntime({
        postMessage: (message) => responses.push(message),
        close: () => { closed = true; },
        adapter,
    });
    runtime.handle(createWorkerRequest({
        type: 'load',
        requestId: 'load-before-hard-cancel',
        modelId: MODEL_ID,
    }));
    await waitFor(() => responses.some((message) => message.type === 'result'));
    runtime.handle(createWorkerRequest({
        type: 'cancel',
        requestId: 'not-active',
        hard: true,
        reason: 'reset-worker',
    }));
    await waitFor(() => closed);

    assert.deepEqual(disposed, [[MODEL_ID, 'hard-cancel-cache-loss']]);
    const cancelled = responses.at(-1);
    assert.equal(cancelled.type, 'cancelled');
    assert.deepEqual(
        [cancelled.hard, cancelled.terminated, cancelled.cacheLost],
        [true, true, true],
    );
    assert.equal(runtime.cache.activeCount, 0);
});
