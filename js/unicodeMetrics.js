// unicodeMetrics.js — 문자열 단위를 혼용하지 않기 위한 순수 측정 유틸리티

export const UNICODE_METRICS_SCHEMA_VERSION = '1.0.0';

function requireString(value) {
    if (typeof value !== 'string') {
        throw new TypeError('Unicode metrics input must be a string');
    }
}

export function measureText(text, segmenterFactory = globalThis.Intl && Intl.Segmenter) {
    requireString(text);

    let graphemes = null;
    let graphemesUnavailableReason = null;
    if (typeof segmenterFactory === 'function') {
        const segmenter = new segmenterFactory(undefined, { granularity: 'grapheme' });
        graphemes = Array.from(segmenter.segment(text)).length;
    } else {
        graphemesUnavailableReason = 'intl-segmenter-unavailable';
    }

    return {
        schemaVersion: UNICODE_METRICS_SCHEMA_VERSION,
        utf16CodeUnits: text.length,
        codePoints: Array.from(text).length,
        graphemes,
        graphemesUnavailableReason,
        utf8Bytes: new TextEncoder().encode(text).length,
    };
}

export function normalizationSnapshot(text) {
    requireString(text);
    return {
        raw: text,
        NFC: text.normalize('NFC'),
        NFD: text.normalize('NFD'),
        NFKC: text.normalize('NFKC'),
        NFKD: text.normalize('NFKD'),
    };
}
