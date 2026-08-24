// Canonical P1 tokenizer options shared by the UI, URL state, exports, and adapters.

export const ANALYSIS_OPTION_LIMITS = Object.freeze({
    maxLength: 8192,
    textPairCodePoints: 50_000,
});

export const DEFAULT_ANALYSIS_OPTIONS = Object.freeze({
    addSpecialTokens: true,
    textPair: null,
    padding: 'none',
    paddingSide: 'runtime',
    truncation: false,
    maxLength: null,
    stride: 0,
});

const OPTION_KEYS = Object.freeze(Object.keys(DEFAULT_ANALYSIS_OPTIONS));
const PADDING = new Set(['none', 'max-length']);
const PADDING_SIDE = new Set(['runtime', 'left', 'right']);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

export function normalizeAnalysisOptions(value = {}) {
    if (!isPlainObject(value)) fail('options', 'expected a plain object');
    for (const key of Object.keys(value)) {
        if (!OPTION_KEYS.includes(key)) fail(`options.${key}`, 'unknown field');
    }

    const normalized = { ...DEFAULT_ANALYSIS_OPTIONS };
    if (hasOwn(value, 'addSpecialTokens')) {
        if (typeof value.addSpecialTokens !== 'boolean') {
            fail('options.addSpecialTokens', 'expected a boolean');
        }
        normalized.addSpecialTokens = value.addSpecialTokens;
    }
    if (hasOwn(value, 'textPair')) {
        if (value.textPair !== null && typeof value.textPair !== 'string') {
            fail('options.textPair', 'expected a string or null');
        }
        normalized.textPair = value.textPair === '' ? null : value.textPair;
        if (normalized.textPair && [...normalized.textPair].length > ANALYSIS_OPTION_LIMITS.textPairCodePoints) {
            fail('options.textPair', `must not exceed ${ANALYSIS_OPTION_LIMITS.textPairCodePoints} code points`);
        }
    }
    if (hasOwn(value, 'padding')) {
        if (!PADDING.has(value.padding)) fail('options.padding', 'expected none or max-length');
        normalized.padding = value.padding;
    }
    if (hasOwn(value, 'paddingSide')) {
        if (!PADDING_SIDE.has(value.paddingSide)) {
            fail('options.paddingSide', 'expected runtime, left, or right');
        }
        normalized.paddingSide = value.paddingSide;
    }
    if (hasOwn(value, 'truncation')) {
        if (typeof value.truncation !== 'boolean') fail('options.truncation', 'expected a boolean');
        normalized.truncation = value.truncation;
    }
    if (hasOwn(value, 'maxLength')) {
        if (value.maxLength !== null && (
            !Number.isSafeInteger(value.maxLength)
            || value.maxLength < 1
            || value.maxLength > ANALYSIS_OPTION_LIMITS.maxLength
        )) {
            fail('options.maxLength', `expected null or an integer from 1 to ${ANALYSIS_OPTION_LIMITS.maxLength}`);
        }
        normalized.maxLength = value.maxLength;
    }
    if (hasOwn(value, 'stride')) {
        if (value.stride !== 0) {
            fail('options.stride', 'Transformers.js v3.8.1 tokenizer calls do not expose overflow stride; expected 0');
        }
    }

    if (normalized.padding === 'max-length' && normalized.maxLength === null) {
        fail('options.maxLength', 'is required when padding is max-length');
    }
    return normalized;
}

export function toTokenizerCallOptions(value) {
    const options = normalizeAnalysisOptions(value);
    const runtime = {
        add_special_tokens: options.addSpecialTokens,
        padding: options.padding === 'max-length' ? 'max_length' : false,
        truncation: options.truncation,
        return_tensor: false,
        return_token_type_ids: true,
    };
    if (options.textPair !== null) runtime.text_pair = options.textPair;
    if (options.maxLength !== null) runtime.max_length = options.maxLength;
    return runtime;
}

export function optionsEqual(left, right) {
    return JSON.stringify(normalizeAnalysisOptions(left)) === JSON.stringify(normalizeAnalysisOptions(right));
}
