// Versioned, JSON-safe protocol shared by the tokenizer worker and its clients.

export const TOKENIZER_WORKER_PROTOCOL_VERSION = 1;

export const WORKER_REQUEST_TYPES = Object.freeze({
    LOAD: 'load',
    ANALYZE: 'analyze',
    DISPOSE: 'dispose',
    CANCEL: 'cancel',
});

export const WORKER_RESPONSE_TYPES = Object.freeze({
    PROGRESS: 'progress',
    RESULT: 'result',
    ERROR: 'error',
    CANCELLED: 'cancelled',
});

const REQUEST_TYPE_SET = new Set(Object.values(WORKER_REQUEST_TYPES));
const RESPONSE_TYPE_SET = new Set(Object.values(WORKER_RESPONSE_TYPES));
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function fail(path, message) {
    throw new TypeError(path + ': ' + message);
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, path) {
    if (!isPlainObject(value)) fail(path, 'expected a plain object');
}

function assertKnownKeys(value, allowed, path) {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) fail(path + '.' + key, 'unknown field');
    }
}

function nonEmptyString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(path, 'expected a non-empty string');
    }
    if (value !== value.trim()) fail(path, 'must not contain surrounding whitespace');
    return value;
}

function nullableString(value, path) {
    if (value === null) return null;
    return nonEmptyString(value, path);
}

function finiteNumber(value, path) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(path, 'expected a finite number');
    }
    return value;
}

export function cloneWorkerJson(value, path = 'value', ancestors = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return finiteNumber(value, path);
    if (typeof value !== 'object') fail(path, 'value is not JSON-serializable');
    if (ancestors.has(value)) fail(path, 'cyclic values are not JSON-serializable');

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((item, index) => cloneWorkerJson(item, path + '[' + index + ']', ancestors));
        }
        if (!isPlainObject(value)) fail(path, 'expected JSON arrays or plain objects');

        const copy = {};
        for (const key of Object.keys(value)) {
            if (DANGEROUS_KEYS.has(key)) fail(path + '.' + key, 'unsafe object key');
            copy[key] = cloneWorkerJson(value[key], path + '.' + key, ancestors);
        }
        return copy;
    } finally {
        ancestors.delete(value);
    }
}

function validateProtocolVersion(value, path) {
    if (value !== TOKENIZER_WORKER_PROTOCOL_VERSION) {
        fail(path, 'unsupported protocol version');
    }
}

function validateRequestShape(message) {
    assertPlainObject(message, 'workerRequest');
    validateProtocolVersion(message.protocolVersion, 'workerRequest.protocolVersion');
    if (!REQUEST_TYPE_SET.has(message.type)) fail('workerRequest.type', 'unknown request type');
    nonEmptyString(message.requestId, 'workerRequest.requestId');

    if (message.type === WORKER_REQUEST_TYPES.LOAD) {
        assertKnownKeys(message, ['protocolVersion', 'type', 'requestId', 'modelId'], 'workerRequest');
        nonEmptyString(message.modelId, 'workerRequest.modelId');
        return;
    }
    if (message.type === WORKER_REQUEST_TYPES.ANALYZE) {
        assertKnownKeys(
            message,
            ['protocolVersion', 'type', 'requestId', 'modelId', 'payload'],
            'workerRequest',
        );
        nonEmptyString(message.modelId, 'workerRequest.modelId');
        cloneWorkerJson(message.payload, 'workerRequest.payload');
        return;
    }
    if (message.type === WORKER_REQUEST_TYPES.DISPOSE) {
        assertKnownKeys(message, ['protocolVersion', 'type', 'requestId', 'modelId'], 'workerRequest');
        nullableString(message.modelId, 'workerRequest.modelId');
        return;
    }

    assertKnownKeys(
        message,
        ['protocolVersion', 'type', 'requestId', 'hard', 'reason'],
        'workerRequest',
    );
    if (typeof message.hard !== 'boolean') fail('workerRequest.hard', 'expected a boolean');
    nullableString(message.reason, 'workerRequest.reason');
}

export function validateWorkerRequest(message) {
    validateRequestShape(message);
    return true;
}

export function createWorkerRequest({
    type,
    requestId,
    modelId = null,
    payload = null,
    hard = false,
    reason = null,
}) {
    const base = {
        protocolVersion: TOKENIZER_WORKER_PROTOCOL_VERSION,
        type,
        requestId,
    };
    let request;

    if (type === WORKER_REQUEST_TYPES.LOAD) {
        request = { ...base, modelId };
    } else if (type === WORKER_REQUEST_TYPES.ANALYZE) {
        request = { ...base, modelId, payload: cloneWorkerJson(payload, 'workerRequest.payload') };
    } else if (type === WORKER_REQUEST_TYPES.DISPOSE) {
        request = { ...base, modelId };
    } else if (type === WORKER_REQUEST_TYPES.CANCEL) {
        request = { ...base, hard, reason };
    } else {
        fail('workerRequest.type', 'unknown request type');
    }

    validateRequestShape(request);
    return request;
}

function validateOperation(value, path) {
    if (!REQUEST_TYPE_SET.has(value)) fail(path, 'unknown operation');
    return value;
}

function validateProgress(progress) {
    assertPlainObject(progress, 'workerResponse.progress');
    assertKnownKeys(progress, ['phase', 'ratio', 'message', 'details'], 'workerResponse.progress');
    nonEmptyString(progress.phase, 'workerResponse.progress.phase');
    if (progress.ratio !== null) {
        finiteNumber(progress.ratio, 'workerResponse.progress.ratio');
        if (progress.ratio < 0 || progress.ratio > 1) {
            fail('workerResponse.progress.ratio', 'must be between 0 and 1');
        }
    }
    nullableString(progress.message, 'workerResponse.progress.message');
    if (progress.details !== null) cloneWorkerJson(progress.details, 'workerResponse.progress.details');
}

function validateStructuredError(error) {
    assertPlainObject(error, 'workerResponse.error');
    assertKnownKeys(error, ['code', 'message', 'retryable', 'details'], 'workerResponse.error');
    nonEmptyString(error.code, 'workerResponse.error.code');
    nonEmptyString(error.message, 'workerResponse.error.message');
    if (typeof error.retryable !== 'boolean') {
        fail('workerResponse.error.retryable', 'expected a boolean');
    }
    if (error.details !== null) cloneWorkerJson(error.details, 'workerResponse.error.details');
}

function validateResponseShape(message) {
    assertPlainObject(message, 'workerResponse');
    validateProtocolVersion(message.protocolVersion, 'workerResponse.protocolVersion');
    if (!RESPONSE_TYPE_SET.has(message.type)) fail('workerResponse.type', 'unknown response type');
    nonEmptyString(message.requestId, 'workerResponse.requestId');
    validateOperation(message.operation, 'workerResponse.operation');

    if (message.type === WORKER_RESPONSE_TYPES.PROGRESS) {
        assertKnownKeys(
            message,
            ['protocolVersion', 'type', 'requestId', 'operation', 'progress'],
            'workerResponse',
        );
        validateProgress(message.progress);
        return;
    }
    if (message.type === WORKER_RESPONSE_TYPES.RESULT) {
        assertKnownKeys(
            message,
            ['protocolVersion', 'type', 'requestId', 'operation', 'result'],
            'workerResponse',
        );
        cloneWorkerJson(message.result, 'workerResponse.result');
        return;
    }
    if (message.type === WORKER_RESPONSE_TYPES.ERROR) {
        assertKnownKeys(
            message,
            ['protocolVersion', 'type', 'requestId', 'operation', 'error'],
            'workerResponse',
        );
        validateStructuredError(message.error);
        return;
    }

    assertKnownKeys(
        message,
        ['protocolVersion', 'type', 'requestId', 'operation', 'hard', 'terminated', 'cacheLost', 'reason'],
        'workerResponse',
    );
    if (typeof message.hard !== 'boolean') fail('workerResponse.hard', 'expected a boolean');
    if (typeof message.terminated !== 'boolean') {
        fail('workerResponse.terminated', 'expected a boolean');
    }
    if (typeof message.cacheLost !== 'boolean') {
        fail('workerResponse.cacheLost', 'expected a boolean');
    }
    nonEmptyString(message.reason, 'workerResponse.reason');
}

export function validateWorkerResponse(message) {
    validateResponseShape(message);
    return true;
}

function responseBase(type, requestId, operation) {
    const response = {
        protocolVersion: TOKENIZER_WORKER_PROTOCOL_VERSION,
        type,
        requestId,
        operation,
    };
    nonEmptyString(requestId, 'workerResponse.requestId');
    validateOperation(operation, 'workerResponse.operation');
    return response;
}

export function createProgressResponse({
    requestId,
    operation,
    phase,
    ratio = null,
    message = null,
    details = null,
}) {
    const response = {
        ...responseBase(WORKER_RESPONSE_TYPES.PROGRESS, requestId, operation),
        progress: {
            phase,
            ratio,
            message,
            details: details === null ? null : cloneWorkerJson(details, 'workerResponse.progress.details'),
        },
    };
    validateResponseShape(response);
    return response;
}

export function createResultResponse({ requestId, operation, result }) {
    const response = {
        ...responseBase(WORKER_RESPONSE_TYPES.RESULT, requestId, operation),
        result: cloneWorkerJson(result, 'workerResponse.result'),
    };
    validateResponseShape(response);
    return response;
}

export function normalizeWorkerError(error, {
    defaultCode = 'TOKENIZER_WORKER_ERROR',
    retryable = false,
    details = null,
} = {}) {
    const source = error && typeof error === 'object' ? error : {};
    const code = typeof source.code === 'string' && source.code.trim() !== ''
        ? source.code.trim()
        : defaultCode;
    const candidateMessage = error instanceof Error
        ? error.message
        : typeof source.message === 'string' && source.message.trim() !== ''
            ? source.message
            : typeof error === 'string' && error.trim() !== ''
                ? error
                : 'The tokenizer worker request failed.';
    const message = typeof candidateMessage === 'string' && candidateMessage.trim() !== ''
        ? candidateMessage
        : 'The tokenizer worker request failed.';
    const normalizedDetails = source.details !== undefined ? source.details : details;

    return {
        code,
        message: String(message),
        retryable: typeof source.retryable === 'boolean' ? source.retryable : retryable,
        details: normalizedDetails === null
            ? null
            : cloneWorkerJson(normalizedDetails, 'workerResponse.error.details'),
    };
}

export function createErrorResponse({
    requestId,
    operation,
    error,
    defaultCode,
    retryable,
    details,
}) {
    const response = {
        ...responseBase(WORKER_RESPONSE_TYPES.ERROR, requestId, operation),
        error: normalizeWorkerError(error, { defaultCode, retryable, details }),
    };
    validateResponseShape(response);
    return response;
}

export function createCancelledResponse({
    requestId,
    operation,
    hard = false,
    terminated = false,
    cacheLost = false,
    reason = 'cancelled-by-client',
}) {
    const response = {
        ...responseBase(WORKER_RESPONSE_TYPES.CANCELLED, requestId, operation),
        hard,
        terminated,
        cacheLost,
        reason,
    };
    validateResponseShape(response);
    return response;
}

export class WorkerRequestError extends Error {
    constructor(response, options = {}) {
        validateResponseShape(response);
        if (response.type !== WORKER_RESPONSE_TYPES.ERROR) {
            fail('workerResponse.type', 'expected an error response');
        }
        super(response.error.message, options);
        this.name = 'WorkerRequestError';
        this.code = response.error.code;
        this.retryable = response.error.retryable;
        this.details = response.error.details;
        this.requestId = response.requestId;
        this.operation = response.operation;
        this.response = response;
    }
}

function assertPositiveInteger(value, path) {
    if (!Number.isSafeInteger(value) || value < 1) fail(path, 'expected a positive integer');
}

function assertByteLimit(value, path) {
    if (value === Number.POSITIVE_INFINITY) return;
    if (!Number.isSafeInteger(value) || value < 0) {
        fail(path, 'expected a non-negative safe integer or Infinity');
    }
}

// Async-aware LRU: every eviction awaits the dispose hook before the mutating
// operation resolves, making resource release order deterministic.
export class TokenizerResourceLRU {
    constructor({
        maxEntries = 2,
        maxEstimatedBytes = Number.POSITIVE_INFINITY,
        dispose = async () => {},
    } = {}) {
        assertPositiveInteger(maxEntries, 'TokenizerResourceLRU.maxEntries');
        assertByteLimit(maxEstimatedBytes, 'TokenizerResourceLRU.maxEstimatedBytes');
        if (typeof dispose !== 'function') fail('TokenizerResourceLRU.dispose', 'expected a function');

        this.maxEntries = maxEntries;
        this.maxEstimatedBytes = maxEstimatedBytes;
        this._dispose = dispose;
        this._entries = new Map();
        this._pending = new Map();
        this._estimatedBytes = 0;
    }

    get activeCount() {
        return this._entries.size;
    }

    get pendingCount() {
        return this._pending.size;
    }

    get estimatedBytes() {
        return this._estimatedBytes;
    }

    has(key) {
        return this._entries.has(key);
    }

    peek(key) {
        return this._entries.get(key)?.resource;
    }

    get(key) {
        const entry = this._entries.get(key);
        if (!entry) return undefined;
        this._entries.delete(key);
        this._entries.set(key, entry);
        return entry.resource;
    }

    keys() {
        return [...this._entries.keys()];
    }

    stats() {
        return {
            activeCount: this.activeCount,
            pendingCount: this.pendingCount,
            estimatedBytes: this.estimatedBytes,
            maxEntries: this.maxEntries,
            maxEstimatedBytes: Number.isFinite(this.maxEstimatedBytes)
                ? this.maxEstimatedBytes
                : null,
            keysLeastToMostRecent: this.keys(),
        };
    }

    async set(key, resource, { estimatedBytes = 0 } = {}) {
        nonEmptyString(key, 'TokenizerResourceLRU.key');
        assertByteLimit(estimatedBytes, 'TokenizerResourceLRU.estimatedBytes');
        if (!Number.isFinite(estimatedBytes)) {
            fail('TokenizerResourceLRU.estimatedBytes', 'Infinity is only valid as a limit');
        }

        if (this._entries.has(key)) await this.delete(key, 'replaced');
        this._entries.set(key, { resource, estimatedBytes });
        this._estimatedBytes += estimatedBytes;
        await this._evictToLimits();
        return resource;
    }

    async acquire(key, loader) {
        nonEmptyString(key, 'TokenizerResourceLRU.key');
        if (typeof loader !== 'function') fail('TokenizerResourceLRU.loader', 'expected a function');

        const cached = this.get(key);
        if (cached !== undefined) return cached;
        if (this._pending.has(key)) return this._pending.get(key);

        const pending = Promise.resolve()
            .then(() => loader(key))
            .then(async (loaded) => {
                const wrapped = isPlainObject(loaded) && Object.hasOwn(loaded, 'resource');
                const resource = wrapped ? loaded.resource : loaded;
                const estimatedBytes = wrapped && loaded.estimatedBytes !== undefined
                    ? loaded.estimatedBytes
                    : 0;
                await this.set(key, resource, { estimatedBytes });
                return resource;
            });
        this._pending.set(key, pending);
        try {
            return await pending;
        } finally {
            this._pending.delete(key);
        }
    }

    async delete(key, reason = 'disposed') {
        const entry = this._entries.get(key);
        if (!entry) return false;
        this._entries.delete(key);
        this._estimatedBytes -= entry.estimatedBytes;
        await this._dispose(entry.resource, key, reason);
        return true;
    }

    async clear(reason = 'disposed-all') {
        for (const key of this.keys()) await this.delete(key, reason);
    }

    async _evictToLimits() {
        while (
            this._entries.size > this.maxEntries
            || this._estimatedBytes > this.maxEstimatedBytes
        ) {
            const oldestKey = this._entries.keys().next().value;
            await this.delete(oldestKey, 'lru-evicted');
        }
    }
}
