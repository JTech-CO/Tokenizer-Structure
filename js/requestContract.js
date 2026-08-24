// requestContract.js — P2 Request Token Lab의 버전된 요청/결과 계약.
// analysisContract와 같은 원칙을 따른다: JSON-safe, 알 수 없는 필드 거부,
// 지원하지 않는 값은 0이나 추정값으로 채우지 않고 unavailableReason을 남긴다.
import { EVIDENCE_GRADES, UNAVAILABLE_REASONS } from './analysisContract.js';

export const REQUEST_SCHEMA_VERSION = 1;

export const REQUEST_TYPES = Object.freeze({
    SPEC: 'request-spec',
    RESULT: 'request-analysis-result',
});

export const REQUEST_ROLES = Object.freeze(['system', 'user', 'assistant', 'tool']);

// analysisContract의 사유에 P2에서만 발생하는 사유를 더한 집합.
export const REQUEST_UNAVAILABLE_REASONS = Object.freeze({
    ...UNAVAILABLE_REASONS,
    ARTIFACT_NO_CHAT_TEMPLATE: 'artifact-no-chat-template',
    TEMPLATE_IGNORES_FIELD: 'template-ignores-field',
    TEMPLATE_REJECTS_INPUT: 'template-rejects-input',
    GATEWAY_NOT_CONFIGURED: 'gateway-not-configured',
    CATALOG_HAS_NO_RATE: 'catalog-has-no-rate',
});

export const REQUEST_CAPABILITY_NAMES = Object.freeze([
    'chatTemplate',
    'addGenerationPrompt',
    'tools',
    'documents',
    'systemRole',
    'assistantRole',
    'toolRole',
]);

export const REQUEST_SEGMENT_KINDS = Object.freeze([
    'tools', 'documents', 'message', 'generation-prompt',
]);

export const PROVIDER_COUNT_SLOTS = Object.freeze(['preflight', 'actual']);

export const REQUEST_LIMITS = Object.freeze({
    maxMessages: 64,
    maxContentCodePoints: 50_000,
    maxTotalContentCodePoints: 200_000,
    maxTools: 16,
    maxDocuments: 16,
    maxToolNameLength: 64,
    maxToolSchemaBytes: 20_000,
    maxToolSchemaDepth: 8,
    maxDocumentTextCodePoints: 20_000,
});

const ROLE_SET = new Set(REQUEST_ROLES);
const EVIDENCE_SET = new Set(Object.values(EVIDENCE_GRADES));
const REASON_SET = new Set(Object.values(REQUEST_UNAVAILABLE_REASONS));
const SEGMENT_KIND_SET = new Set(REQUEST_SEGMENT_KINDS);
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

function codePointLength(value) {
    return [...value].length;
}

// tool JSON schema는 사용자가 붙여넣는 임의 구조라 깊이·크기·키를 모두 제한한다.
function cloneBoundedJson(value, path, depth, seen) {
    if (depth > REQUEST_LIMITS.maxToolSchemaDepth) {
        fail(path, `exceeds the maximum nesting depth of ${REQUEST_LIMITS.maxToolSchemaDepth}`);
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail(path, 'numbers must be finite');
        return value;
    }
    if (typeof value !== 'object') fail(path, 'value is not JSON-serializable');
    if (seen.has(value)) fail(path, 'cyclic values are not JSON-serializable');

    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((item, index) => cloneBoundedJson(item, `${path}[${index}]`, depth + 1, seen));
        }
        if (!isPlainObject(value)) fail(path, 'expected JSON arrays or plain objects');
        const copy = {};
        for (const key of Object.keys(value)) {
            if (DANGEROUS_KEYS.has(key)) fail(`${path}.${key}`, 'unsafe object key');
            copy[key] = cloneBoundedJson(value[key], `${path}.${key}`, depth + 1, seen);
        }
        return copy;
    } finally {
        seen.delete(value);
    }
}

function normalizeMessage(value, path) {
    assertPlainObject(value, path);
    assertKnownKeys(value, ['role', 'content'], path);
    if (!ROLE_SET.has(value.role)) {
        fail(`${path}.role`, `expected one of ${REQUEST_ROLES.join(', ')}`);
    }
    if (typeof value.content !== 'string') fail(`${path}.content`, 'expected a string');
    if (value.content === '') fail(`${path}.content`, 'expected a non-empty string');
    if (codePointLength(value.content) > REQUEST_LIMITS.maxContentCodePoints) {
        fail(`${path}.content`, `must not exceed ${REQUEST_LIMITS.maxContentCodePoints} code points`);
    }
    return { role: value.role, content: value.content };
}

function normalizeTool(value, path) {
    assertPlainObject(value, path);
    assertKnownKeys(value, ['type', 'function'], path);
    if (value.type !== 'function') fail(`${path}.type`, 'expected function');
    assertPlainObject(value.function, `${path}.function`);
    assertKnownKeys(value.function, ['name', 'description', 'parameters'], `${path}.function`);

    const name = value.function.name;
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) {
        fail(`${path}.function.name`, 'expected an identifier-like name');
    }
    if (name.length > REQUEST_LIMITS.maxToolNameLength) {
        fail(`${path}.function.name`, `must not exceed ${REQUEST_LIMITS.maxToolNameLength} characters`);
    }
    const description = hasOwn(value.function, 'description') ? value.function.description : '';
    if (typeof description !== 'string') fail(`${path}.function.description`, 'expected a string');

    const parameters = hasOwn(value.function, 'parameters')
        ? cloneBoundedJson(value.function.parameters, `${path}.function.parameters`, 0, new WeakSet())
        : {};
    if (!isPlainObject(parameters)) fail(`${path}.function.parameters`, 'expected a plain object');

    const serialized = JSON.stringify({ name, description, parameters });
    const bytes = new TextEncoder().encode(serialized).length;
    if (bytes > REQUEST_LIMITS.maxToolSchemaBytes) {
        fail(path, `serialized tool schema must not exceed ${REQUEST_LIMITS.maxToolSchemaBytes} bytes`);
    }
    return { type: 'function', function: { name, description, parameters } };
}

function normalizeDocument(value, path) {
    assertPlainObject(value, path);
    assertKnownKeys(value, ['title', 'text'], path);
    if (typeof value.title !== 'string') fail(`${path}.title`, 'expected a string');
    if (typeof value.text !== 'string' || value.text === '') {
        fail(`${path}.text`, 'expected a non-empty string');
    }
    if (codePointLength(value.text) > REQUEST_LIMITS.maxDocumentTextCodePoints) {
        fail(`${path}.text`, `must not exceed ${REQUEST_LIMITS.maxDocumentTextCodePoints} code points`);
    }
    return { title: value.title, text: value.text };
}

export function normalizeRequestSpec(value = {}) {
    assertPlainObject(value, 'requestSpec');
    assertKnownKeys(
        value,
        ['schemaVersion', 'type', 'messages', 'tools', 'documents', 'addGenerationPrompt'],
        'requestSpec',
    );
    if (hasOwn(value, 'schemaVersion') && value.schemaVersion !== REQUEST_SCHEMA_VERSION) {
        fail('requestSpec.schemaVersion', `expected ${REQUEST_SCHEMA_VERSION}`);
    }
    if (hasOwn(value, 'type') && value.type !== REQUEST_TYPES.SPEC) {
        fail('requestSpec.type', `expected ${REQUEST_TYPES.SPEC}`);
    }

    const rawMessages = hasOwn(value, 'messages') ? value.messages : [];
    if (!Array.isArray(rawMessages)) fail('requestSpec.messages', 'expected an array');
    if (rawMessages.length === 0) fail('requestSpec.messages', 'expected at least one message');
    if (rawMessages.length > REQUEST_LIMITS.maxMessages) {
        fail('requestSpec.messages', `must not exceed ${REQUEST_LIMITS.maxMessages} messages`);
    }
    const messages = rawMessages.map((item, index) => normalizeMessage(item, `requestSpec.messages[${index}]`));
    const totalContent = messages.reduce((sum, item) => sum + codePointLength(item.content), 0);
    if (totalContent > REQUEST_LIMITS.maxTotalContentCodePoints) {
        fail('requestSpec.messages', `total content must not exceed ${REQUEST_LIMITS.maxTotalContentCodePoints} code points`);
    }

    const rawTools = hasOwn(value, 'tools') ? value.tools : [];
    if (!Array.isArray(rawTools)) fail('requestSpec.tools', 'expected an array');
    if (rawTools.length > REQUEST_LIMITS.maxTools) {
        fail('requestSpec.tools', `must not exceed ${REQUEST_LIMITS.maxTools} tools`);
    }
    const tools = rawTools.map((item, index) => normalizeTool(item, `requestSpec.tools[${index}]`));
    const toolNames = new Set();
    for (const tool of tools) {
        if (toolNames.has(tool.function.name)) {
            fail('requestSpec.tools', `duplicate tool name: ${tool.function.name}`);
        }
        toolNames.add(tool.function.name);
    }

    const rawDocuments = hasOwn(value, 'documents') ? value.documents : [];
    if (!Array.isArray(rawDocuments)) fail('requestSpec.documents', 'expected an array');
    if (rawDocuments.length > REQUEST_LIMITS.maxDocuments) {
        fail('requestSpec.documents', `must not exceed ${REQUEST_LIMITS.maxDocuments} documents`);
    }
    const documents = rawDocuments.map((item, index) => normalizeDocument(item, `requestSpec.documents[${index}]`));

    const addGenerationPrompt = hasOwn(value, 'addGenerationPrompt') ? value.addGenerationPrompt : true;
    if (typeof addGenerationPrompt !== 'boolean') {
        fail('requestSpec.addGenerationPrompt', 'expected a boolean');
    }

    return {
        schemaVersion: REQUEST_SCHEMA_VERSION,
        type: REQUEST_TYPES.SPEC,
        messages,
        tools,
        documents,
        addGenerationPrompt,
    };
}

export function requestSpecsEqual(left, right) {
    return JSON.stringify(normalizeRequestSpec(left)) === JSON.stringify(normalizeRequestSpec(right));
}

// 템플릿을 적용하지 않은 "본문만"의 기준선. 역할 이름과 구분자를 포함하지 않는다.
export function rawContentText(spec) {
    return normalizeRequestSpec(spec).messages.map((message) => message.content).join('\n');
}

function normalizeMeasurement(value, path, { allowZero = true } = {}) {
    assertPlainObject(value, path);
    assertKnownKeys(value, ['tokenCount', 'evidence', 'unavailableReason'], path);

    const tokenCount = hasOwn(value, 'tokenCount') ? value.tokenCount : null;
    if (tokenCount !== null) {
        if (!Number.isSafeInteger(tokenCount) || tokenCount < 0) {
            fail(`${path}.tokenCount`, 'expected null or a non-negative safe integer');
        }
        if (!allowZero && tokenCount === 0) fail(`${path}.tokenCount`, 'expected a positive integer');
    }

    const evidence = hasOwn(value, 'evidence') ? value.evidence : EVIDENCE_GRADES.UNAVAILABLE;
    if (!EVIDENCE_SET.has(evidence)) fail(`${path}.evidence`, 'unknown evidence grade');

    const unavailableReason = hasOwn(value, 'unavailableReason') ? value.unavailableReason : null;
    if (unavailableReason !== null && !REASON_SET.has(unavailableReason)) {
        fail(`${path}.unavailableReason`, 'unknown unavailable reason');
    }

    if (tokenCount === null && unavailableReason === null) {
        fail(`${path}.unavailableReason`, 'is required when tokenCount is null');
    }
    if (tokenCount !== null && evidence === EVIDENCE_GRADES.UNAVAILABLE) {
        fail(`${path}.evidence`, 'must not be unavailable when tokenCount is present');
    }
    return { tokenCount, evidence, unavailableReason };
}

function normalizeCapability(value, path) {
    assertPlainObject(value, path);
    assertKnownKeys(value, ['available', 'unavailableReason', 'detectedBy'], path);
    if (typeof value.available !== 'boolean') fail(`${path}.available`, 'expected a boolean');

    const unavailableReason = hasOwn(value, 'unavailableReason') ? value.unavailableReason : null;
    if (value.available && unavailableReason !== null) {
        fail(`${path}.unavailableReason`, 'must be null when available');
    }
    if (!value.available) {
        if (unavailableReason === null) fail(`${path}.unavailableReason`, 'is required when unavailable');
        if (!REASON_SET.has(unavailableReason)) fail(`${path}.unavailableReason`, 'unknown unavailable reason');
    }

    const detectedBy = hasOwn(value, 'detectedBy') ? value.detectedBy : 'runtime-probe';
    if (detectedBy !== 'runtime-probe' && detectedBy !== 'not-probed') {
        fail(`${path}.detectedBy`, 'expected runtime-probe or not-probed');
    }
    // 능력은 모델 이름이 아니라 실제 런타임 동작으로만 판정한다.
    if (value.available && detectedBy !== 'runtime-probe') {
        fail(`${path}.detectedBy`, 'an available capability must be confirmed by a runtime probe');
    }
    return { available: value.available, unavailableReason, detectedBy };
}

function normalizeSegment(value, path) {
    assertPlainObject(value, path);
    assertKnownKeys(
        value,
        ['id', 'kind', 'role', 'roles', 'label', 'measurement', 'cachePrefixCandidate'],
        path,
    );
    if (typeof value.id !== 'string' || value.id === '') fail(`${path}.id`, 'expected a non-empty string');
    if (!SEGMENT_KIND_SET.has(value.kind)) fail(`${path}.kind`, 'unknown segment kind');

    // 하나의 세그먼트가 여러 메시지를 덮을 수 있으므로 역할은 목록으로 보존한다.
    const rawRoles = hasOwn(value, 'roles') ? value.roles : [];
    if (!Array.isArray(rawRoles)) fail(`${path}.roles`, 'expected an array');
    const roles = rawRoles.map((item, index) => {
        if (!ROLE_SET.has(item)) fail(`${path}.roles[${index}]`, 'unknown role');
        return item;
    });

    const role = hasOwn(value, 'role') ? value.role : (roles.length === 1 ? roles[0] : null);
    if (role !== null && !ROLE_SET.has(role)) fail(`${path}.role`, 'unknown role');
    const expectedRole = roles.length === 1 ? roles[0] : null;
    if (role !== expectedRole) {
        fail(`${path}.role`, 'must be the single covered role, or null when a segment covers zero or many');
    }
    if (typeof value.label !== 'string') fail(`${path}.label`, 'expected a string');
    if (typeof value.cachePrefixCandidate !== 'boolean') {
        fail(`${path}.cachePrefixCandidate`, 'expected a boolean');
    }

    return {
        id: value.id,
        kind: value.kind,
        role,
        roles,
        label: value.label,
        measurement: normalizeMeasurement(value.measurement, `${path}.measurement`),
        cachePrefixCandidate: value.cachePrefixCandidate,
    };
}

function normalizeUnsupportedEntry(value, path) {
    assertPlainObject(value, path);
    assertKnownKeys(value, ['field', 'reason', 'detail'], path);
    if (typeof value.field !== 'string' || value.field === '') {
        fail(`${path}.field`, 'expected a non-empty string');
    }
    if (!REASON_SET.has(value.reason)) fail(`${path}.reason`, 'unknown unavailable reason');
    const detail = hasOwn(value, 'detail') ? value.detail : '';
    if (typeof detail !== 'string') fail(`${path}.detail`, 'expected a string');
    return { field: value.field, reason: value.reason, detail };
}

function normalizeProviderSlot(value, path) {
    assertPlainObject(value, path);
    assertKnownKeys(value, ['status', 'tokenCount', 'evidence', 'unavailableReason', 'countSemantics'], path);

    const status = hasOwn(value, 'status') ? value.status : 'not-configured';
    if (status !== 'not-configured' && status !== 'reported') {
        fail(`${path}.status`, 'expected not-configured or reported');
    }
    const measurement = normalizeMeasurement(
        {
            tokenCount: hasOwn(value, 'tokenCount') ? value.tokenCount : null,
            evidence: hasOwn(value, 'evidence') ? value.evidence : EVIDENCE_GRADES.UNAVAILABLE,
            unavailableReason: hasOwn(value, 'unavailableReason')
                ? value.unavailableReason
                : REQUEST_UNAVAILABLE_REASONS.GATEWAY_NOT_CONFIGURED,
        },
        path,
    );
    if (status === 'not-configured' && measurement.tokenCount !== null) {
        fail(`${path}.tokenCount`, 'must be null while the slot is not configured');
    }
    const countSemantics = hasOwn(value, 'countSemantics') ? value.countSemantics : null;
    if (countSemantics !== null && typeof countSemantics !== 'string') {
        fail(`${path}.countSemantics`, 'expected a string or null');
    }
    return { status, ...measurement, countSemantics };
}

export function createRequestAnalysisResult(input) {
    assertPlainObject(input, 'requestAnalysisResult');
    assertKnownKeys(
        input,
        [
            'requestId', 'createdAt', 'modelId', 'artifact', 'engine', 'spec',
            'capabilities', 'raw', 'template', 'templateText', 'overhead',
            'specialTokenDuplication', 'segments', 'unsupported', 'providerCounts', 'warnings',
        ],
        'requestAnalysisResult',
    );

    if (typeof input.requestId !== 'string' || input.requestId === '') {
        fail('requestAnalysisResult.requestId', 'expected a non-empty string');
    }
    const createdAt = hasOwn(input, 'createdAt') ? input.createdAt : new Date().toISOString();
    if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
        fail('requestAnalysisResult.createdAt', 'expected an ISO timestamp');
    }
    if (typeof input.modelId !== 'string' || input.modelId === '') {
        fail('requestAnalysisResult.modelId', 'expected a non-empty string');
    }
    if (input.engine !== 'real' && input.engine !== 'heuristic') {
        fail('requestAnalysisResult.engine', 'expected real or heuristic');
    }

    let artifact = null;
    if (hasOwn(input, 'artifact') && input.artifact !== null) {
        assertPlainObject(input.artifact, 'requestAnalysisResult.artifact');
        assertKnownKeys(input.artifact, ['id', 'revision'], 'requestAnalysisResult.artifact');
        if (typeof input.artifact.id !== 'string' || input.artifact.id === '') {
            fail('requestAnalysisResult.artifact.id', 'expected a non-empty string');
        }
        if (typeof input.artifact.revision !== 'string' || input.artifact.revision === '') {
            fail('requestAnalysisResult.artifact.revision', 'expected a non-empty string');
        }
        artifact = { id: input.artifact.id, revision: input.artifact.revision };
    }
    // 실제 엔진 결과는 재현을 위해 항상 고정 revision을 남긴다.
    if (input.engine === 'real' && artifact === null) {
        fail('requestAnalysisResult.artifact', 'is required for a real-engine result');
    }

    const spec = normalizeRequestSpec(input.spec);

    assertPlainObject(input.capabilities, 'requestAnalysisResult.capabilities');
    assertKnownKeys(input.capabilities, REQUEST_CAPABILITY_NAMES, 'requestAnalysisResult.capabilities');
    const capabilities = {};
    for (const name of REQUEST_CAPABILITY_NAMES) {
        if (!hasOwn(input.capabilities, name)) {
            fail(`requestAnalysisResult.capabilities.${name}`, 'is required');
        }
        capabilities[name] = normalizeCapability(
            input.capabilities[name],
            `requestAnalysisResult.capabilities.${name}`,
        );
    }

    const raw = normalizeMeasurement(input.raw, 'requestAnalysisResult.raw');
    const template = normalizeMeasurement(input.template, 'requestAnalysisResult.template');

    const templateText = hasOwn(input, 'templateText') ? input.templateText : null;
    if (templateText !== null && typeof templateText !== 'string') {
        fail('requestAnalysisResult.templateText', 'expected a string or null');
    }
    if (template.tokenCount !== null && templateText === null) {
        fail('requestAnalysisResult.templateText', 'is required when a template token count is present');
    }

    assertPlainObject(input.overhead, 'requestAnalysisResult.overhead');
    assertKnownKeys(input.overhead, ['tokens', 'ratio', 'evidence', 'unavailableReason'], 'requestAnalysisResult.overhead');
    const overheadTokens = hasOwn(input.overhead, 'tokens') ? input.overhead.tokens : null;
    if (overheadTokens !== null && !Number.isSafeInteger(overheadTokens)) {
        fail('requestAnalysisResult.overhead.tokens', 'expected null or a safe integer');
    }
    const overheadRatio = hasOwn(input.overhead, 'ratio') ? input.overhead.ratio : null;
    if (overheadRatio !== null && (typeof overheadRatio !== 'number' || !Number.isFinite(overheadRatio))) {
        fail('requestAnalysisResult.overhead.ratio', 'expected null or a finite number');
    }
    const overheadEvidence = hasOwn(input.overhead, 'evidence')
        ? input.overhead.evidence
        : EVIDENCE_GRADES.UNAVAILABLE;
    if (!EVIDENCE_SET.has(overheadEvidence)) {
        fail('requestAnalysisResult.overhead.evidence', 'unknown evidence grade');
    }
    const overheadReason = hasOwn(input.overhead, 'unavailableReason') ? input.overhead.unavailableReason : null;
    if (overheadReason !== null && !REASON_SET.has(overheadReason)) {
        fail('requestAnalysisResult.overhead.unavailableReason', 'unknown unavailable reason');
    }
    if (overheadTokens === null && overheadReason === null) {
        fail('requestAnalysisResult.overhead.unavailableReason', 'is required when tokens is null');
    }
    // raw와 template이 모두 있으면 overhead는 반드시 그 차이와 같아야 한다.
    if (overheadTokens !== null && raw.tokenCount !== null && template.tokenCount !== null
        && overheadTokens !== template.tokenCount - raw.tokenCount) {
        fail('requestAnalysisResult.overhead.tokens', 'must equal template.tokenCount - raw.tokenCount');
    }

    assertPlainObject(input.specialTokenDuplication, 'requestAnalysisResult.specialTokenDuplication');
    assertKnownKeys(
        input.specialTokenDuplication,
        ['checked', 'withSpecialTokenCount', 'duplicatedTokens', 'unavailableReason'],
        'requestAnalysisResult.specialTokenDuplication',
    );
    const dupChecked = input.specialTokenDuplication.checked;
    if (typeof dupChecked !== 'boolean') {
        fail('requestAnalysisResult.specialTokenDuplication.checked', 'expected a boolean');
    }
    const dupWith = hasOwn(input.specialTokenDuplication, 'withSpecialTokenCount')
        ? input.specialTokenDuplication.withSpecialTokenCount
        : null;
    if (dupWith !== null && (!Number.isSafeInteger(dupWith) || dupWith < 0)) {
        fail('requestAnalysisResult.specialTokenDuplication.withSpecialTokenCount', 'expected null or a non-negative safe integer');
    }
    const dupTokens = hasOwn(input.specialTokenDuplication, 'duplicatedTokens')
        ? input.specialTokenDuplication.duplicatedTokens
        : null;
    if (dupTokens !== null && (!Number.isSafeInteger(dupTokens) || dupTokens < 0)) {
        fail('requestAnalysisResult.specialTokenDuplication.duplicatedTokens', 'expected null or a non-negative safe integer');
    }
    const dupReason = hasOwn(input.specialTokenDuplication, 'unavailableReason')
        ? input.specialTokenDuplication.unavailableReason
        : null;
    if (dupReason !== null && !REASON_SET.has(dupReason)) {
        fail('requestAnalysisResult.specialTokenDuplication.unavailableReason', 'unknown unavailable reason');
    }
    if (!dupChecked && dupReason === null) {
        fail('requestAnalysisResult.specialTokenDuplication.unavailableReason', 'is required when the check did not run');
    }
    if (dupChecked && (dupWith === null || dupTokens === null)) {
        fail('requestAnalysisResult.specialTokenDuplication', 'a completed check must report both counts');
    }

    const rawSegments = hasOwn(input, 'segments') ? input.segments : [];
    if (!Array.isArray(rawSegments)) fail('requestAnalysisResult.segments', 'expected an array');
    const segments = rawSegments.map((item, index) => normalizeSegment(item, `requestAnalysisResult.segments[${index}]`));
    const segmentIds = new Set();
    for (const segment of segments) {
        if (segmentIds.has(segment.id)) fail('requestAnalysisResult.segments', `duplicate segment id: ${segment.id}`);
        segmentIds.add(segment.id);
    }

    const rawUnsupported = hasOwn(input, 'unsupported') ? input.unsupported : [];
    if (!Array.isArray(rawUnsupported)) fail('requestAnalysisResult.unsupported', 'expected an array');
    const unsupported = rawUnsupported.map(
        (item, index) => normalizeUnsupportedEntry(item, `requestAnalysisResult.unsupported[${index}]`),
    );

    const providerInput = hasOwn(input, 'providerCounts') ? input.providerCounts : {};
    assertPlainObject(providerInput, 'requestAnalysisResult.providerCounts');
    assertKnownKeys(providerInput, PROVIDER_COUNT_SLOTS, 'requestAnalysisResult.providerCounts');
    const providerCounts = {};
    for (const slot of PROVIDER_COUNT_SLOTS) {
        providerCounts[slot] = normalizeProviderSlot(
            hasOwn(providerInput, slot) ? providerInput[slot] : {},
            `requestAnalysisResult.providerCounts.${slot}`,
        );
    }

    const rawWarnings = hasOwn(input, 'warnings') ? input.warnings : [];
    if (!Array.isArray(rawWarnings)) fail('requestAnalysisResult.warnings', 'expected an array');
    const warnings = rawWarnings.map((item, index) => {
        if (typeof item !== 'string' || item === '') {
            fail(`requestAnalysisResult.warnings[${index}]`, 'expected a non-empty string');
        }
        return item;
    });

    return {
        schemaVersion: REQUEST_SCHEMA_VERSION,
        type: REQUEST_TYPES.RESULT,
        requestId: input.requestId,
        createdAt,
        modelId: input.modelId,
        artifact,
        engine: input.engine,
        spec,
        capabilities,
        raw,
        template,
        templateText,
        overhead: {
            tokens: overheadTokens,
            ratio: overheadRatio,
            evidence: overheadEvidence,
            unavailableReason: overheadReason,
        },
        specialTokenDuplication: {
            checked: dupChecked,
            withSpecialTokenCount: dupWith,
            duplicatedTokens: dupTokens,
            unavailableReason: dupReason,
        },
        segments,
        unsupported,
        providerCounts,
        warnings,
    };
}

export function validateRequestAnalysisResult(result) {
    const normalized = createRequestAnalysisResult({
        requestId: result?.requestId,
        createdAt: result?.createdAt,
        modelId: result?.modelId,
        artifact: result?.artifact ?? null,
        engine: result?.engine,
        spec: result?.spec,
        capabilities: result?.capabilities,
        raw: result?.raw,
        template: result?.template,
        templateText: result?.templateText ?? null,
        overhead: result?.overhead,
        specialTokenDuplication: result?.specialTokenDuplication,
        segments: result?.segments ?? [],
        unsupported: result?.unsupported ?? [],
        providerCounts: result?.providerCounts ?? {},
        warnings: result?.warnings ?? [],
    });
    if (result?.schemaVersion !== undefined && result.schemaVersion !== REQUEST_SCHEMA_VERSION) {
        fail('requestAnalysisResult.schemaVersion', `expected ${REQUEST_SCHEMA_VERSION}`);
    }
    return normalized;
}
