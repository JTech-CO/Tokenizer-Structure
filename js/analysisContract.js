// Versioned, JSON-safe contracts between tokenizer adapters, workers, and views.
// This module only depends on the pure Unicode metrics helper so it can run in
// browsers, workers, and Node-based tests.
import { measureText } from './unicodeMetrics.js';

export const ANALYSIS_SCHEMA_VERSION = 1;

export const ANALYSIS_TYPES = Object.freeze({
    REQUEST: 'analysis-request',
    RESULT: 'analysis-result',
});

export const ANALYSIS_ENGINES = Object.freeze({
    REAL: 'real',
    HEURISTIC: 'heuristic',
});

export const EVIDENCE_GRADES = Object.freeze({
    AUTHORITATIVE: 'authoritative',
    DERIVED: 'derived',
    HEURISTIC: 'heuristic',
    UNAVAILABLE: 'unavailable',
});

export const UNAVAILABLE_REASONS = Object.freeze({
    RUNTIME_NOT_EXPOSED: 'runtime-not-exposed',
    HEURISTIC_ENGINE: 'heuristic-engine',
    NOT_COMPUTED: 'not-computed',
    NOT_PROVIDED: 'not-provided',
    UNSUPPORTED: 'unsupported',
});

export const CAPABILITY_NAMES = Object.freeze([
    'normalization',
    'tokenStrings',
    'tokenIds',
    'displayStrings',
    'originalOffsets',
    'normalizedOffsets',
]);

const EVIDENCE_GRADE_SET = new Set(Object.values(EVIDENCE_GRADES));
const UNAVAILABLE_REASON_SET = new Set(Object.values(UNAVAILABLE_REASONS));
const ENGINE_SET = new Set(Object.values(ANALYSIS_ENGINES));
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

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
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

function cloneJsonValue(value, path, ancestors = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail(path, 'numbers must be finite');
        return value;
    }
    if (typeof value !== 'object') fail(path, 'value is not JSON-serializable');
    if (ancestors.has(value)) fail(path, 'cyclic values are not JSON-serializable');

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((item, index) => cloneJsonValue(item, path + '[' + index + ']', ancestors));
        }
        if (!isPlainObject(value)) fail(path, 'expected JSON arrays or plain objects');

        const copy = {};
        for (const key of Object.keys(value)) {
            if (DANGEROUS_KEYS.has(key)) fail(path + '.' + key, 'unsafe object key');
            copy[key] = cloneJsonValue(value[key], path + '.' + key, ancestors);
        }
        return copy;
    } finally {
        ancestors.delete(value);
    }
}

function normalizeStringArray(value, path) {
    if (!Array.isArray(value)) fail(path, 'expected an array');
    return value.map((item, index) => {
        if (typeof item !== 'string') fail(path + '[' + index + ']', 'expected a string');
        return item;
    });
}

function normalizeIds(value, path) {
    const isTypedArray = ArrayBuffer.isView(value) && !(value instanceof DataView);
    if (!Array.isArray(value) && !isTypedArray) fail(path, 'expected an array or typed array');

    return Array.from(value, (id, index) => {
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
            fail(path + '[' + index + ']', 'expected a non-negative safe integer');
        }
        return id;
    });
}

function normalizePieces(value, subwords) {
    if (!Array.isArray(value)) fail('tokenizerResult.pieces', 'expected an array');
    if (value.length !== subwords.length) {
        fail('tokenizerResult.pieces', 'length must equal subwords.length');
    }

    return value.map((piece, index) => {
        const path = 'tokenizerResult.pieces[' + index + ']';
        assertPlainObject(piece, path);

        if (typeof piece.token !== 'string') fail(path + '.token', 'expected a string');
        if (piece.token !== subwords[index]) fail(path + '.token', 'must match subwords at the same index');
        if (typeof piece.surface !== 'string') fail(path + '.surface', 'expected a string');
        if (typeof piece.display !== 'string') fail(path + '.display', 'expected a string');
        if (typeof piece.continuation !== 'boolean') fail(path + '.continuation', 'expected a boolean');

        const codePointLength = [...piece.surface].length;
        if (hasOwn(piece, 'len') && piece.len !== codePointLength) {
            fail(path + '.len', 'must equal the surface code-point length');
        }
        if (hasOwn(piece, 'lengthUnit') && piece.lengthUnit !== 'codePoint') {
            fail(path + '.lengthUnit', 'must be codePoint');
        }

        return {
            token: piece.token,
            surface: piece.surface,
            display: piece.display,
            continuation: piece.continuation,
            len: codePointLength,
            lengthUnit: 'codePoint',
        };
    });
}

function defaultCapability(available, unavailableReason = null) {
    return { available, unavailableReason };
}

function defaultCapabilities(engine) {
    const offsetReason = engine === ANALYSIS_ENGINES.HEURISTIC
        ? UNAVAILABLE_REASONS.HEURISTIC_ENGINE
        : UNAVAILABLE_REASONS.RUNTIME_NOT_EXPOSED;

    return {
        normalization: defaultCapability(true),
        tokenStrings: defaultCapability(true),
        tokenIds: defaultCapability(true),
        displayStrings: defaultCapability(true),
        originalOffsets: defaultCapability(false, offsetReason),
        normalizedOffsets: defaultCapability(false, offsetReason),
    };
}

function normalizeCapability(value, fallback, path) {
    if (typeof value === 'boolean') {
        return value
            ? defaultCapability(true)
            : defaultCapability(false, UNAVAILABLE_REASONS.NOT_PROVIDED);
    }

    assertPlainObject(value, path);
    assertKnownKeys(value, ['available', 'unavailableReason'], path);
    const available = hasOwn(value, 'available') ? value.available : fallback.available;
    if (typeof available !== 'boolean') fail(path + '.available', 'expected a boolean');

    let unavailableReason;
    if (hasOwn(value, 'unavailableReason')) {
        unavailableReason = value.unavailableReason;
    } else if (available) {
        unavailableReason = null;
    } else if (!fallback.available) {
        unavailableReason = fallback.unavailableReason;
    } else {
        unavailableReason = UNAVAILABLE_REASONS.NOT_PROVIDED;
    }

    return { available, unavailableReason };
}

export function validateCapabilities(capabilities) {
    assertPlainObject(capabilities, 'capabilities');
    assertKnownKeys(capabilities, CAPABILITY_NAMES, 'capabilities');

    for (const name of CAPABILITY_NAMES) {
        const path = 'capabilities.' + name;
        const capability = capabilities[name];
        assertPlainObject(capability, path);
        assertKnownKeys(capability, ['available', 'unavailableReason'], path);
        if (typeof capability.available !== 'boolean') fail(path + '.available', 'expected a boolean');

        if (capability.available) {
            if (capability.unavailableReason !== null) {
                fail(path + '.unavailableReason', 'must be null when available');
            }
        } else if (!UNAVAILABLE_REASON_SET.has(capability.unavailableReason)) {
            fail(path + '.unavailableReason', 'expected a documented unavailable reason');
        }
    }
    return true;
}

export function normalizeCapabilities(capabilities = {}, context = {}) {
    assertPlainObject(context, 'context');
    const engine = context.engine;
    if (!ENGINE_SET.has(engine)) fail('context.engine', 'expected real or heuristic');
    assertPlainObject(capabilities, 'capabilities');
    assertKnownKeys(capabilities, CAPABILITY_NAMES, 'capabilities');

    const defaults = defaultCapabilities(engine);
    const normalized = {};
    for (const name of CAPABILITY_NAMES) {
        normalized[name] = hasOwn(capabilities, name)
            ? normalizeCapability(capabilities[name], defaults[name], 'capabilities.' + name)
            : { ...defaults[name] };
    }

    validateCapabilities(normalized);
    return normalized;
}

function normalizeComponent(value, fallback, path, required) {
    if (value === undefined) {
        if (required) fail(path, 'is required');
        return { ...fallback };
    }

    assertPlainObject(value, path);
    assertKnownKeys(value, ['name', 'version'], path);
    return {
        name: nonEmptyString(value.name, path + '.name'),
        version: nonEmptyString(value.version, path + '.version'),
    };
}

export function validateProvenance(provenance, context = {}) {
    assertPlainObject(context, 'context');
    const engine = context.engine;
    const modelId = context.modelId;
    if (!ENGINE_SET.has(engine)) fail('context.engine', 'expected real or heuristic');

    assertPlainObject(provenance, 'provenance');
    assertKnownKeys(provenance, ['source', 'adapter', 'runtime', 'artifact'], 'provenance');
    if (provenance.source !== (engine === ANALYSIS_ENGINES.REAL ? 'artifact' : 'heuristic')) {
        fail('provenance.source', 'does not match engine');
    }

    for (const componentName of ['adapter', 'runtime']) {
        const component = provenance[componentName];
        const path = 'provenance.' + componentName;
        assertPlainObject(component, path);
        assertKnownKeys(component, ['name', 'version'], path);
        nonEmptyString(component.name, path + '.name');
        nonEmptyString(component.version, path + '.version');
    }

    if (engine === ANALYSIS_ENGINES.HEURISTIC) {
        if (provenance.artifact !== null) fail('provenance.artifact', 'must be null for heuristic results');
    } else {
        assertPlainObject(provenance.artifact, 'provenance.artifact');
        assertKnownKeys(provenance.artifact, ['id', 'revision'], 'provenance.artifact');
        const artifactId = nonEmptyString(provenance.artifact.id, 'provenance.artifact.id');
        nonEmptyString(provenance.artifact.revision, 'provenance.artifact.revision');
        if (artifactId !== modelId) fail('provenance.artifact.id', 'must match result modelId');
    }

    return true;
}

export function normalizeProvenance(provenance, context = {}) {
    assertPlainObject(context, 'context');
    const engine = context.engine;
    const modelId = context.modelId;
    if (!ENGINE_SET.has(engine)) fail('context.engine', 'expected real or heuristic');

    if (provenance === undefined) {
        if (engine === ANALYSIS_ENGINES.REAL) fail('provenance', 'is required for real results');
        provenance = {};
    }
    assertPlainObject(provenance, 'provenance');
    assertKnownKeys(provenance, ['source', 'adapter', 'runtime', 'artifact'], 'provenance');
    const expectedSource = engine === ANALYSIS_ENGINES.REAL ? 'artifact' : 'heuristic';
    if (hasOwn(provenance, 'source') && provenance.source !== expectedSource) {
        fail('provenance.source', 'does not match engine');
    }

    const normalized = {
        source: expectedSource,
        adapter: normalizeComponent(
            provenance.adapter,
            { name: 'tokenizer-structure/analysis-contract', version: String(ANALYSIS_SCHEMA_VERSION) },
            'provenance.adapter',
            false,
        ),
        runtime: normalizeComponent(
            provenance.runtime,
            { name: 'tokenizer-structure/heuristic', version: String(ANALYSIS_SCHEMA_VERSION) },
            'provenance.runtime',
            engine === ANALYSIS_ENGINES.REAL,
        ),
        artifact: null,
    };

    if (engine === ANALYSIS_ENGINES.REAL) {
        assertPlainObject(provenance.artifact, 'provenance.artifact');
        assertKnownKeys(provenance.artifact, ['id', 'revision'], 'provenance.artifact');
        normalized.artifact = {
            id: nonEmptyString(provenance.artifact.id, 'provenance.artifact.id'),
            revision: nonEmptyString(provenance.artifact.revision, 'provenance.artifact.revision'),
        };
    } else if (hasOwn(provenance, 'artifact') && provenance.artifact !== null) {
        fail('provenance.artifact', 'must be null for heuristic results');
    }

    validateProvenance(normalized, { engine, modelId });
    return normalized;
}

function defaultEvidenceGrade(name, engine, capability) {
    if (!capability.available) return EVIDENCE_GRADES.UNAVAILABLE;
    if (name === 'displayStrings') return EVIDENCE_GRADES.DERIVED;
    return engine === ANALYSIS_ENGINES.REAL
        ? EVIDENCE_GRADES.AUTHORITATIVE
        : EVIDENCE_GRADES.HEURISTIC;
}

function normalizeEvidenceClaim(value, fallback, path) {
    if (typeof value === 'string') {
        return {
            grade: value,
            unavailableReason: value === EVIDENCE_GRADES.UNAVAILABLE
                ? fallback.unavailableReason
                : null,
        };
    }

    assertPlainObject(value, path);
    assertKnownKeys(value, ['grade', 'unavailableReason'], path);
    const grade = hasOwn(value, 'grade') ? value.grade : fallback.grade;
    const unavailableReason = hasOwn(value, 'unavailableReason')
        ? value.unavailableReason
        : grade === EVIDENCE_GRADES.UNAVAILABLE
            ? fallback.unavailableReason
            : null;
    return { grade, unavailableReason };
}

export function validateEvidence(evidence, context = {}) {
    assertPlainObject(context, 'context');
    const engine = context.engine;
    const capabilities = context.capabilities;
    if (!ENGINE_SET.has(engine)) fail('context.engine', 'expected real or heuristic');
    validateCapabilities(capabilities);

    assertPlainObject(evidence, 'evidence');
    assertKnownKeys(evidence, CAPABILITY_NAMES, 'evidence');
    for (const name of CAPABILITY_NAMES) {
        const claim = evidence[name];
        const capability = capabilities[name];
        const path = 'evidence.' + name;
        assertPlainObject(claim, path);
        assertKnownKeys(claim, ['grade', 'unavailableReason'], path);
        if (!EVIDENCE_GRADE_SET.has(claim.grade)) fail(path + '.grade', 'expected a documented evidence grade');

        if (claim.grade === EVIDENCE_GRADES.UNAVAILABLE) {
            if (!UNAVAILABLE_REASON_SET.has(claim.unavailableReason)) {
                fail(path + '.unavailableReason', 'expected a documented unavailable reason');
            }
            if (capability.available) fail(path + '.grade', 'cannot be unavailable when capability is available');
            if (claim.unavailableReason !== capability.unavailableReason) {
                fail(path + '.unavailableReason', 'must match capability unavailableReason');
            }
        } else {
            if (!capability.available) fail(path + '.grade', 'must be unavailable when capability is unavailable');
            if (claim.unavailableReason !== null) {
                fail(path + '.unavailableReason', 'must be null when evidence is available');
            }
        }

        if (engine === ANALYSIS_ENGINES.HEURISTIC && claim.grade === EVIDENCE_GRADES.AUTHORITATIVE) {
            fail(path + '.grade', 'heuristic results cannot claim authoritative evidence');
        }
        if (name === 'displayStrings' && claim.grade !== EVIDENCE_GRADES.DERIVED) {
            fail(path + '.grade', 'display strings must be marked derived');
        }
    }
    return true;
}

export function normalizeEvidence(evidence = {}, context = {}) {
    assertPlainObject(context, 'context');
    const engine = context.engine;
    const capabilities = context.capabilities;
    if (!ENGINE_SET.has(engine)) fail('context.engine', 'expected real or heuristic');
    validateCapabilities(capabilities);
    assertPlainObject(evidence, 'evidence');
    assertKnownKeys(evidence, CAPABILITY_NAMES, 'evidence');

    const normalized = {};
    for (const name of CAPABILITY_NAMES) {
        const fallback = {
            grade: defaultEvidenceGrade(name, engine, capabilities[name]),
            unavailableReason: capabilities[name].available
                ? null
                : capabilities[name].unavailableReason,
        };
        normalized[name] = hasOwn(evidence, name)
            ? normalizeEvidenceClaim(evidence[name], fallback, 'evidence.' + name)
            : fallback;
    }

    validateEvidence(normalized, { engine, capabilities });
    return normalized;
}

function validateInputMetrics(input) {
    assertPlainObject(input, 'input');
    assertKnownKeys(
        input,
        [
            'text',
            'utf16Length',
            'codePointLength',
            'graphemeLength',
            'graphemeUnavailableReason',
            'utf8ByteLength',
        ],
        'input',
    );
    if (typeof input.text !== 'string') fail('input.text', 'expected a string');

    const measured = measureText(input.text);
    const expected = {
        utf16Length: measured.utf16CodeUnits,
        codePointLength: measured.codePoints,
        graphemeLength: measured.graphemes,
        graphemeUnavailableReason: measured.graphemesUnavailableReason,
        utf8ByteLength: measured.utf8Bytes,
    };
    for (const key of Object.keys(expected)) {
        if (input[key] !== expected[key]) fail('input.' + key, 'does not match input.text');
    }
}

function inputMetrics(text) {
    const measured = measureText(text);
    return {
        text,
        utf16Length: measured.utf16CodeUnits,
        codePointLength: measured.codePoints,
        graphemeLength: measured.graphemes,
        graphemeUnavailableReason: measured.graphemesUnavailableReason,
        utf8ByteLength: measured.utf8Bytes,
    };
}

function normalizeWarnings(value = []) {
    if (!Array.isArray(value)) fail('warnings', 'expected an array');
    return value.map((warning, index) => {
        const path = 'warnings[' + index + ']';
        assertPlainObject(warning, path);
        assertKnownKeys(warning, ['code', 'message'], path);
        return {
            code: nonEmptyString(warning.code, path + '.code'),
            message: nonEmptyString(warning.message, path + '.message'),
        };
    });
}

function normalizeFallbackReason(value) {
    if (value === undefined || value === null) return null;
    assertPlainObject(value, 'fallbackReason');
    assertKnownKeys(value, ['code', 'message'], 'fallbackReason');
    return {
        code: nonEmptyString(value.code, 'fallbackReason.code'),
        message: nonEmptyString(value.message, 'fallbackReason.message'),
    };
}

export function validateAnalysisRequest(request) {
    assertPlainObject(request, 'request');
    assertKnownKeys(
        request,
        ['schemaVersion', 'type', 'requestId', 'modelId', 'text', 'options'],
        'request',
    );
    if (request.schemaVersion !== ANALYSIS_SCHEMA_VERSION) fail('request.schemaVersion', 'unsupported version');
    if (request.type !== ANALYSIS_TYPES.REQUEST) fail('request.type', 'expected analysis-request');
    nonEmptyString(request.requestId, 'request.requestId');
    nullableString(request.modelId, 'request.modelId');
    if (typeof request.text !== 'string') fail('request.text', 'expected a string');
    assertPlainObject(request.options, 'request.options');
    cloneJsonValue(request.options, 'request.options');
    return true;
}

export function createAnalysisRequest(input) {
    assertPlainObject(input, 'input');
    assertKnownKeys(
        input,
        ['schemaVersion', 'type', 'requestId', 'modelId', 'text', 'options'],
        'input',
    );
    if (hasOwn(input, 'schemaVersion') && input.schemaVersion !== ANALYSIS_SCHEMA_VERSION) {
        fail('input.schemaVersion', 'unsupported version');
    }
    if (hasOwn(input, 'type') && input.type !== ANALYSIS_TYPES.REQUEST) {
        fail('input.type', 'expected analysis-request');
    }

    const request = {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        type: ANALYSIS_TYPES.REQUEST,
        requestId: nonEmptyString(input.requestId, 'input.requestId'),
        modelId: input.modelId === undefined ? null : nullableString(input.modelId, 'input.modelId'),
        text: typeof input.text === 'string' ? input.text : fail('input.text', 'expected a string'),
        options: cloneJsonValue(input.options === undefined ? {} : input.options, 'input.options'),
    };
    assertPlainObject(request.options, 'request.options');
    validateAnalysisRequest(request);
    return request;
}

function validateWarnings(warnings) {
    if (!Array.isArray(warnings)) fail('result.warnings', 'expected an array');
    for (let index = 0; index < warnings.length; index++) {
        const warning = warnings[index];
        const path = 'result.warnings[' + index + ']';
        assertPlainObject(warning, path);
        assertKnownKeys(warning, ['code', 'message'], path);
        nonEmptyString(warning.code, path + '.code');
        nonEmptyString(warning.message, path + '.message');
    }
}

function validateFallbackReason(fallbackReason, engine, requestedModelId) {
    if (fallbackReason === null) {
        if (engine === ANALYSIS_ENGINES.HEURISTIC && requestedModelId !== null) {
            fail('result.fallbackReason', 'is required when a requested model falls back to heuristic');
        }
        return;
    }

    assertPlainObject(fallbackReason, 'result.fallbackReason');
    assertKnownKeys(fallbackReason, ['code', 'message'], 'result.fallbackReason');
    nonEmptyString(fallbackReason.code, 'result.fallbackReason.code');
    nonEmptyString(fallbackReason.message, 'result.fallbackReason.message');
    if (engine !== ANALYSIS_ENGINES.HEURISTIC) {
        fail('result.fallbackReason', 'is only valid for heuristic results');
    }
}

export function validateAnalysisResult(result) {
    assertPlainObject(result, 'result');
    assertKnownKeys(
        result,
        [
            'schemaVersion', 'type', 'requestId', 'requestedModelId', 'modelId', 'engine',
            'input', 'options', 'normalized', 'preTokens', 'subwords', 'finalTokens', 'ids',
            'pieces', 'preDisplay', 'finDisplay', 'provenance', 'capabilities', 'evidence',
            'warnings', 'fallbackReason',
        ],
        'result',
    );
    if (result.schemaVersion !== ANALYSIS_SCHEMA_VERSION) fail('result.schemaVersion', 'unsupported version');
    if (result.type !== ANALYSIS_TYPES.RESULT) fail('result.type', 'expected analysis-result');
    nonEmptyString(result.requestId, 'result.requestId');
    const requestedModelId = nullableString(result.requestedModelId, 'result.requestedModelId');
    if (!ENGINE_SET.has(result.engine)) fail('result.engine', 'expected real or heuristic');

    if (result.engine === ANALYSIS_ENGINES.REAL) {
        const modelId = nonEmptyString(result.modelId, 'result.modelId');
        if (requestedModelId === null || requestedModelId !== modelId) {
            fail('result.modelId', 'must match requestedModelId for real results');
        }
    } else if (result.modelId !== null) {
        fail('result.modelId', 'must be null for heuristic results');
    }

    validateInputMetrics(result.input);
    assertPlainObject(result.options, 'result.options');
    cloneJsonValue(result.options, 'result.options');
    if (typeof result.normalized !== 'string') fail('result.normalized', 'expected a string');

    const preTokens = normalizeStringArray(result.preTokens, 'result.preTokens');
    const subwords = normalizeStringArray(result.subwords, 'result.subwords');
    const finalTokens = normalizeStringArray(result.finalTokens, 'result.finalTokens');
    if (!Array.isArray(result.ids)) fail('result.ids', 'contract results require a plain array');
    const ids = normalizeIds(result.ids, 'result.ids');
    const preDisplay = normalizeStringArray(result.preDisplay, 'result.preDisplay');
    const finDisplay = normalizeStringArray(result.finDisplay, 'result.finDisplay');

    if (ids.length !== finalTokens.length) fail('result.ids', 'length must equal finalTokens.length');
    if (preDisplay.length !== preTokens.length) {
        fail('result.preDisplay', 'length must equal preTokens.length');
    }
    if (finDisplay.length !== finalTokens.length) {
        fail('result.finDisplay', 'length must equal finalTokens.length');
    }

    if (!Array.isArray(result.pieces) || result.pieces.length !== subwords.length) {
        fail('result.pieces', 'length must equal subwords.length');
    }
    for (let index = 0; index < result.pieces.length; index++) {
        const piece = result.pieces[index];
        const path = 'result.pieces[' + index + ']';
        assertPlainObject(piece, path);
        assertKnownKeys(piece, ['token', 'surface', 'display', 'continuation', 'len', 'lengthUnit'], path);
        if (piece.token !== subwords[index]) fail(path + '.token', 'must match subwords at the same index');
        if (typeof piece.surface !== 'string') fail(path + '.surface', 'expected a string');
        if (typeof piece.display !== 'string') fail(path + '.display', 'expected a string');
        if (typeof piece.continuation !== 'boolean') fail(path + '.continuation', 'expected a boolean');
        if (piece.len !== [...piece.surface].length) fail(path + '.len', 'must equal surface code-point length');
        if (piece.lengthUnit !== 'codePoint') fail(path + '.lengthUnit', 'must be codePoint');
    }

    validateProvenance(result.provenance, { engine: result.engine, modelId: result.modelId });
    validateCapabilities(result.capabilities);
    validateEvidence(result.evidence, { engine: result.engine, capabilities: result.capabilities });
    validateWarnings(result.warnings);
    validateFallbackReason(result.fallbackReason, result.engine, requestedModelId);

    const serialized = JSON.stringify(result);
    if (typeof serialized !== 'string') fail('result', 'must be JSON-serializable');
    return true;
}

export function createAnalysisResult({
    request,
    tokenizerResult,
    provenance,
    capabilities = {},
    evidence = {},
    warnings = [],
    fallbackReason = null,
}) {
    validateAnalysisRequest(request);
    assertPlainObject(tokenizerResult, 'tokenizerResult');

    const engine = tokenizerResult.engine;
    if (!ENGINE_SET.has(engine)) fail('tokenizerResult.engine', 'expected real or heuristic');

    let modelId;
    if (engine === ANALYSIS_ENGINES.REAL) {
        modelId = nonEmptyString(tokenizerResult.modelId, 'tokenizerResult.modelId');
        if (request.modelId === null || request.modelId !== modelId) {
            fail('tokenizerResult.modelId', 'must match request.modelId for real results');
        }
    } else {
        if (tokenizerResult.modelId !== null) {
            fail('tokenizerResult.modelId', 'must be null for heuristic results');
        }
        modelId = null;
    }

    if (typeof tokenizerResult.normalized !== 'string') {
        fail('tokenizerResult.normalized', 'expected a string');
    }
    const preTokens = normalizeStringArray(tokenizerResult.preTokens, 'tokenizerResult.preTokens');
    const subwords = normalizeStringArray(tokenizerResult.subwords, 'tokenizerResult.subwords');
    const finalTokens = normalizeStringArray(tokenizerResult.finalTokens, 'tokenizerResult.finalTokens');
    const ids = normalizeIds(tokenizerResult.ids, 'tokenizerResult.ids');
    const pieces = normalizePieces(tokenizerResult.pieces, subwords);
    const preDisplay = normalizeStringArray(tokenizerResult.preDisplay, 'tokenizerResult.preDisplay');
    const finDisplay = normalizeStringArray(tokenizerResult.finDisplay, 'tokenizerResult.finDisplay');

    if (ids.length !== finalTokens.length) {
        fail('tokenizerResult.ids', 'length must equal finalTokens.length');
    }
    if (preDisplay.length !== preTokens.length) {
        fail('tokenizerResult.preDisplay', 'length must equal preTokens.length');
    }
    if (finDisplay.length !== finalTokens.length) {
        fail('tokenizerResult.finDisplay', 'length must equal finalTokens.length');
    }

    const normalizedCapabilities = normalizeCapabilities(capabilities, { engine });
    const normalizedEvidence = normalizeEvidence(evidence, {
        engine,
        capabilities: normalizedCapabilities,
    });
    const normalizedFallbackReason = normalizeFallbackReason(fallbackReason);

    const result = {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        type: ANALYSIS_TYPES.RESULT,
        requestId: request.requestId,
        requestedModelId: request.modelId,
        modelId,
        engine,
        input: inputMetrics(request.text),
        options: cloneJsonValue(request.options, 'request.options'),
        normalized: tokenizerResult.normalized,
        preTokens,
        subwords,
        finalTokens,
        ids,
        pieces,
        preDisplay,
        finDisplay,
        provenance: normalizeProvenance(provenance, { engine, modelId }),
        capabilities: normalizedCapabilities,
        evidence: normalizedEvidence,
        warnings: normalizeWarnings(warnings),
        fallbackReason: normalizedFallbackReason,
    };

    validateAnalysisResult(result);
    return result;
}
