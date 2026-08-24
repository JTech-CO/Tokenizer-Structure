import {
    WORKER_REQUEST_TYPES,
    WORKER_RESPONSE_TYPES,
    WorkerRequestError,
    createCancelledResponse,
    createErrorResponse,
    createWorkerRequest,
    validateWorkerResponse,
} from './workerProtocol.js';

export const WORKER_CLIENT_OUTCOME_TYPES = Object.freeze({
    STALE: 'stale',
});

function defaultWorkerFactory() {
    if (typeof Worker !== 'function') {
        throw new Error('Web Worker is not available in this runtime.');
    }
    return new Worker(new URL('./tokenizerWorkerEntry.js', import.meta.url), {
        type: 'module',
        name: 'tokenizer-worker',
    });
}

function optionalCallback(value, path) {
    if (value !== null && typeof value !== 'function') {
        throw new TypeError(path + ': expected a function or null');
    }
    return value;
}

function staleOutcome(requestId, latestRequestId) {
    return Object.freeze({
        type: WORKER_CLIENT_OUTCOME_TYPES.STALE,
        requestId,
        operation: WORKER_REQUEST_TYPES.ANALYZE,
        latestRequestId,
        reason: 'superseded-by-newer-request',
    });
}

function messageFromEvent(event) {
    const eventLike = event !== null
        && (typeof event === 'object' || typeof event === 'function');
    return eventLike && 'data' in event ? event.data : event;
}

export class TokenizerWorkerClient {
    constructor({
        workerFactory = defaultWorkerFactory,
        onProgress = null,
        onProtocolError = null,
    } = {}) {
        if (typeof workerFactory !== 'function') {
            throw new TypeError('TokenizerWorkerClient.workerFactory: expected a function');
        }
        this._workerFactory = workerFactory;
        this._onProgress = optionalCallback(onProgress, 'TokenizerWorkerClient.onProgress');
        this._onProtocolError = optionalCallback(
            onProtocolError,
            'TokenizerWorkerClient.onProtocolError',
        );
        this._worker = null;
        this._workerGeneration = 0;
        this._sequence = 0;
        this._pending = new Map();
        this._failed = new Map();
        this._latestByScope = new Map();
    }

    get state() {
        return Object.freeze({
            workerGeneration: this._workerGeneration,
            activeRequestIds: Object.freeze([...this._pending.keys()]),
            retryableRequestIds: Object.freeze([...this._failed.keys()]),
            latestAnalysisByScope: Object.freeze(Object.fromEntries(this._latestByScope)),
        });
    }

    load(modelId, { requestId = null, onProgress = null } = {}) {
        return this._submit(
            createWorkerRequest({
                type: WORKER_REQUEST_TYPES.LOAD,
                requestId: requestId || this._nextRequestId(WORKER_REQUEST_TYPES.LOAD),
                modelId,
            }),
            { onProgress },
        );
    }

    analyze({
        modelId,
        payload,
        requestId = null,
        scope = 'default',
        onProgress = null,
    }) {
        if (typeof scope !== 'string' || scope.trim() === '') {
            throw new TypeError('TokenizerWorkerClient.analyze.scope: expected a non-empty string');
        }
        const request = createWorkerRequest({
            type: WORKER_REQUEST_TYPES.ANALYZE,
            requestId: requestId || this._nextRequestId(WORKER_REQUEST_TYPES.ANALYZE),
            modelId,
            payload,
        });

        const previousId = this._latestByScope.get(scope);
        this._latestByScope.set(scope, request.requestId);
        if (previousId && previousId !== request.requestId) {
            const previous = this._pending.get(previousId);
            if (previous) {
                this._pending.delete(previousId);
                previous.resolve(staleOutcome(previousId, request.requestId));
            }
        }

        return this._submit(request, { scope, onProgress });
    }

    dispose({ modelId = null, requestId = null } = {}) {
        return this._submit(createWorkerRequest({
            type: WORKER_REQUEST_TYPES.DISPOSE,
            requestId: requestId || this._nextRequestId(WORKER_REQUEST_TYPES.DISPOSE),
            modelId,
        }));
    }

    cancel(requestId, { hard = false, reason = 'cancelled-by-client' } = {}) {
        const record = this._pending.get(requestId);
        if (hard) return this._hardCancel(requestId, record, reason);
        if (!record) {
            return Promise.resolve(createCancelledResponse({
                requestId,
                operation: WORKER_REQUEST_TYPES.CANCEL,
                reason: 'request-not-active',
            }));
        }

        if (!record.cancelRequested) {
            record.cancelRequested = true;
            this._worker.postMessage(createWorkerRequest({
                type: WORKER_REQUEST_TYPES.CANCEL,
                requestId,
                hard: false,
                reason,
            }));
        }
        return record.promise;
    }

    retry(requestId, { requestId: replacementId = null } = {}) {
        const failed = this._failed.get(requestId);
        if (!failed || !failed.error.retryable) {
            throw new WorkerRequestError(createErrorResponse({
                requestId,
                operation: failed?.request.type || WORKER_REQUEST_TYPES.CANCEL,
                error: {
                    code: 'REQUEST_NOT_RETRYABLE',
                    message: 'No retryable worker request exists for this requestId.',
                    retryable: false,
                    details: null,
                },
            }));
        }

        const original = failed.request;
        const nextId = replacementId || this._nextRequestId(original.type);
        const request = createWorkerRequest({ ...original, requestId: nextId });
        this._failed.delete(requestId);

        if (request.type === WORKER_REQUEST_TYPES.ANALYZE) {
            const scope = failed.meta.scope || 'default';
            const previousId = this._latestByScope.get(scope);
            this._latestByScope.set(scope, request.requestId);
            if (previousId && previousId !== request.requestId) {
                const previous = this._pending.get(previousId);
                if (previous) {
                    this._pending.delete(previousId);
                    previous.resolve(staleOutcome(previousId, request.requestId));
                }
            }
        }

        return this._submit(request, failed.meta);
    }

    terminate(reason = 'client-terminated') {
        return this._hardCancel(
            this._pending.keys().next().value || this._nextRequestId(WORKER_REQUEST_TYPES.CANCEL),
            null,
            reason,
        );
    }

    _nextRequestId(operation) {
        let requestId;
        do {
            requestId = operation + '-' + (++this._sequence);
        } while (this._pending.has(requestId) || this._failed.has(requestId));
        return requestId;
    }

    _ensureWorker() {
        if (this._worker) return this._worker;
        const worker = this._workerFactory();
        if (!worker || typeof worker.postMessage !== 'function') {
            throw new TypeError('TokenizerWorkerClient.workerFactory: returned an invalid Worker');
        }
        this._worker = worker;
        this._workerGeneration += 1;

        const generation = this._workerGeneration;
        const onMessage = (event) => {
            if (generation === this._workerGeneration) this._handleMessage(messageFromEvent(event));
        };
        const onError = (event) => {
            if (generation === this._workerGeneration) this._handleWorkerFailure(event);
        };
        if (typeof worker.addEventListener === 'function') {
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onError);
            worker.addEventListener('messageerror', onError);
        } else {
            worker.onmessage = onMessage;
            worker.onerror = onError;
            worker.onmessageerror = onError;
        }
        return worker;
    }

    _submit(request, meta = {}) {
        if (this._pending.has(request.requestId)) {
            throw new TypeError('Duplicate active worker requestId: ' + request.requestId);
        }
        optionalCallback(meta.onProgress || null, 'TokenizerWorkerClient.request.onProgress');

        const worker = this._ensureWorker();
        let resolvePromise;
        let rejectPromise;
        const promise = new Promise((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
        });
        const record = {
            request,
            meta: { ...meta },
            promise,
            resolve: resolvePromise,
            reject: rejectPromise,
            cancelRequested: false,
        };
        this._pending.set(request.requestId, record);

        try {
            worker.postMessage(request);
        } catch (error) {
            this._pending.delete(request.requestId);
            const response = createErrorResponse({
                requestId: request.requestId,
                operation: request.type,
                error,
                defaultCode: 'WORKER_POST_MESSAGE_FAILED',
                retryable: true,
            });
            const requestError = new WorkerRequestError(response, { cause: error });
            this._failed.set(request.requestId, { request, meta: record.meta, error: requestError });
            rejectPromise(requestError);
        }

        return Object.freeze({
            requestId: request.requestId,
            request,
            promise,
            cancel: (options) => this.cancel(request.requestId, options),
        });
    }

    _handleMessage(message) {
        try {
            validateWorkerResponse(message);
        } catch (error) {
            this._handleProtocolError(error, message);
            return;
        }

        const record = this._pending.get(message.requestId);
        if (!record) return;
        if (message.operation !== record.request.type) {
            this._handleProtocolError(
                new TypeError('Worker response operation does not match its request.'), message,
            );
            return;
        }
        if (record.meta.scope) {
            const latestId = this._latestByScope.get(record.meta.scope);
            if (latestId && latestId !== message.requestId) {
                if (message.type !== WORKER_RESPONSE_TYPES.PROGRESS) {
                    this._pending.delete(message.requestId);
                    record.resolve(staleOutcome(message.requestId, latestId));
                }
                return;
            }
        }

        if (message.type === WORKER_RESPONSE_TYPES.PROGRESS) {
            if (record.cancelRequested) return;
            if (record.meta.onProgress) record.meta.onProgress(message);
            if (this._onProgress) this._onProgress(message);
            return;
        }

        this._pending.delete(message.requestId);
        if (message.type === WORKER_RESPONSE_TYPES.ERROR) {
            const error = new WorkerRequestError(message);
            if (error.retryable) {
                this._failed.set(message.requestId, {
                    request: record.request,
                    meta: record.meta,
                    error,
                });
            }
            record.reject(error);
            return;
        }
        record.resolve(message);
    }

    _handleProtocolError(error, message) {
        if (this._onProtocolError) this._onProtocolError(error, message);
        const requestId = message && typeof message.requestId === 'string'
            ? message.requestId
            : null;
        const record = requestId ? this._pending.get(requestId) : null;
        if (!record) return;

        this._pending.delete(requestId);
        const response = createErrorResponse({
            requestId,
            operation: record.request.type,
            error: {
                code: 'WORKER_PROTOCOL_ERROR',
                message: error.message,
                retryable: true,
                details: { receivedType: typeof message?.type === 'string' ? message.type : null },
            },
        });
        const requestError = new WorkerRequestError(response, { cause: error });
        this._failed.set(requestId, { request: record.request, meta: record.meta, error: requestError });
        record.reject(requestError);
    }

    _handleWorkerFailure(event) {
        const message = event && typeof event.message === 'string'
            ? event.message
            : 'The tokenizer worker stopped unexpectedly.';
        const failedWorker = this._worker;
        const records = [...this._pending.values()];
        this._pending.clear();
        if (failedWorker && typeof failedWorker.terminate === 'function') failedWorker.terminate();
        this._worker = null;
        this._workerGeneration += 1;
        this._latestByScope.clear();

        for (const record of records) {
            const response = createErrorResponse({
                requestId: record.request.requestId,
                operation: record.request.type,
                error: {
                    code: 'WORKER_TERMINATED',
                    message,
                    retryable: true,
                    details: { cacheLost: true, terminated: true },
                },
            });
            const error = new WorkerRequestError(response);
            this._failed.set(record.request.requestId, { request: record.request, meta: record.meta, error });
            record.reject(error);
        }
    }

    _hardCancel(requestId, targetRecord, reason) {
        const worker = this._worker;
        if (worker && typeof worker.terminate === 'function') worker.terminate();

        const records = [...this._pending.values()];
        this._pending.clear();
        this._latestByScope.clear();
        this._worker = null;
        this._workerGeneration += 1;

        let targetOutcome = null;
        for (const record of records) {
            const isTarget = record.request.requestId === requestId;
            const outcome = createCancelledResponse({
                requestId: record.request.requestId,
                operation: record.request.type,
                hard: true,
                terminated: true,
                cacheLost: true,
                reason: isTarget ? reason : 'worker-terminated-by-hard-cancel',
            });
            record.resolve(outcome);
            if (isTarget) targetOutcome = outcome;
        }

        if (!targetOutcome) {
            targetOutcome = createCancelledResponse({
                requestId,
                operation: targetRecord?.request.type || WORKER_REQUEST_TYPES.CANCEL,
                hard: true,
                terminated: true,
                cacheLost: true,
                reason,
            });
        }
        return Promise.resolve(targetOutcome);
    }
}
