// inspectorDomain.js — Inspector view에서 공유하는 순수 입력·비교·내보내기 도메인
import { validateAnalysisResult } from './analysisContract.js';
import { measureText } from './unicodeMetrics.js';

export const INSPECTOR_EXPORT_SCHEMA_VERSION = 1;
export const INSPECTOR_SHARE_SCHEMA_VERSION = 2;
// v1 링크는 P3 이전에 만들어진 것이며 계속 열려야 한다.
export const SUPPORTED_SHARE_SCHEMA_VERSIONS = Object.freeze([1, 2]);

export const DEFAULT_INPUT_LIMITS = Object.freeze({
    maxCharacters: 100_000,
    maxUtf8Bytes: 1_000_000,
    largeInputCharacters: 10_000,
    largeInputUtf8Bytes: 100_000,
});

export const UNICODE_LENS_IDS = Object.freeze([
    'spaces',
    'nfc',
    'nfd',
    'case',
    'emoji',
    'code-indentation',
]);

export const ROUNDTRIP_KINDS = Object.freeze({
    LOSSLESS: 'lossless',
    NORMALIZATION: 'normalization',
    UNKNOWN_TOKEN: 'unknown-token',
    SPECIAL_TOKEN_REMOVAL: 'special-token-removal',
    OTHER: 'other',
});

const EXPORT_TYPE = 'tokenizer-inspector-export';
const SHARE_PARAMETER = 'inspector';
const SHARE_TYPE = 'tokenizer-inspector-share';
const MAX_SHARE_QUERY_LENGTH = 20_000;
const MAX_DIFF_CODE_POINTS = 100_000;
const DEFAULT_MAX_DIFF_MATRIX_CELLS = 250_000;
const HARD_MAX_DIFF_MATRIX_CELLS = 1_000_000;
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SHARE_STATE_KEYS = new Set([
    'modelId', 'compareModelA', 'compareModelB', 'view', 'lens', 'lang', 'locale',
    'lessonId', 'level', 'options', 'text',
    // P3: 재현 가능한 수업 링크
    'corpusId', 'benchmarkColumns', 'benchmarkMetric', 'presentation',
]);

const MAX_BENCHMARK_COLUMNS = 4;

function requireString(value, path) {
    if (typeof value !== 'string') {
        throw new TypeError(`${path} must be a string`);
    }
    return value;
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value, path) {
    if (!isPlainObject(value)) throw new TypeError(`${path} must be a plain object`);
}

function cloneJsonValue(value, path = 'value', ancestors = new WeakSet()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite numbers`);
        return value;
    }
    if (typeof value !== 'object') throw new TypeError(`${path} must be JSON-safe`);
    if (ancestors.has(value)) throw new TypeError(`${path} must not be cyclic`);

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((entry, index) => cloneJsonValue(entry, `${path}[${index}]`, ancestors));
        }
        requirePlainObject(value, path);
        const copy = {};
        for (const [key, entry] of Object.entries(value)) {
            if (DANGEROUS_OBJECT_KEYS.has(key)) {
                throw new TypeError(`${path}.${key} is an unsafe object key`);
            }
            copy[key] = cloneJsonValue(entry, `${path}.${key}`, ancestors);
        }
        return copy;
    } finally {
        ancestors.delete(value);
    }
}

function positiveInteger(value, path) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${path} must be a positive safe integer`);
    }
    return value;
}

function normalizeInputLimits(overrides) {
    requirePlainObject(overrides, 'limits');
    const known = new Set(Object.keys(DEFAULT_INPUT_LIMITS));
    for (const key of Object.keys(overrides)) {
        if (!known.has(key)) throw new TypeError(`limits.${key} is unknown`);
    }

    const limits = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_INPUT_LIMITS)) {
        limits[key] = positiveInteger(overrides[key] ?? defaultValue, `limits.${key}`);
    }
    if (limits.largeInputCharacters > limits.maxCharacters) {
        throw new RangeError('limits.largeInputCharacters must not exceed maxCharacters');
    }
    if (limits.largeInputUtf8Bytes > limits.maxUtf8Bytes) {
        throw new RangeError('limits.largeInputUtf8Bytes must not exceed maxUtf8Bytes');
    }
    return limits;
}

function lineCount(text) {
    return (text.match(/\r\n|\r|\n/g) ?? []).length + 1;
}

export function analyzeInput(text, limits = {}) {
    requireString(text, 'text');
    const normalizedLimits = normalizeInputLimits(limits);
    const measured = measureText(text);
    const characters = measured.codePoints;
    const utf8Bytes = measured.utf8Bytes;
    const violations = [];
    const warnings = [];

    if (characters > normalizedLimits.maxCharacters) {
        violations.push({
            code: 'character-limit-exceeded',
            actual: characters,
            limit: normalizedLimits.maxCharacters,
            unit: 'codePoint',
        });
    }
    if (utf8Bytes > normalizedLimits.maxUtf8Bytes) {
        violations.push({
            code: 'utf8-byte-limit-exceeded',
            actual: utf8Bytes,
            limit: normalizedLimits.maxUtf8Bytes,
            unit: 'byte',
        });
    }
    if (characters >= normalizedLimits.largeInputCharacters
        || utf8Bytes >= normalizedLimits.largeInputUtf8Bytes) {
        warnings.push({
            code: 'large-input',
            characterThresholdReached: characters >= normalizedLimits.largeInputCharacters,
            utf8ByteThresholdReached: utf8Bytes >= normalizedLimits.largeInputUtf8Bytes,
        });
    }

    return {
        schemaVersion: 1,
        characterUnit: 'codePoint',
        metrics: {
            lines: lineCount(text),
            characters,
            utf16CodeUnits: measured.utf16CodeUnits,
            graphemes: measured.graphemes,
            graphemesUnavailableReason: measured.graphemesUnavailableReason,
            utf8Bytes,
        },
        limits: normalizedLimits,
        remaining: {
            characters: Math.max(0, normalizedLimits.maxCharacters - characters),
            utf8Bytes: Math.max(0, normalizedLimits.maxUtf8Bytes - utf8Bytes),
        },
        accepted: violations.length === 0,
        largeInput: warnings.length > 0,
        violations,
        warnings,
    };
}

function appendDiffSegment(segments, type, value) {
    if (value === '') return;
    const previous = segments.at(-1);
    if (previous && previous.type === type) {
        previous.value += value;
        previous.codePointLength += [...value].length;
        return;
    }
    segments.push({ type, value, codePointLength: [...value].length });
}

function commonEdgeDiff(before, after, prefixLength, suffixLength) {
    const segments = [];
    appendDiffSegment(segments, 'equal', before.slice(0, prefixLength).join(''));
    appendDiffSegment(
        segments,
        'delete',
        before.slice(prefixLength, before.length - suffixLength).join(''),
    );
    appendDiffSegment(
        segments,
        'insert',
        after.slice(prefixLength, after.length - suffixLength).join(''),
    );
    if (suffixLength > 0) {
        appendDiffSegment(segments, 'equal', before.slice(before.length - suffixLength).join(''));
    }
    return segments;
}

function preciseLcsDiff(before, after) {
    const width = after.length + 1;
    const matrix = new Uint32Array((before.length + 1) * width);
    for (let left = before.length - 1; left >= 0; left -= 1) {
        for (let right = after.length - 1; right >= 0; right -= 1) {
            const index = left * width + right;
            matrix[index] = before[left] === after[right]
                ? matrix[(left + 1) * width + right + 1] + 1
                : Math.max(matrix[(left + 1) * width + right], matrix[index + 1]);
        }
    }

    const segments = [];
    let left = 0;
    let right = 0;
    while (left < before.length && right < after.length) {
        if (before[left] === after[right]) {
            appendDiffSegment(segments, 'equal', before[left]);
            left += 1;
            right += 1;
        } else if (matrix[(left + 1) * width + right] >= matrix[left * width + right + 1]) {
            appendDiffSegment(segments, 'delete', before[left]);
            left += 1;
        } else {
            appendDiffSegment(segments, 'insert', after[right]);
            right += 1;
        }
    }
    while (left < before.length) {
        appendDiffSegment(segments, 'delete', before[left]);
        left += 1;
    }
    while (right < after.length) {
        appendDiffSegment(segments, 'insert', after[right]);
        right += 1;
    }
    return segments;
}

export function diffCodePoints(beforeText, afterText, options = {}) {
    requireString(beforeText, 'beforeText');
    requireString(afterText, 'afterText');
    requirePlainObject(options, 'options');
    const known = new Set(['maxCodePoints', 'maxMatrixCells']);
    for (const key of Object.keys(options)) {
        if (!known.has(key)) throw new TypeError(`options.${key} is unknown`);
    }
    const maxCodePoints = positiveInteger(
        options.maxCodePoints ?? MAX_DIFF_CODE_POINTS,
        'options.maxCodePoints',
    );
    const maxMatrixCells = positiveInteger(
        options.maxMatrixCells ?? DEFAULT_MAX_DIFF_MATRIX_CELLS,
        'options.maxMatrixCells',
    );
    if (maxCodePoints > MAX_DIFF_CODE_POINTS) {
        throw new RangeError(`options.maxCodePoints must not exceed ${MAX_DIFF_CODE_POINTS}`);
    }
    if (maxMatrixCells > HARD_MAX_DIFF_MATRIX_CELLS) {
        throw new RangeError(`options.maxMatrixCells must not exceed ${HARD_MAX_DIFF_MATRIX_CELLS}`);
    }
    const before = [...beforeText];
    const after = [...afterText];
    if (before.length > maxCodePoints || after.length > maxCodePoints) {
        throw new RangeError(`diff input exceeds ${maxCodePoints} code points`);
    }

    const matrixCells = (before.length + 1) * (after.length + 1);
    if (matrixCells <= maxMatrixCells) {
        return {
            unit: 'codePoint',
            strategy: 'lcs',
            coarse: false,
            beforeLength: before.length,
            afterLength: after.length,
            segments: preciseLcsDiff(before, after),
        };
    }

    let prefixLength = 0;
    while (prefixLength < before.length
        && prefixLength < after.length
        && before[prefixLength] === after[prefixLength]) {
        prefixLength += 1;
    }
    let suffixLength = 0;
    while (suffixLength < before.length - prefixLength
        && suffixLength < after.length - prefixLength
        && before[before.length - 1 - suffixLength] === after[after.length - 1 - suffixLength]) {
        suffixLength += 1;
    }

    return {
        unit: 'codePoint',
        strategy: 'common-edges',
        coarse: true,
        beforeLength: before.length,
        afterLength: after.length,
        segments: commonEdgeDiff(before, after, prefixLength, suffixLength),
    };
}

function transformSpaces(text) {
    const nonAsciiHorizontalSpace = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u;
    if (nonAsciiHorizontalSpace.test(text)) {
        return text.replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu, ' ');
    }
    if (text.includes(' ')) return text.replaceAll(' ', '\u00a0');
    return `${text}\u00a0`;
}

function transformCase(text) {
    const lower = text.toLowerCase();
    return lower !== text ? lower : text.toUpperCase();
}

function transformEmoji(text) {
    if (text.includes('\u200d')) return text.replaceAll('\u200d', '');
    if (text.includes('\ufe0f')) return text.replaceAll('\ufe0f', '');
    const emoji = text.match(/\p{Extended_Pictographic}/u);
    if (emoji) {
        const index = emoji.index;
        return `${text.slice(0, index + emoji[0].length)}\ufe0f${text.slice(index + emoji[0].length)}`;
    }
    return `${text}${text === '' || /\s$/u.test(text) ? '' : ' '}🤗`;
}

function transformIndentation(text) {
    if (/^\t+/mu.test(text)) {
        return text.replace(/^\t+/gmu, (tabs) => '    '.repeat(tabs.length));
    }
    if (/^(?: {4})+/mu.test(text)) {
        return text.replace(/^(?: {4})+/gmu, (spaces) => '\t'.repeat(spaces.length / 4));
    }
    return text.replace(/^(?=\S)/gmu, '    ');
}

export function applyUnicodeLens(text, lensId) {
    requireString(text, 'text');
    if (!UNICODE_LENS_IDS.includes(lensId)) {
        throw new RangeError(`Unsupported Unicode lens: ${lensId}`);
    }
    switch (lensId) {
        case 'spaces': return transformSpaces(text);
        case 'nfc': return text.normalize('NFC');
        case 'nfd': return text.normalize('NFD');
        case 'case': return transformCase(text);
        case 'emoji': return transformEmoji(text);
        case 'code-indentation': return transformIndentation(text);
        default: throw new RangeError(`Unsupported Unicode lens: ${lensId}`);
    }
}

export function createLensComparison(text, lensId, diffOptions = {}) {
    requireString(text, 'text');
    const variant = applyUnicodeLens(text, lensId);
    return {
        schemaVersion: 1,
        lensId,
        baseline: text,
        variant,
        changed: variant !== text,
        baselineInput: analyzeInput(text),
        variantInput: analyzeInput(variant),
        diff: diffCodePoints(text, variant, diffOptions),
    };
}

export function classifyRoundTrip(input) {
    requirePlainObject(input, 'input');
    const source = requireString(input.source, 'input.source');
    const decoded = requireString(input.decoded, 'input.decoded');
    const normalized = input.normalized === undefined || input.normalized === null
        ? null
        : requireString(input.normalized, 'input.normalized');
    const unknownTokenCount = input.unknownTokenCount ?? 0;
    if (!Number.isSafeInteger(unknownTokenCount) || unknownTokenCount < 0) {
        throw new TypeError('input.unknownTokenCount must be a non-negative safe integer');
    }
    const unknownTokenDetected = input.unknownTokenDetected === true || unknownTokenCount > 0;
    const specialTokensRemoved = input.specialTokensRemoved === true;

    let kind;
    let reason;
    if (source === decoded) {
        kind = ROUNDTRIP_KINDS.LOSSLESS;
        reason = 'exact-match';
    } else if (unknownTokenDetected) {
        kind = ROUNDTRIP_KINDS.UNKNOWN_TOKEN;
        reason = 'unknown-token-detected';
    } else if (specialTokensRemoved) {
        kind = ROUNDTRIP_KINDS.SPECIAL_TOKEN_REMOVAL;
        reason = 'decode-removed-special-tokens';
    } else if ((normalized !== null && normalized !== source && decoded === normalized)
        || source.normalize('NFD') === decoded.normalize('NFD')) {
        kind = ROUNDTRIP_KINDS.NORMALIZATION;
        reason = 'canonically-equivalent-or-normalized';
    } else {
        kind = ROUNDTRIP_KINDS.OTHER;
        reason = 'unclassified-text-change';
    }

    return {
        schemaVersion: 1,
        kind,
        reason,
        lossless: kind === ROUNDTRIP_KINDS.LOSSLESS,
        source,
        decoded,
        sourceInput: analyzeInput(source),
        decodedInput: analyzeInput(decoded),
        diff: diffCodePoints(source, decoded),
    };
}

function utf8Detail(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    return {
        bytes,
        hex: bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    };
}

function mapContentPieces(result) {
    const mapping = Array(result.finalTokens.length).fill(null);
    let pieceIndex = 0;
    for (let tokenIndex = 0; tokenIndex < result.finalTokens.length; tokenIndex += 1) {
        if (pieceIndex < result.subwords.length
            && result.finalTokens[tokenIndex] === result.subwords[pieceIndex]) {
            mapping[tokenIndex] = pieceIndex;
            pieceIndex += 1;
        }
    }
    return mapping;
}

function normalizeGeneratedAt(value) {
    const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('generatedAt must be a valid date');
    return date.toISOString();
}

export function createInspectorExport(result, options = {}) {
    validateAnalysisResult(result);
    requirePlainObject(options, 'options');
    const known = new Set(['generatedAt', 'roundTrip']);
    for (const key of Object.keys(options)) {
        if (!known.has(key)) throw new TypeError(`options.${key} is unknown`);
    }

    const pieceMapping = mapContentPieces(result);
    const tokens = result.finalTokens.map((raw, index) => {
        const pieceIndex = pieceMapping[index];
        const piece = pieceIndex === null ? null : result.pieces[pieceIndex];
        const rawUtf8 = utf8Detail(raw);
        const surfaceUtf8 = piece === null ? null : utf8Detail(piece.surface);
        return {
            index,
            id: result.ids[index],
            raw,
            display: result.finDisplay[index],
            sourceKind: result.encoding.specialTokenMask?.[index] === 1
                ? 'special-token'
                : result.encoding.attentionMask?.[index] === 0
                    ? 'padding'
                    : result.encoding.tokenTypeIds?.[index] === 1
                        ? 'sequence-b'
                        : piece === null ? 'added-or-special' : 'sequence-a',
            attentionMask: result.encoding.attentionMask?.[index] ?? null,
            tokenTypeId: result.encoding.tokenTypeIds?.[index] ?? null,
            specialTokenMask: result.encoding.specialTokenMask?.[index] ?? null,
            originalOffset: result.encoding.originalOffsets?.[index] ?? null,
            normalizedOffset: result.encoding.normalizedOffsets?.[index] ?? null,
            pieceIndex,
            surface: piece?.surface ?? null,
            continuation: piece?.continuation ?? null,
            rawTokenUtf8Bytes: rawUtf8.bytes,
            rawTokenUtf8Hex: rawUtf8.hex,
            surfaceUtf8Bytes: surfaceUtf8?.bytes ?? null,
            surfaceUtf8Hex: surfaceUtf8?.hex ?? null,
        };
    });

    const roundTrip = options.roundTrip === undefined || options.roundTrip === null
        ? cloneJsonValue(result.roundTrip, 'result.roundTrip')
        : classifyRoundTrip(options.roundTrip);
    return {
        schemaVersion: INSPECTOR_EXPORT_SCHEMA_VERSION,
        type: EXPORT_TYPE,
        generatedAt: normalizeGeneratedAt(options.generatedAt),
        analysisSchemaVersion: result.schemaVersion,
        requestId: result.requestId,
        requestedModelId: result.requestedModelId,
        modelId: result.modelId,
        engine: result.engine,
        input: cloneJsonValue(result.input, 'result.input'),
        options: cloneJsonValue(result.options, 'result.options'),
        normalized: result.normalized,
        stages: {
            preTokens: [...result.preTokens],
            subwords: [...result.subwords],
            finalTokens: [...result.finalTokens],
        },
        tokenCount: tokens.length,
        tokens,
        roundTrip,
        provenance: cloneJsonValue(result.provenance, 'result.provenance'),
        capabilities: cloneJsonValue(result.capabilities, 'result.capabilities'),
        evidence: cloneJsonValue(result.evidence, 'result.evidence'),
        encoding: cloneJsonValue(result.encoding, 'result.encoding'),
        warnings: cloneJsonValue(result.warnings, 'result.warnings'),
        fallbackReason: cloneJsonValue(result.fallbackReason, 'result.fallbackReason'),
    };
}

function isInspectorExport(value) {
    return isPlainObject(value)
        && value.schemaVersion === INSPECTOR_EXPORT_SCHEMA_VERSION
        && value.type === EXPORT_TYPE
        && Array.isArray(value.tokens);
}

function toInspectorExport(value, options) {
    return isInspectorExport(value) ? value : createInspectorExport(value, options);
}

export function serializeInspectorJson(resultOrExport, options = {}) {
    requirePlainObject(options, 'options');
    const known = new Set(['pretty', 'generatedAt', 'roundTrip']);
    for (const key of Object.keys(options)) {
        if (!known.has(key)) throw new TypeError(`options.${key} is unknown`);
    }
    const payload = toInspectorExport(resultOrExport, {
        generatedAt: options.generatedAt,
        roundTrip: options.roundTrip,
    });
    return JSON.stringify(payload, null, options.pretty === false ? 0 : 2);
}

export function escapeCsvCell(value) {
    if (value === null || value === undefined) return '""';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('CSV numbers must be finite');
        return String(value);
    }
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    if (/^[\u0000-\u0020\ufeff]*[=+\-@]/u.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

export function serializeInspectorCsv(resultOrExport, options = {}) {
    const payload = toInspectorExport(resultOrExport, options);
    const header = [
        'schemaVersion', 'requestId', 'engine', 'modelId', 'index', 'id', 'raw', 'display',
        'sourceKind', 'pieceIndex', 'surface', 'continuation', 'rawTokenUtf8Hex',
        'surfaceUtf8Hex',
    ];
    const rows = payload.tokens.map((token) => [
        payload.schemaVersion,
        payload.requestId,
        payload.engine,
        payload.modelId,
        token.index,
        token.id,
        token.raw,
        token.display,
        token.sourceKind,
        token.pieceIndex,
        token.surface,
        token.continuation,
        token.rawTokenUtf8Hex,
        token.surfaceUtf8Hex,
    ]);
    return [header, ...rows]
        .map((row) => row.map(escapeCsvCell).join(','))
        .join('\r\n');
}

function normalizeShareState(state, includeInput) {
    requirePlainObject(state, 'state');
    for (const key of Object.keys(state)) {
        if (!SHARE_STATE_KEYS.has(key)) throw new TypeError(`state.${key} is unknown`);
    }
    const copy = cloneJsonValue(state, 'state');
    if (!includeInput) delete copy.text;
    if (copy.text !== undefined) requireString(copy.text, 'state.text');
    for (const key of [
        'modelId', 'compareModelA', 'compareModelB', 'view', 'lens', 'lang', 'locale',
        'lessonId', 'level',
    ]) {
        if (copy[key] !== undefined) {
            requireString(copy[key], `state.${key}`);
            if (copy[key].length === 0 || copy[key].length > 512) {
                throw new RangeError(`state.${key} must contain 1 to 512 UTF-16 code units`);
            }
        }
    }
    for (const key of ['corpusId', 'benchmarkMetric']) {
        if (copy[key] !== undefined) {
            requireString(copy[key], `state.${key}`);
            if (copy[key].length === 0 || copy[key].length > 64) {
                throw new RangeError(`state.${key} must contain 1 to 64 UTF-16 code units`);
            }
        }
    }
    if (copy.benchmarkColumns !== undefined) {
        if (!Array.isArray(copy.benchmarkColumns)) {
            throw new TypeError('state.benchmarkColumns must be an array');
        }
        if (copy.benchmarkColumns.length > MAX_BENCHMARK_COLUMNS) {
            throw new RangeError(`state.benchmarkColumns must not exceed ${MAX_BENCHMARK_COLUMNS} entries`);
        }
        copy.benchmarkColumns.forEach((value, index) => {
            requireString(value, `state.benchmarkColumns[${index}]`);
            if (value.length === 0 || value.length > 512) {
                throw new RangeError(`state.benchmarkColumns[${index}] must contain 1 to 512 UTF-16 code units`);
            }
        });
        if (new Set(copy.benchmarkColumns).size !== copy.benchmarkColumns.length) {
            throw new TypeError('state.benchmarkColumns must not repeat a model');
        }
    }
    if (copy.presentation !== undefined && typeof copy.presentation !== 'boolean') {
        throw new TypeError('state.presentation must be a boolean');
    }
    if (copy.options !== undefined) requirePlainObject(copy.options, 'state.options');
    return copy;
}

export function encodeShareState(state, options = {}) {
    requirePlainObject(options, 'options');
    for (const key of Object.keys(options)) {
        if (key !== 'includeInput') throw new TypeError(`options.${key} is unknown`);
    }
    const includeInput = options.includeInput === true;
    const normalizedState = normalizeShareState(state, includeInput);
    const includesInput = includeInput && Object.prototype.hasOwnProperty.call(normalizedState, 'text');
    const payload = {
        schemaVersion: INSPECTOR_SHARE_SCHEMA_VERSION,
        type: SHARE_TYPE,
        includesInput,
        state: normalizedState,
    };
    const query = new URLSearchParams({ [SHARE_PARAMETER]: JSON.stringify(payload) }).toString();
    if (query.length > MAX_SHARE_QUERY_LENGTH) {
        throw new RangeError(`share state exceeds ${MAX_SHARE_QUERY_LENGTH} URL characters`);
    }
    return query;
}

function toSearchParams(value) {
    if (value instanceof URLSearchParams) return value;
    requireString(value, 'query');
    if (value.length > MAX_SHARE_QUERY_LENGTH) {
        throw new RangeError(`share state exceeds ${MAX_SHARE_QUERY_LENGTH} URL characters`);
    }
    const questionMark = value.indexOf('?');
    const query = questionMark >= 0 ? value.slice(questionMark + 1) : value.replace(/^[?#]/u, '');
    return new URLSearchParams(query.split('#', 1)[0]);
}

export function decodeShareState(query) {
    const raw = toSearchParams(query).get(SHARE_PARAMETER);
    if (raw === null) return null;
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        throw new TypeError('share state contains invalid JSON');
    }
    requirePlainObject(payload, 'share');
    const keys = Object.keys(payload);
    if (keys.some((key) => !['schemaVersion', 'type', 'includesInput', 'state'].includes(key))) {
        throw new TypeError('share state contains unknown fields');
    }
    if (!SUPPORTED_SHARE_SCHEMA_VERSIONS.includes(payload.schemaVersion)) {
        throw new RangeError('unsupported share state version');
    }
    if (payload.type !== SHARE_TYPE) throw new TypeError('invalid share state type');
    if (typeof payload.includesInput !== 'boolean') {
        throw new TypeError('share.includesInput must be a boolean');
    }
    const state = normalizeShareState(payload.state, payload.includesInput);
    if (!payload.includesInput && Object.prototype.hasOwnProperty.call(payload.state, 'text')) {
        throw new TypeError('share state includes input without explicit consent');
    }
    if (payload.includesInput && !Object.prototype.hasOwnProperty.call(payload.state, 'text')) {
        throw new TypeError('share state declares input without including it');
    }
    return {
        schemaVersion: INSPECTOR_SHARE_SCHEMA_VERSION,
        includesInput: payload.includesInput,
        state,
    };
}
