// contextBudget.js — 요청 세그먼트를 컨텍스트 누적 timeline으로 바꾸는 순수 함수.
// 브라우저·worker·Node 테스트에서 모두 동작하도록 DOM에 의존하지 않는다.
import { EVIDENCE_GRADES } from './analysisContract.js';
import { REQUEST_UNAVAILABLE_REASONS as REASONS } from './requestContract.js';

export const CONTEXT_RESERVE_NAMES = Object.freeze(['output', 'reasoning']);

function fail(path, message) {
    throw new TypeError(path + ': ' + message);
}

function nonNegativeInteger(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail(path, 'expected a non-negative safe integer');
    }
    return value;
}

function nullableWindow(value, path) {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail(path, 'expected null or a positive safe integer');
    }
    return value;
}

function derived(value) {
    return { value, evidence: EVIDENCE_GRADES.DERIVED, unavailableReason: null };
}

function unavailable(unavailableReason) {
    return { value: null, evidence: EVIDENCE_GRADES.UNAVAILABLE, unavailableReason };
}

/**
 * 세그먼트 목록을 누적 timeline으로 만든다.
 * 세그먼트 하나라도 측정 불가면 그 지점부터의 누적값을 추정하지 않는다.
 */
export function buildContextTimeline({
    segments = [],
    contextWindow = null,
    reservedOutputTokens = 0,
    reservedReasoningTokens = 0,
} = {}) {
    if (!Array.isArray(segments)) fail('segments', 'expected an array');
    const windowSize = nullableWindow(contextWindow, 'contextWindow');
    const reservedOutput = nonNegativeInteger(reservedOutputTokens, 'reservedOutputTokens');
    const reservedReasoning = nonNegativeInteger(reservedReasoningTokens, 'reservedReasoningTokens');

    const reserved = reservedOutput + reservedReasoning;
    const inputBudget = windowSize === null ? null : windowSize - reserved;
    if (inputBudget !== null && inputBudget < 0) {
        fail('reservedOutputTokens', 'reserves must not exceed the context window');
    }

    let cumulative = 0;
    let cumulativeKnown = true;
    let truncationAt = null;
    let overflowTokens = null;
    const steps = [];

    for (const item of segments) {
        const tokens = item?.measurement?.tokenCount ?? null;
        if (tokens === null) cumulativeKnown = false;
        else if (cumulativeKnown) cumulative += tokens;

        const stepCumulative = cumulativeKnown ? cumulative : null;
        const overflow = stepCumulative !== null && inputBudget !== null && stepCumulative > inputBudget;
        if (overflow && truncationAt === null) {
            truncationAt = item.id;
            overflowTokens = stepCumulative - inputBudget;
        }

        steps.push({
            id: item.id,
            kind: item.kind,
            role: item.role ?? null,
            roles: Array.isArray(item.roles) ? item.roles : [],
            label: item.label,
            tokens,
            cumulative: stepCumulative,
            cachePrefixCandidate: Boolean(item.cachePrefixCandidate),
            overflow,
            unavailableReason: tokens === null
                ? (item?.measurement?.unavailableReason ?? REASONS.NOT_COMPUTED)
                : null,
        });
    }

    const inputTokens = cumulativeKnown ? cumulative : null;
    const cachePrefixTokens = computeCachePrefixTokens(segments);

    return {
        contextWindow: windowSize === null
            ? unavailable(REASONS.NOT_PROVIDED)
            : { value: windowSize, evidence: EVIDENCE_GRADES.AUTHORITATIVE, unavailableReason: null },
        reserved: {
            output: reservedOutput,
            reasoning: reservedReasoning,
            total: reserved,
        },
        inputBudget: inputBudget === null ? unavailable(REASONS.NOT_PROVIDED) : derived(inputBudget),
        steps,
        inputTokens: inputTokens === null ? unavailable(REASONS.NOT_COMPUTED) : derived(inputTokens),
        headroom: inputTokens === null || inputBudget === null
            ? unavailable(inputTokens === null ? REASONS.NOT_COMPUTED : REASONS.NOT_PROVIDED)
            : derived(inputBudget - inputTokens),
        truncation: {
            predicted: truncationAt !== null,
            atSegmentId: truncationAt,
            overflowTokens,
            evidence: inputBudget === null || !cumulativeKnown
                ? EVIDENCE_GRADES.UNAVAILABLE
                : EVIDENCE_GRADES.DERIVED,
            unavailableReason: inputBudget === null
                ? REASONS.NOT_PROVIDED
                : (cumulativeKnown ? null : REASONS.NOT_COMPUTED),
            // 실제 truncation 지점은 제공사 정책에 따라 달라진다. 로컬 예측임을 남긴다.
            note: 'local-budget-prediction-not-provider-policy',
        },
        cachePrefix: cachePrefixTokens.prefix,
        dynamicSuffix: cachePrefixTokens.suffix,
    };
}

function computeCachePrefixTokens(segments) {
    let prefix = 0;
    let suffix = 0;
    let prefixKnown = true;
    let suffixKnown = true;

    for (const item of segments) {
        const tokens = item?.measurement?.tokenCount ?? null;
        if (item?.cachePrefixCandidate) {
            if (tokens === null) prefixKnown = false;
            else prefix += tokens;
        } else if (tokens === null) suffixKnown = false;
        else suffix += tokens;
    }

    return {
        prefix: prefixKnown
            ? {
                  ...derived(prefix),
                  // 제공사별 최소 캐시 길이·TTL·과금은 데이터가 없으면 주장하지 않는다.
                  providerEligibility: unavailable(REASONS.CATALOG_HAS_NO_RATE),
              }
            : { ...unavailable(REASONS.NOT_COMPUTED), providerEligibility: unavailable(REASONS.CATALOG_HAS_NO_RATE) },
        suffix: suffixKnown ? derived(suffix) : unavailable(REASONS.NOT_COMPUTED),
    };
}

/**
 * 대화가 turn마다 새 요청으로 전송될 때 누적 재입력 토큰을 계산한다.
 * caching이나 서버측 상태 보존을 가정하지 않는다.
 */
export function estimateConversationReplay(segments = []) {
    if (!Array.isArray(segments)) fail('segments', 'expected an array');

    let fixedOverhead = 0;
    let fixedKnown = true;
    for (const item of segments) {
        if (item?.kind === 'message') continue;
        const tokens = item?.measurement?.tokenCount ?? null;
        if (tokens === null) fixedKnown = false;
        else fixedOverhead += tokens;
    }

    let running = 0;
    let known = fixedKnown;
    let turns = 0;
    let replayTokens = 0;

    for (const item of segments) {
        if (item?.kind !== 'message') continue;
        const tokens = item?.measurement?.tokenCount ?? null;
        if (tokens === null) known = false;
        else running += tokens;
        // 한 세그먼트가 여러 메시지를 덮을 수 있으므로 단일 role이 아니라 목록을 본다.
        const roles = Array.isArray(item.roles) && item.roles.length > 0
            ? item.roles
            : (item.role ? [item.role] : []);
        const userTurns = roles.filter((role) => role === 'user').length;
        if (userTurns === 0) continue;
        turns += userTurns;
        // 그룹으로 묶인 turn은 그룹이 끝난 시점의 누적값으로만 관측할 수 있다.
        if (known) replayTokens += userTurns * (running + fixedOverhead);
    }

    if (!known) {
        return {
            turns,
            replayTokens: unavailable(REASONS.NOT_COMPUTED),
            singleRequestTokens: unavailable(REASONS.NOT_COMPUTED),
            assumption: 'one-request-per-user-turn-no-cache',
        };
    }
    return {
        turns,
        replayTokens: derived(replayTokens),
        singleRequestTokens: derived(running + fixedOverhead),
        assumption: 'one-request-per-user-turn-no-cache',
    };
}
