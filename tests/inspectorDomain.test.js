import test from 'node:test';
import assert from 'node:assert/strict';

import { createAnalysisRequest, createAnalysisResult } from '../js/analysisContract.js';
import {
    DEFAULT_INPUT_LIMITS,
    INSPECTOR_EXPORT_SCHEMA_VERSION,
    INSPECTOR_SHARE_SCHEMA_VERSION,
    ROUNDTRIP_KINDS,
    analyzeInput,
    applyUnicodeLens,
    classifyRoundTrip,
    createInspectorExport,
    createLensComparison,
    decodeShareState,
    diffCodePoints,
    encodeShareState,
    escapeCsvCell,
    serializeInspectorCsv,
    serializeInspectorJson,
} from '../js/inspectorDomain.js';

function analysisResult(text = '=SUM(A1:A2)') {
    const request = createAnalysisRequest({
        requestId: 'inspect-1',
        modelId: null,
        text,
        options: { addSpecialTokens: true },
    });
    return createAnalysisResult({
        request,
        tokenizerResult: {
            engine: 'heuristic',
            modelId: null,
            normalized: text,
            preTokens: [text],
            subwords: [text],
            finalTokens: ['<s>', text, '</s>'],
            ids: [0, 7, 2],
            pieces: [{
                token: text,
                surface: text,
                display: text,
                continuation: false,
                len: [...text].length,
            }],
            preDisplay: [text],
            finDisplay: ['<s>', text, '</s>'],
        },
    });
}

function replayDiff(diff, side) {
    return diff.segments
        .filter((segment) => segment.type === 'equal'
            || (side === 'before' ? segment.type === 'delete' : segment.type === 'insert'))
        .map((segment) => segment.value)
        .join('');
}

test('input status distinguishes code points, UTF-16, UTF-8, lines, and large input', () => {
    const status = analyzeInput('A🤗\n한', {
        maxCharacters: 4,
        maxUtf8Bytes: 9,
        largeInputCharacters: 4,
        largeInputUtf8Bytes: 9,
    });

    assert.deepEqual(status.metrics, {
        lines: 2,
        characters: 4,
        utf16CodeUnits: 5,
        graphemes: 4,
        graphemesUnavailableReason: null,
        utf8Bytes: 9,
    });
    assert.equal(status.characterUnit, 'codePoint');
    assert.equal(status.accepted, true);
    assert.equal(status.largeInput, true);
    assert.deepEqual(status.remaining, { characters: 0, utf8Bytes: 0 });
    assert.equal(status.warnings[0].code, 'large-input');
});

test('input status reports character and byte limit violations independently', () => {
    const status = analyzeInput('🤗🤗', {
        maxCharacters: 1,
        maxUtf8Bytes: 7,
        largeInputCharacters: 1,
        largeInputUtf8Bytes: 7,
    });

    assert.equal(status.accepted, false);
    assert.deepEqual(status.violations.map((entry) => entry.code), [
        'character-limit-exceeded',
        'utf8-byte-limit-exceeded',
    ]);
    assert.deepEqual(DEFAULT_INPUT_LIMITS, {
        maxCharacters: 100_000,
        maxUtf8Bytes: 1_000_000,
        largeInputCharacters: 10_000,
        largeInputUtf8Bytes: 100_000,
    });
    assert.throws(
        () => analyzeInput('x', { largeInputCharacters: 2, maxCharacters: 1 }),
        /must not exceed/,
    );
});

test('Unicode lenses produce deterministic A/B variants', () => {
    assert.equal(applyUnicodeLens('a b', 'spaces'), 'a\u00a0b');
    assert.equal(applyUnicodeLens('a\u00a0b', 'spaces'), 'a b');
    assert.equal(applyUnicodeLens('e\u0301', 'nfc'), 'é');
    assert.equal(applyUnicodeLens('é', 'nfd'), 'e\u0301');
    assert.equal(applyUnicodeLens('Tokenizer', 'case'), 'tokenizer');
    assert.equal(applyUnicodeLens('👩‍💻', 'emoji'), '👩💻');
    assert.equal(applyUnicodeLens('    first\n        second', 'code-indentation'), '\tfirst\n\t\tsecond');
    assert.equal(applyUnicodeLens('\tfirst', 'code-indentation'), '    first');
    assert.throws(() => applyUnicodeLens('x', 'mystery'), /Unsupported/);
});

test('lens comparison carries metrics and a visual code-point diff', () => {
    const comparison = createLensComparison('é', 'nfd');

    assert.equal(comparison.changed, true);
    assert.equal(comparison.variant, 'e\u0301');
    assert.equal(comparison.baselineInput.metrics.characters, 1);
    assert.equal(comparison.variantInput.metrics.characters, 2);
    assert.equal(replayDiff(comparison.diff, 'before'), 'é');
    assert.equal(replayDiff(comparison.diff, 'after'), 'e\u0301');
});

test('precise diff treats an astral emoji as one code point and remains reversible', () => {
    const diff = diffCodePoints('A🤗B', 'A🚀B');

    assert.equal(diff.strategy, 'lcs');
    assert.equal(diff.coarse, false);
    assert.deepEqual(diff.segments.map(({ type, codePointLength }) => ({ type, codePointLength })), [
        { type: 'equal', codePointLength: 1 },
        { type: 'delete', codePointLength: 1 },
        { type: 'insert', codePointLength: 1 },
        { type: 'equal', codePointLength: 1 },
    ]);
    assert.equal(replayDiff(diff, 'before'), 'A🤗B');
    assert.equal(replayDiff(diff, 'after'), 'A🚀B');
});

test('large diff uses bounded common edges and enforces an explicit input ceiling', () => {
    const before = `prefix-${'x'.repeat(20)}-suffix`;
    const after = `prefix-${'y'.repeat(20)}-suffix`;
    const diff = diffCodePoints(before, after, { maxMatrixCells: 100 });

    assert.equal(diff.strategy, 'common-edges');
    assert.equal(diff.coarse, true);
    assert.equal(diff.segments[0].value, 'prefix-');
    assert.equal(diff.segments.at(-1).value, '-suffix');
    assert.equal(replayDiff(diff, 'before'), before);
    assert.equal(replayDiff(diff, 'after'), after);
    assert.throws(
        () => diffCodePoints('abcd', 'abcd', { maxCodePoints: 3 }),
        /exceeds 3 code points/,
    );
    assert.throws(
        () => diffCodePoints('a', 'b', { maxMatrixCells: 1_000_001 }),
        /must not exceed 1000000/,
    );
});

test('roundtrip classification distinguishes exact, normalization, UNK, special removal, and other', () => {
    assert.equal(
        classifyRoundTrip({ source: 'hello', decoded: 'hello' }).kind,
        ROUNDTRIP_KINDS.LOSSLESS,
    );
    assert.equal(
        classifyRoundTrip({ source: 'e\u0301', decoded: 'é' }).kind,
        ROUNDTRIP_KINDS.NORMALIZATION,
    );
    assert.equal(
        classifyRoundTrip({ source: 'rare', decoded: '<unk>', unknownTokenCount: 1 }).kind,
        ROUNDTRIP_KINDS.UNKNOWN_TOKEN,
    );
    assert.equal(
        classifyRoundTrip({ source: '<s>hello', decoded: 'hello', specialTokensRemoved: true }).kind,
        ROUNDTRIP_KINDS.SPECIAL_TOKEN_REMOVAL,
    );
    assert.equal(
        classifyRoundTrip({ source: 'hello', decoded: 'helo' }).kind,
        ROUNDTRIP_KINDS.OTHER,
    );
});

test('versioned Inspector export derives token source and UTF-8 details from AnalysisResult', () => {
    const result = analysisResult('한');
    const payload = createInspectorExport(result, { generatedAt: '2026-08-24T00:00:00Z' });

    assert.equal(payload.schemaVersion, INSPECTOR_EXPORT_SCHEMA_VERSION);
    assert.equal(payload.type, 'tokenizer-inspector-export');
    assert.equal(payload.generatedAt, '2026-08-24T00:00:00.000Z');
    assert.equal(payload.tokenCount, 3);
    assert.equal(payload.tokens[0].sourceKind, 'added-or-special');
    assert.equal(payload.tokens[1].sourceKind, 'sequence-a');
    assert.deepEqual(payload.tokens[1].surfaceUtf8Bytes, [0xED, 0x95, 0x9C]);
    assert.equal(payload.tokens[1].surfaceUtf8Hex, 'ED 95 9C');

    payload.input.text = 'changed';
    assert.equal(result.input.text, '한');
});

test('JSON export is deterministic when generatedAt is supplied', () => {
    const json = serializeInspectorJson(analysisResult('A🤗'), {
        generatedAt: '2026-08-24T12:34:56Z',
        pretty: false,
    });
    const payload = JSON.parse(json);

    assert.equal(payload.schemaVersion, INSPECTOR_EXPORT_SCHEMA_VERSION);
    assert.equal(payload.generatedAt, '2026-08-24T12:34:56.000Z');
    assert.equal(payload.tokens[1].surfaceUtf8Bytes.length, 5);
});

test('CSV escaping quotes delimiters and neutralizes spreadsheet formulas', () => {
    assert.equal(escapeCsvCell('a,"b"\nc'), '"a,""b""\nc"');
    assert.equal(escapeCsvCell('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
    assert.equal(escapeCsvCell('  +cmd'), '"\'  +cmd"');
    assert.equal(escapeCsvCell('-1'), '"\'-1"');
    assert.equal(escapeCsvCell(7), '7');

    const csv = serializeInspectorCsv(analysisResult(), {
        generatedAt: '2026-08-24T00:00:00Z',
    });
    assert.match(csv, /"raw","display"/);
    assert.match(csv, /"'=SUM\(A1:A2\)"/);
    assert.equal(csv.split('\r\n').length, 4);
});

test('URL share state omits input by default and preserves only versioned state', () => {
    const query = encodeShareState({
        modelId: 'Xenova/gpt-4o',
        view: 'inspector',
        lang: 'ko',
        options: { addSpecialTokens: false },
        text: '비밀 입력',
    });
    const decoded = decodeShareState(query);

    assert.equal(decoded.schemaVersion, INSPECTOR_SHARE_SCHEMA_VERSION);
    assert.equal(decoded.includesInput, false);
    assert.equal(Object.hasOwn(decoded.state, 'text'), false);
    assert.equal(decoded.state.modelId, 'Xenova/gpt-4o');
    assert.deepEqual(decoded.state.options, { addSpecialTokens: false });
});

test('URL share state restores Unicode input only after explicit opt-in', () => {
    const query = encodeShareState(
        { modelId: 'Xenova/gpt-4o', text: 'A🤗 한글' },
        { includeInput: true },
    );
    const decoded = decodeShareState(`https://example.test/app?${query}#ignored`);

    assert.equal(decoded.includesInput, true);
    assert.equal(decoded.state.text, 'A🤗 한글');
});

test('URL share decoder rejects malformed, unversioned, and unsafe state', () => {
    assert.equal(decodeShareState('view=inspector'), null);
    assert.throws(
        () => decodeShareState('inspector=%7Bbad'),
        /invalid JSON/,
    );

    const wrongVersion = new URLSearchParams({
        inspector: JSON.stringify({
            schemaVersion: 999,
            type: 'tokenizer-inspector-share',
            includesInput: false,
            state: {},
        }),
    });
    assert.throws(() => decodeShareState(wrongVersion), /unsupported share state version/);

    const unsafe = new URLSearchParams({
        inspector: '{"schemaVersion":1,"type":"tokenizer-inspector-share","includesInput":false,"state":{"__proto__":{"polluted":true}}}',
    });
    assert.throws(() => decodeShareState(unsafe), /unknown|unsafe/);
    assert.equal({}.polluted, undefined);

    const falseConsentClaim = new URLSearchParams({
        inspector: JSON.stringify({
            schemaVersion: 1,
            type: 'tokenizer-inspector-share',
            includesInput: true,
            state: { modelId: 'Xenova/gpt-4o' },
        }),
    });
    assert.throws(() => decodeShareState(falseConsentClaim), /without including it/);
    assert.throws(() => encodeShareState({ modelId: { nested: true } }), /must be a string/);
});
