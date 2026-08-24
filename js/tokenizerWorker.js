import {
    WORKER_REQUEST_TYPES,
    TokenizerResourceLRU,
    createCancelledResponse,
    createErrorResponse,
    createProgressResponse,
    createResultResponse,
    validateWorkerRequest,
} from './workerProtocol.js';

export const TOKENIZER_WORKER_ADAPTER_METHODS = Object.freeze({
    LOAD: 'load',
    ANALYZE: 'analyze',
    DISPOSE: 'dispose',
    ESTIMATE_BYTES: 'estimateBytes',
});

let registeredAdapter = null;

function workerAdapterMissing(method) {
    const error = new Error(
        `Tokenizer worker adapter method "${method}" has not been configured. `
        + 'Register an adapter before starting the worker entry.',
    );
    error.code = 'WORKER_ADAPTER_MISSING';
    error.retryable = false;
    error.details = { method };
    return error;
}

function requireAdapterMethod(adapter, method) {
    if (!adapter || typeof adapter[method] !== 'function') throw workerAdapterMissing(method);
    return adapter[method].bind(adapter);
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function normalizeLoadedResource(loaded, adapter, modelId) {
    if (isPlainObject(loaded) && Object.hasOwn(loaded, 'resource')) {
        return {
            resource: loaded.resource,
            estimatedBytes: loaded.estimatedBytes ?? 0,
        };
    }
    const estimate = typeof adapter?.estimateBytes === 'function'
        ? adapter.estimateBytes(loaded, modelId)
        : 0;
    return { resource: loaded, estimatedBytes: estimate ?? 0 };
}

function normalizeProgressUpdate(update, fallbackPhase) {
    if (typeof update === 'number') {
        return { phase: fallbackPhase, ratio: update, message: null, details: null };
    }
    const source = isPlainObject(update) ? update : {};
    let ratio = source.ratio ?? null;
    if (ratio === null && typeof source.progress === 'number') {
        ratio = source.progress > 1 ? source.progress / 100 : source.progress;
    }
    return {
        phase: typeof source.phase === 'string' && source.phase.trim() !== ''
            ? source.phase
            : fallbackPhase,
        ratio,
        message: typeof source.message === 'string' && source.message.trim() !== ''
            ? source.message
            : null,
        details: source.details ?? null,
    };
}

function isAbortError(error) {
    return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function operationRetryDefault(operation) {
    return operation === WORKER_REQUEST_TYPES.LOAD || operation === WORKER_REQUEST_TYPES.ANALYZE;
}

export function registerTokenizerWorkerAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') {
        throw new TypeError('Tokenizer worker adapter must be an object.');
    }
    registeredAdapter = adapter;
    return adapter;
}

export function createTokenizerWorkerRuntime({
    postMessage,
    close = null,
    adapter = registeredAdapter,
    maxActiveTokenizers = 2,
    maxEstimatedBytes = Number.POSITIVE_INFINITY,
    resourceCache = null,
} = {}) {
    if (typeof postMessage !== 'function') {
        throw new TypeError('createTokenizerWorkerRuntime.postMessage: expected a function');
    }
    if (close !== null && typeof close !== 'function') {
        throw new TypeError('createTokenizerWorkerRuntime.close: expected a function or null');
    }

    let currentAdapter = adapter;
    const activeRequests = new Map();
    let invalidRequestSequence = 0;
    const cache = resourceCache || new TokenizerResourceLRU({
        maxEntries: maxActiveTokenizers,
        maxEstimatedBytes,
        dispose: async (resource, modelId, reason) => {
            if (currentAdapter && typeof currentAdapter.dispose === 'function') {
                await currentAdapter.dispose(resource, { modelId, reason });
            }
        },
    });

    function send(response) {
        postMessage(response);
        return response;
    }

    function setAdapter(nextAdapter) {
        if (!nextAdapter || typeof nextAdapter !== 'object') {
            throw new TypeError('Tokenizer worker adapter must be an object.');
        }
        currentAdapter = nextAdapter;
    }

    function progressReporter(record, fallbackPhase) {
        return (update) => {
            if (record.cancelled || record.responded) return;
            const normalized = normalizeProgressUpdate(update, fallbackPhase);
            send(createProgressResponse({
                requestId: record.request.requestId,
                operation: record.request.type,
                ...normalized,
            }));
        };
    }

    async function acquireTokenizer(record) {
        const { modelId } = record.request;
        const load = requireAdapterMethod(currentAdapter, TOKENIZER_WORKER_ADAPTER_METHODS.LOAD);
        return cache.acquire(modelId, async () => {
            const loaded = await load(modelId, {
                signal: record.controller.signal,
                onProgress: progressReporter(record, 'loading-tokenizer'),
            });
            return normalizeLoadedResource(loaded, currentAdapter, modelId);
        });
    }

    async function runLoad(record) {
        const cacheHit = cache.has(record.request.modelId);
        await acquireTokenizer(record);
        if (record.cancelled || record.responded) return;
        record.responded = true;
        send(createResultResponse({
            requestId: record.request.requestId,
            operation: record.request.type,
            result: {
                modelId: record.request.modelId,
                cacheHit,
                cache: cache.stats(),
            },
        }));
    }

    async function runAnalyze(record) {
        const resource = await acquireTokenizer(record);
        if (record.cancelled || record.responded) return;
        const analyze = requireAdapterMethod(currentAdapter, TOKENIZER_WORKER_ADAPTER_METHODS.ANALYZE);
        const result = await analyze(resource, record.request.payload, {
            modelId: record.request.modelId,
            signal: record.controller.signal,
            onProgress: progressReporter(record, 'analyzing'),
        });
        if (record.cancelled || record.responded) return;
        record.responded = true;
        send(createResultResponse({
            requestId: record.request.requestId,
            operation: record.request.type,
            result,
        }));
    }

    async function runDispose(record) {
        const { modelId } = record.request;
        const disposed = modelId === null
            ? (await cache.clear('explicit-dispose-all'), true)
            : await cache.delete(modelId, 'explicit-dispose');
        if (record.cancelled || record.responded) return;
        record.responded = true;
        send(createResultResponse({
            requestId: record.request.requestId,
            operation: record.request.type,
            result: {
                modelId,
                disposed,
                cache: cache.stats(),
            },
        }));
    }

    function sendFailure(record, error) {
        if (record.responded) return;
        if (record.cancelled || isAbortError(error)) {
            record.responded = true;
            send(createCancelledResponse({
                requestId: record.request.requestId,
                operation: record.request.type,
                reason: record.cancelReason || 'operation-aborted',
            }));
            return;
        }

        record.responded = true;
        let response;
        try {
            response = createErrorResponse({
                requestId: record.request.requestId,
                operation: record.request.type,
                error,
                retryable: operationRetryDefault(record.request.type),
            });
        } catch (normalizationError) {
            response = createErrorResponse({
                requestId: record.request.requestId,
                operation: record.request.type,
                error: {
                    code: 'WORKER_ERROR_SERIALIZATION_FAILED',
                    message: normalizationError.message,
                    retryable: operationRetryDefault(record.request.type),
                    details: null,
                },
            });
        }
        send(response);
    }

    async function execute(request) {
        const record = {
            request,
            controller: new AbortController(),
            cancelled: false,
            cancelReason: null,
            responded: false,
        };
        activeRequests.set(request.requestId, record);
        try {
            if (request.type === WORKER_REQUEST_TYPES.LOAD) await runLoad(record);
            else if (request.type === WORKER_REQUEST_TYPES.ANALYZE) await runAnalyze(record);
            else await runDispose(record);
        } catch (error) {
            sendFailure(record, error);
        } finally {
            activeRequests.delete(request.requestId);
        }
    }

    async function cancel(request) {
        const record = activeRequests.get(request.requestId);
        const reason = request.reason || 'cancelled-by-client';
        if (record) {
            record.cancelled = true;
            record.cancelReason = reason;
            record.controller.abort(reason);
        }

        if (request.hard) {
            for (const active of activeRequests.values()) {
                active.cancelled = true;
                active.cancelReason = 'worker-hard-cancelled';
                active.controller.abort('worker-hard-cancelled');
            }
            await cache.clear('hard-cancel-cache-loss');
        }

        if (!record || !record.responded) {
            if (record) record.responded = true;
            send(createCancelledResponse({
                requestId: request.requestId,
                operation: record?.request.type || WORKER_REQUEST_TYPES.CANCEL,
                hard: request.hard,
                terminated: request.hard,
                cacheLost: request.hard,
                reason: record ? reason : 'request-not-active',
            }));
        }
        if (request.hard && close) close();
    }

    function invalidRequestError(error, rawRequest) {
        const requestId = typeof rawRequest?.requestId === 'string' && rawRequest.requestId.trim() !== ''
            ? rawRequest.requestId.trim()
            : 'invalid-request-' + (++invalidRequestSequence);
        const operation = Object.values(WORKER_REQUEST_TYPES).includes(rawRequest?.type)
            ? rawRequest.type
            : WORKER_REQUEST_TYPES.CANCEL;
        send(createErrorResponse({
            requestId,
            operation,
            error: {
                code: 'INVALID_WORKER_REQUEST',
                message: error.message,
                retryable: false,
                details: null,
            },
        }));
    }

    function handle(rawRequest) {
        try {
            validateWorkerRequest(rawRequest);
        } catch (error) {
            invalidRequestError(error, rawRequest);
            return;
        }
        if (rawRequest.type === WORKER_REQUEST_TYPES.CANCEL) {
            void cancel(rawRequest).catch((error) => invalidRequestError(error, rawRequest));
            return;
        }
        if (activeRequests.has(rawRequest.requestId)) {
            send(createErrorResponse({
                requestId: rawRequest.requestId,
                operation: rawRequest.type,
                error: {
                    code: 'DUPLICATE_ACTIVE_REQUEST',
                    message: 'A request with this requestId is already active.',
                    retryable: false,
                    details: null,
                },
            }));
            return;
        }
        void execute(rawRequest);
    }

    return Object.freeze({
        handle,
        setAdapter,
        cache,
        get activeRequestIds() {
            return Object.freeze([...activeRequests.keys()]);
        },
    });
}

export function attachTokenizerWorker(scope, options = {}) {
    if (!scope || typeof scope.postMessage !== 'function' || typeof scope.addEventListener !== 'function') {
        throw new TypeError('attachTokenizerWorker.scope: expected a WorkerGlobalScope-like object');
    }
    const runtime = createTokenizerWorkerRuntime({
        ...options,
        postMessage: scope.postMessage.bind(scope),
        close: options.close || (typeof scope.close === 'function' ? scope.close.bind(scope) : null),
        adapter: options.adapter ?? registeredAdapter ?? scope.__TOKENIZER_WORKER_ADAPTER__ ?? null,
    });
    scope.addEventListener('message', (event) => runtime.handle(event.data));
    return runtime;
}

function isWorkerGlobalScope(scope) {
    return typeof WorkerGlobalScope !== 'undefined' && scope instanceof WorkerGlobalScope;
}

// Direct module-worker entry. A wrapper entry may import this module and call
// registerTokenizerWorkerAdapter() in the same module job before this microtask.
if (isWorkerGlobalScope(globalThis)) {
    queueMicrotask(() => {
        if (!globalThis.__TOKENIZER_WORKER_RUNTIME__) {
            globalThis.__TOKENIZER_WORKER_RUNTIME__ = attachTokenizerWorker(globalThis);
        }
    });
}
