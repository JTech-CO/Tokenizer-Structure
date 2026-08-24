import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContextTimeline, estimateConversationReplay } from '../js/contextBudget.js';
import { EVIDENCE_GRADES } from '../js/analysisContract.js';

function segment(id, kind, role, tokens, cachePrefixCandidate = false) {
    return {
        id,
        kind,
        role,
        label: id,
        measurement: tokens === null
            ? { tokenCount: null, evidence: EVIDENCE_GRADES.UNAVAILABLE, unavailableReason: 'not-computed' }
            : { tokenCount: tokens, evidence: EVIDENCE_GRADES.DERIVED, unavailableReason: null },
        cachePrefixCandidate,
    };
}

const SEGMENTS = [
    segment('message-0', 'message', 'system', 40, true),
    segment('message-1', 'message', 'user', 20, true),
    segment('message-2', 'message', 'assistant', 30, true),
    segment('message-3', 'message', 'user', 10, false),
    segment('tools', 'tools', null, 100, true),
    segment('generation-prompt', 'generation-prompt', null, 5, false),
];

test('timeline accumulates tokens and reports headroom against reserves', () => {
    const timeline = buildContextTimeline({
        segments: SEGMENTS,
        contextWindow: 1000,
        reservedOutputTokens: 300,
        reservedReasoningTokens: 100,
    });
    assert.deepEqual(timeline.steps.map((step) => step.cumulative), [40, 60, 90, 100, 200, 205]);
    assert.equal(timeline.inputTokens.value, 205);
    assert.equal(timeline.inputBudget.value, 600);
    assert.equal(timeline.headroom.value, 395);
    assert.equal(timeline.reserved.total, 400);
    assert.equal(timeline.truncation.predicted, false);
    assert.equal(timeline.truncation.atSegmentId, null);
});

test('truncation is predicted at the first segment that passes the input budget', () => {
    const timeline = buildContextTimeline({
        segments: SEGMENTS,
        contextWindow: 150,
        reservedOutputTokens: 50,
    });
    assert.equal(timeline.inputBudget.value, 100);
    assert.equal(timeline.truncation.predicted, true);
    assert.equal(timeline.truncation.atSegmentId, 'tools');
    assert.equal(timeline.truncation.overflowTokens, 100);
    assert.equal(timeline.steps.filter((step) => step.overflow).map((step) => step.id).join(','), 'tools,generation-prompt');
    // 로컬 예산 예측일 뿐 제공사 truncation 정책이 아님을 결과에 남긴다.
    assert.equal(timeline.truncation.note, 'local-budget-prediction-not-provider-policy');
});

test('a segment that reaches exactly the budget does not count as truncated', () => {
    const timeline = buildContextTimeline({
        segments: [segment('a', 'message', 'user', 100, false)],
        contextWindow: 100,
    });
    assert.equal(timeline.truncation.predicted, false);
    assert.equal(timeline.headroom.value, 0);
});

test('an unknown segment count stops the cumulative chain instead of guessing', () => {
    const timeline = buildContextTimeline({
        segments: [
            segment('a', 'message', 'user', 10, true),
            segment('b', 'message', 'assistant', null, true),
            segment('c', 'message', 'user', 10, false),
        ],
        contextWindow: 1000,
    });
    assert.equal(timeline.steps[0].cumulative, 10);
    assert.equal(timeline.steps[1].cumulative, null);
    assert.equal(timeline.steps[2].cumulative, null);
    assert.equal(timeline.inputTokens.value, null);
    assert.equal(timeline.inputTokens.unavailableReason, 'not-computed');
    assert.equal(timeline.headroom.value, null);
    assert.equal(timeline.truncation.evidence, EVIDENCE_GRADES.UNAVAILABLE);
});

test('an unknown context window leaves budget and headroom unavailable', () => {
    const timeline = buildContextTimeline({ segments: SEGMENTS, contextWindow: null });
    assert.equal(timeline.contextWindow.value, null);
    assert.equal(timeline.inputBudget.value, null);
    assert.equal(timeline.headroom.value, null);
    assert.equal(timeline.truncation.predicted, false);
    assert.equal(timeline.truncation.unavailableReason, 'not-provided');
    assert.equal(timeline.inputTokens.value, 205);
});

test('cache prefix and dynamic suffix split the request without claiming provider eligibility', () => {
    const timeline = buildContextTimeline({ segments: SEGMENTS, contextWindow: 1000 });
    assert.equal(timeline.cachePrefix.value, 190);
    assert.equal(timeline.dynamicSuffix.value, 15);
    assert.equal(timeline.cachePrefix.value + timeline.dynamicSuffix.value, timeline.inputTokens.value);
    assert.equal(timeline.cachePrefix.providerEligibility.value, null);
    assert.equal(timeline.cachePrefix.providerEligibility.unavailableReason, 'catalog-has-no-rate');
});

test('reserves may not exceed the context window', () => {
    assert.throws(
        () => buildContextTimeline({ segments: [], contextWindow: 100, reservedOutputTokens: 200 }),
        /must not exceed the context window/,
    );
    assert.throws(
        () => buildContextTimeline({ segments: [], contextWindow: 100, reservedOutputTokens: -1 }),
        /non-negative/,
    );
});

test('conversation replay sums the request size sent at each user turn', () => {
    const replay = estimateConversationReplay(SEGMENTS);
    // 고정 오버헤드(tools 100 + generation prompt 5) + 각 user turn 시점의 누적 메시지.
    assert.equal(replay.turns, 2);
    assert.equal(replay.singleRequestTokens.value, 205);
    assert.equal(replay.replayTokens.value, (60 + 105) + (100 + 105));
    assert.equal(replay.assumption, 'one-request-per-user-turn-no-cache');
});

test('a grouped segment still counts every user turn it covers', () => {
    // 템플릿이 system 단독 prefix를 거부하면 두 메시지가 한 세그먼트로 묶인다.
    const grouped = {
        id: 'message-1',
        kind: 'message',
        role: null,
        roles: ['system', 'user'],
        label: 'system #1 + user #2',
        measurement: { tokenCount: 60, evidence: EVIDENCE_GRADES.DERIVED, unavailableReason: null },
        cachePrefixCandidate: true,
    };
    const replay = estimateConversationReplay([
        grouped,
        segment('message-2', 'message', 'assistant', 30, true),
        segment('message-3', 'message', 'user', 10, false),
        segment('tools', 'tools', null, 100, true),
    ]);
    assert.equal(replay.turns, 2);
    assert.equal(replay.replayTokens.value, (60 + 100) + (100 + 100));
    assert.equal(replay.singleRequestTokens.value, 200);
});

test('conversation replay reports unavailable rather than a partial sum', () => {
    const replay = estimateConversationReplay([
        segment('message-0', 'message', 'user', 10, true),
        segment('message-1', 'message', 'assistant', null, true),
        segment('message-2', 'message', 'user', 10, false),
    ]);
    assert.equal(replay.replayTokens.value, null);
    assert.equal(replay.singleRequestTokens.value, null);
    assert.equal(replay.turns, 2);
});
