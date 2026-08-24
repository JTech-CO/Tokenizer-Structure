import test from 'node:test';
import assert from 'node:assert/strict';

import {
    REQUEST_CAPABILITY_NAMES,
    REQUEST_LIMITS,
    REQUEST_SCHEMA_VERSION,
    REQUEST_UNAVAILABLE_REASONS,
    createRequestAnalysisResult,
    normalizeRequestSpec,
    rawContentText,
    requestSpecsEqual,
    validateRequestAnalysisResult,
} from '../js/requestContract.js';
import { EVIDENCE_GRADES } from '../js/analysisContract.js';

const SPEC = {
    messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: '안녕' },
    ],
};

function capabilities(overrides = {}) {
    const base = {};
    for (const name of REQUEST_CAPABILITY_NAMES) {
        base[name] = { available: true, unavailableReason: null, detectedBy: 'runtime-probe' };
    }
    return { ...base, ...overrides };
}

function baseResult(overrides = {}) {
    return {
        requestId: 'req-1',
        createdAt: '2026-08-25T00:00:00.000Z',
        modelId: 'demo/artifact',
        artifact: { id: 'demo/artifact', revision: 'abc123' },
        engine: 'real',
        spec: SPEC,
        capabilities: capabilities(),
        raw: { tokenCount: 10, evidence: EVIDENCE_GRADES.AUTHORITATIVE, unavailableReason: null },
        template: { tokenCount: 18, evidence: EVIDENCE_GRADES.AUTHORITATIVE, unavailableReason: null },
        templateText: '<rendered>',
        overhead: { tokens: 8, ratio: 1.8, evidence: EVIDENCE_GRADES.DERIVED, unavailableReason: null },
        specialTokenDuplication: { checked: true, withSpecialTokenCount: 20, duplicatedTokens: 2 },
        segments: [],
        unsupported: [],
        providerCounts: {},
        warnings: [],
        ...overrides,
    };
}

test('request spec normalization applies canonical defaults', () => {
    const spec = normalizeRequestSpec(SPEC);
    assert.equal(spec.schemaVersion, REQUEST_SCHEMA_VERSION);
    assert.equal(spec.type, 'request-spec');
    assert.deepEqual(spec.tools, []);
    assert.deepEqual(spec.documents, []);
    assert.equal(spec.addGenerationPrompt, true);
    assert.equal(rawContentText(spec), 'You are terse.\n안녕');
    assert.equal(requestSpecsEqual(SPEC, spec), true);
});

test('request spec rejects unknown roles, empty content, and unknown fields', () => {
    assert.throws(() => normalizeRequestSpec({ messages: [{ role: 'developer', content: 'x' }] }), /role/);
    assert.throws(() => normalizeRequestSpec({ messages: [{ role: 'user', content: '' }] }), /content/);
    assert.throws(() => normalizeRequestSpec({ messages: [{ role: 'user', content: 'x', extra: 1 }] }), /unknown field/);
    assert.throws(() => normalizeRequestSpec({ messages: [] }), /at least one message/);
    assert.throws(() => normalizeRequestSpec({ messages: [{ role: 'user', content: 'x' }], mode: 'chat' }), /unknown field/);
});

test('tool schemas are bounded in name shape, nesting depth, and serialized size', () => {
    const ok = normalizeRequestSpec({
        messages: [{ role: 'user', content: 'x' }],
        tools: [{ type: 'function', function: { name: 'get_weather', description: 'w', parameters: { type: 'object' } } }],
    });
    assert.equal(ok.tools[0].function.name, 'get_weather');

    const tool = (fn) => ({ messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'function', function: fn }] });
    assert.throws(() => normalizeRequestSpec(tool({ name: '1bad', parameters: {} })), /identifier-like/);
    // 리터럴의 __proto__는 own property가 아니므로 JSON.parse로 실제 키를 만든다.
    const polluted = { a: JSON.parse('{"__proto__": 1}') };
    assert.throws(() => normalizeRequestSpec(tool({ name: 'ok', parameters: polluted })), /unsafe object key/);

    let deep = {};
    let cursor = deep;
    for (let i = 0; i < REQUEST_LIMITS.maxToolSchemaDepth + 2; i += 1) {
        cursor.next = {};
        cursor = cursor.next;
    }
    assert.throws(() => normalizeRequestSpec(tool({ name: 'ok', parameters: deep })), /nesting depth/);

    const big = { blob: 'x'.repeat(REQUEST_LIMITS.maxToolSchemaBytes + 10) };
    assert.throws(() => normalizeRequestSpec(tool({ name: 'ok', parameters: big })), /bytes/);

    assert.throws(() => normalizeRequestSpec({
        messages: [{ role: 'user', content: 'x' }],
        tools: [
            { type: 'function', function: { name: 'dup', parameters: {} } },
            { type: 'function', function: { name: 'dup', parameters: {} } },
        ],
    }), /duplicate tool name/);
});

test('result requires a pinned revision for real-engine output', () => {
    assert.throws(() => createRequestAnalysisResult(baseResult({ artifact: null })), /artifact/);
    const heuristic = createRequestAnalysisResult(baseResult({
        engine: 'heuristic',
        artifact: null,
        capabilities: capabilities({
            chatTemplate: { available: false, unavailableReason: 'heuristic-engine', detectedBy: 'not-probed' },
        }),
        raw: { tokenCount: null, evidence: EVIDENCE_GRADES.UNAVAILABLE, unavailableReason: 'heuristic-engine' },
        template: { tokenCount: null, evidence: EVIDENCE_GRADES.UNAVAILABLE, unavailableReason: 'heuristic-engine' },
        templateText: null,
        overhead: { tokens: null, ratio: null, evidence: EVIDENCE_GRADES.UNAVAILABLE, unavailableReason: 'heuristic-engine' },
        specialTokenDuplication: { checked: false, unavailableReason: 'heuristic-engine' },
    }));
    assert.equal(heuristic.artifact, null);
    assert.equal(heuristic.engine, 'heuristic');
});

test('overhead must equal template minus raw and cannot silently disagree', () => {
    assert.throws(
        () => createRequestAnalysisResult(baseResult({ overhead: { tokens: 7, ratio: 1.8, evidence: EVIDENCE_GRADES.DERIVED } })),
        /template\.tokenCount - raw\.tokenCount/,
    );
    const result = createRequestAnalysisResult(baseResult());
    assert.equal(result.overhead.tokens, result.template.tokenCount - result.raw.tokenCount);
});

test('missing counts always carry an unavailable reason instead of zero', () => {
    assert.throws(
        () => createRequestAnalysisResult(baseResult({
            template: { tokenCount: null, evidence: EVIDENCE_GRADES.UNAVAILABLE, unavailableReason: null },
        })),
        /unavailableReason/,
    );
    assert.throws(
        () => createRequestAnalysisResult(baseResult({
            raw: { tokenCount: 5, evidence: EVIDENCE_GRADES.UNAVAILABLE, unavailableReason: null },
        })),
        /must not be unavailable/,
    );
});

test('an available capability must be confirmed by a runtime probe, never assumed', () => {
    assert.throws(
        () => createRequestAnalysisResult(baseResult({
            capabilities: capabilities({
                tools: { available: true, unavailableReason: null, detectedBy: 'not-probed' },
            }),
        })),
        /runtime probe/,
    );
});

test('provider count slots default to not-configured without inventing a number', () => {
    const result = createRequestAnalysisResult(baseResult());
    for (const slot of ['preflight', 'actual']) {
        assert.equal(result.providerCounts[slot].status, 'not-configured');
        assert.equal(result.providerCounts[slot].tokenCount, null);
        assert.equal(result.providerCounts[slot].evidence, EVIDENCE_GRADES.UNAVAILABLE);
        assert.equal(
            result.providerCounts[slot].unavailableReason,
            REQUEST_UNAVAILABLE_REASONS.GATEWAY_NOT_CONFIGURED,
        );
    }
    assert.throws(
        () => createRequestAnalysisResult(baseResult({
            providerCounts: { preflight: { status: 'not-configured', tokenCount: 12, evidence: EVIDENCE_GRADES.DERIVED } },
        })),
        /must be null while the slot is not configured/,
    );
});

test('validate round-trips a created result and rejects schema drift', () => {
    const created = createRequestAnalysisResult(baseResult());
    assert.deepEqual(validateRequestAnalysisResult(created), created);
    assert.throws(() => validateRequestAnalysisResult({ ...created, schemaVersion: 2 }), /schemaVersion/);
});

test('segments require unique ids and a known kind', () => {
    const withSegments = baseResult({
        segments: [
            {
                id: 'message-0',
                kind: 'message',
                role: 'system',
                roles: ['system'],
                label: 'system #1',
                measurement: { tokenCount: 5, evidence: EVIDENCE_GRADES.DERIVED, unavailableReason: null },
                cachePrefixCandidate: true,
            },
        ],
    });
    assert.equal(createRequestAnalysisResult(withSegments).segments.length, 1);

    assert.throws(() => createRequestAnalysisResult(baseResult({
        segments: [
            { ...withSegments.segments[0] },
            { ...withSegments.segments[0] },
        ],
    })), /duplicate segment id/);

    assert.throws(() => createRequestAnalysisResult(baseResult({
        segments: [{ ...withSegments.segments[0], kind: 'reasoning' }],
    })), /unknown segment kind/);
});

test('a segment role must agree with the roles it actually covers', () => {
    const base = {
        id: 'message-1',
        kind: 'message',
        label: 'system #1 + user #2',
        measurement: { tokenCount: 5, evidence: EVIDENCE_GRADES.DERIVED, unavailableReason: null },
        cachePrefixCandidate: true,
    };
    // 여러 메시지를 덮는 세그먼트는 단일 role을 주장할 수 없다.
    assert.throws(
        () => createRequestAnalysisResult(baseResult({
            segments: [{ ...base, role: 'user', roles: ['system', 'user'] }],
        })),
        /single covered role/,
    );
    const grouped = createRequestAnalysisResult(baseResult({
        segments: [{ ...base, roles: ['system', 'user'] }],
    }));
    assert.equal(grouped.segments[0].role, null);
    assert.deepEqual(grouped.segments[0].roles, ['system', 'user']);

    const single = createRequestAnalysisResult(baseResult({
        segments: [{ ...base, roles: ['user'] }],
    }));
    assert.equal(single.segments[0].role, 'user');
});
