import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ANALYSIS_SCHEMA_VERSION,
    EVIDENCE_GRADES,
    UNAVAILABLE_REASONS,
    createAnalysisRequest,
    createAnalysisResult,
    normalizeCapabilities,
    normalizeProvenance,
    validateAnalysisRequest,
    validateAnalysisResult,
} from '../js/analysisContract.js';

const MODEL_ID = 'Xenova/gpt-4o';
const REVISION = '7956d98f2a83b2751a98ea7136fdf7fe6cf54e69';

function realProvenance(overrides = {}) {
    return {
        runtime: {
            name: '@huggingface/transformers',
            version: '3.8.1',
        },
        artifact: {
            id: MODEL_ID,
            revision: REVISION,
        },
        ...overrides,
    };
}

function realTokenizerResult(overrides = {}) {
    return {
        engine: 'real',
        modelId: MODEL_ID,
        normalized: 'A🤗',
        preTokens: ['A', '🤗'],
        subwords: ['A', '🤗'],
        finalTokens: ['<s>', 'A', '🤗', '</s>'],
        ids: new Uint32Array([0, 7, 8, 2]),
        pieces: [
            {
                token: 'A',
                surface: 'A',
                display: 'A',
                continuation: false,
                len: 1,
            },
            {
                token: '🤗',
                surface: '🤗',
                display: '🤗',
                continuation: false,
                len: 1,
            },
        ],
        preDisplay: ['A', '🤗'],
        finDisplay: ['<s>', 'A', '🤗', '</s>'],
        ...overrides,
    };
}

function heuristicTokenizerResult(overrides = {}) {
    return {
        engine: 'heuristic',
        modelId: null,
        normalized: 'hello',
        preTokens: ['hello'],
        subwords: ['hel', 'lo'],
        finalTokens: ['<|begin_of_text|>', 'hel', 'lo', '<|end_of_text|>'],
        ids: [128000, 101, 102, 128001],
        pieces: [
            {
                token: 'hel',
                surface: 'hel',
                display: 'hel',
                continuation: false,
                len: 3,
            },
            {
                token: 'lo',
                surface: 'lo',
                display: 'lo',
                continuation: false,
                len: 2,
            },
        ],
        preDisplay: ['hello'],
        finDisplay: ['<|begin_of_text|>', 'hel', 'lo', '<|end_of_text|>'],
        ...overrides,
    };
}

test('analysis request is versioned, JSON-safe, and accepts current flat UI input', () => {
    const options = { addSpecialTokens: true, nested: { mode: 'inspect' } };
    const request = createAnalysisRequest({
        requestId: 'pipeline-1',
        modelId: MODEL_ID,
        text: 'A🤗',
        options,
    });

    assert.deepEqual(request, {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        type: 'analysis-request',
        requestId: 'pipeline-1',
        modelId: MODEL_ID,
        text: 'A🤗',
        options,
    });
    assert.notEqual(request.options, options);
    assert.equal(validateAnalysisRequest(request), true);
    assert.deepEqual(JSON.parse(JSON.stringify(request)), request);
});

test('analysis request rejects invalid and non-JSON input before tokenization', () => {
    assert.throws(
        () => createAnalysisRequest({ requestId: '', modelId: MODEL_ID, text: 'x' }),
        /requestId/,
    );
    assert.throws(
        () => createAnalysisRequest({ requestId: '1', modelId: MODEL_ID, text: 7 }),
        /input\.text/,
    );
    assert.throws(
        () => createAnalysisRequest({
            requestId: '1',
            modelId: MODEL_ID,
            text: 'x',
            options: { temperature: Number.NaN },
        }),
        /finite/,
    );

    const cyclic = {};
    cyclic.self = cyclic;
    assert.throws(
        () => createAnalysisRequest({
            requestId: '1',
            modelId: MODEL_ID,
            text: 'x',
            options: cyclic,
        }),
        /cyclic/,
    );
});

test('real adapter output becomes a canonical JSON AnalysisResult', () => {
    const request = createAnalysisRequest({
        requestId: 'real-1',
        modelId: MODEL_ID,
        text: 'A🤗',
        options: { addSpecialTokens: true },
    });
    const result = createAnalysisResult({
        request,
        tokenizerResult: realTokenizerResult(),
        provenance: realProvenance(),
    });

    assert.equal(result.schemaVersion, ANALYSIS_SCHEMA_VERSION);
    assert.equal(result.type, 'analysis-result');
    assert.equal(result.engine, 'real');
    assert.equal(result.requestedModelId, MODEL_ID);
    assert.equal(result.modelId, MODEL_ID);
    assert.deepEqual(result.ids, [0, 7, 8, 2]);
    assert.equal(Array.isArray(result.ids), true);
    assert.deepEqual(result.input, {
        text: 'A🤗',
        utf16Length: 3,
        codePointLength: 2,
        graphemeLength: 2,
        graphemeUnavailableReason: null,
        utf8ByteLength: 5,
    });
    assert.equal(result.pieces[1].len, 1);
    assert.equal(result.pieces[1].lengthUnit, 'codePoint');
    assert.equal(result.evidence.tokenStrings.grade, EVIDENCE_GRADES.AUTHORITATIVE);
    assert.equal(result.evidence.displayStrings.grade, EVIDENCE_GRADES.DERIVED);
    assert.deepEqual(result.capabilities.originalOffsets, {
        available: false,
        unavailableReason: UNAVAILABLE_REASONS.RUNTIME_NOT_EXPOSED,
    });
    assert.deepEqual(result.evidence.originalOffsets, {
        grade: EVIDENCE_GRADES.UNAVAILABLE,
        unavailableReason: UNAVAILABLE_REASONS.RUNTIME_NOT_EXPOSED,
    });
    assert.equal(result.provenance.artifact.revision, REVISION);
    assert.equal(validateAnalysisResult(result), true);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('heuristic fallback preserves requested model but never impersonates its artifact', () => {
    const request = createAnalysisRequest({
        requestId: 'fallback-1',
        modelId: MODEL_ID,
        text: 'hello',
    });
    const result = createAnalysisResult({
        request,
        tokenizerResult: heuristicTokenizerResult(),
        fallbackReason: {
            code: 'tokenizer-load-failed',
            message: 'The selected artifact could not be loaded.',
        },
    });

    assert.equal(result.requestedModelId, MODEL_ID);
    assert.equal(result.modelId, null);
    assert.equal(result.provenance.source, 'heuristic');
    assert.equal(result.provenance.artifact, null);
    assert.equal(result.evidence.normalization.grade, EVIDENCE_GRADES.HEURISTIC);
    assert.equal(result.evidence.tokenIds.grade, EVIDENCE_GRADES.HEURISTIC);
    assert.equal(result.evidence.originalOffsets.unavailableReason, UNAVAILABLE_REASONS.HEURISTIC_ENGINE);
    assert.equal(result.finalTokens.length > result.pieces.length, true);
    assert.equal(validateAnalysisResult(result), true);
});

test('heuristic fallback requires a reason and cannot claim authoritative evidence', () => {
    const request = createAnalysisRequest({
        requestId: 'fallback-2',
        modelId: MODEL_ID,
        text: 'hello',
    });

    assert.throws(
        () => createAnalysisResult({
            request,
            tokenizerResult: heuristicTokenizerResult(),
        }),
        /fallbackReason/,
    );
    assert.throws(
        () => createAnalysisResult({
            request,
            tokenizerResult: heuristicTokenizerResult(),
            evidence: {
                tokenStrings: EVIDENCE_GRADES.AUTHORITATIVE,
            },
            fallbackReason: {
                code: 'tokenizer-load-failed',
                message: 'Load failed.',
            },
        }),
        /authoritative/,
    );
});

test('capability normalization requires consistent unavailable reasons', () => {
    assert.throws(
        () => normalizeCapabilities({
            tokenIds: {
                available: false,
                unavailableReason: null,
            },
        }, { engine: 'real' }),
        /unavailableReason/,
    );
    assert.throws(
        () => normalizeCapabilities({
            originalOffsets: {
                available: true,
                unavailableReason: UNAVAILABLE_REASONS.NOT_PROVIDED,
            },
        }, { engine: 'real' }),
        /must be null/,
    );
    assert.throws(
        () => normalizeCapabilities({ offsetz: false }, { engine: 'real' }),
        /unknown field/,
    );
});

test('adapter and provenance mismatches fail fast', () => {
    const request = createAnalysisRequest({
        requestId: 'real-2',
        modelId: MODEL_ID,
        text: 'A🤗',
    });

    assert.throws(
        () => createAnalysisResult({
            request,
            tokenizerResult: realTokenizerResult({ modelId: 'another/model' }),
            provenance: realProvenance(),
        }),
        /must match request\.modelId/,
    );
    assert.throws(
        () => createAnalysisResult({
            request,
            tokenizerResult: realTokenizerResult(),
            provenance: realProvenance({
                artifact: {
                    id: 'another/model',
                    revision: REVISION,
                },
            }),
        }),
        /must match result modelId/,
    );
    assert.throws(
        () => createAnalysisResult({
            request,
            tokenizerResult: realTokenizerResult(),
        }),
        /provenance/,
    );
});

test('provenance normalization is canonical and idempotent', () => {
    const normalized = normalizeProvenance(realProvenance(), { engine: 'real', modelId: MODEL_ID });
    assert.deepEqual(
        normalizeProvenance(normalized, { engine: 'real', modelId: MODEL_ID }),
        normalized,
    );
});

test('token, display, piece, and ID invariants reject malformed adapter output', () => {
    const request = createAnalysisRequest({
        requestId: 'invalid-adapter',
        modelId: MODEL_ID,
        text: 'A🤗',
    });
    const create = (overrides) => createAnalysisResult({
        request,
        tokenizerResult: realTokenizerResult(overrides),
        provenance: realProvenance(),
    });

    assert.throws(() => create({ ids: [0, 1] }), /finalTokens\.length/);
    assert.throws(() => create({ ids: [0, 7, 8, 1n] }), /safe integer/);
    assert.throws(() => create({ preDisplay: ['A'] }), /preTokens\.length/);
    assert.throws(
        () => create({
            pieces: [
                {
                    token: 'wrong',
                    surface: 'A',
                    display: 'A',
                    continuation: false,
                    len: 1,
                },
                realTokenizerResult().pieces[1],
            ],
        }),
        /must match subwords/,
    );
    assert.throws(
        () => create({
            pieces: [
                realTokenizerResult().pieces[0],
                {
                    ...realTokenizerResult().pieces[1],
                    len: 2,
                },
            ],
        }),
        /code-point length/,
    );
});

test('result validation rejects non-canonical IDs and tampered evidence or metrics', () => {
    const request = createAnalysisRequest({
        requestId: 'tamper-1',
        modelId: MODEL_ID,
        text: 'A🤗',
    });
    const makeResult = () => createAnalysisResult({
        request,
        tokenizerResult: realTokenizerResult(),
        provenance: realProvenance(),
    });

    const typedIds = makeResult();
    typedIds.ids = new Uint32Array(typedIds.ids);
    assert.throws(() => validateAnalysisResult(typedIds), /plain array/);

    const metrics = makeResult();
    metrics.input.utf8ByteLength += 1;
    assert.throws(() => validateAnalysisResult(metrics), /does not match input\.text/);

    const evidence = makeResult();
    evidence.evidence.originalOffsets.unavailableReason = UNAVAILABLE_REASONS.NOT_COMPUTED;
    assert.throws(() => validateAnalysisResult(evidence), /must match capability/);
});
