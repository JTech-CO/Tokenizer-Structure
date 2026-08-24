// costScenario.js — 조건 기반 비용 시나리오. 카탈로그에 단가가 없는 과금 요소는
// 0으로 채우지 않고 이유와 함께 제외 항목으로 남긴다.
import { EVIDENCE_GRADES } from './analysisContract.js';
import { REQUEST_UNAVAILABLE_REASONS as REASONS } from './requestContract.js';

export const COST_SCHEMA_VERSION = 1;

export const COST_MODIFIER_NAMES = Object.freeze([
    'longContext', 'cachedRead', 'cachedWrite', 'batch', 'priority', 'flex', 'region',
]);

export const COST_TOOL_CHARGE_NAMES = Object.freeze([
    'webSearch', 'fileSearch', 'codeInterpreter', 'storage', 'grounding',
]);

// 로드맵 10절의 만료 경고 구간.
export const LIFECYCLE_WARNING_DAYS = Object.freeze([30, 7, 1]);
// 가격 검토 주기(주 1회) 기준의 신선도 구간.
export const PRICING_FRESHNESS_DAYS = Object.freeze({ fresh: 7, reviewDue: 30 });

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function fail(path, message) {
    throw new TypeError(path + ': ' + message);
}

function parseDate(value, path) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
        fail(path, 'expected a YYYY-MM-DD date string');
    }
    const parsed = Date.parse(`${value}T00:00:00Z`);
    // Date.parse는 2026-02-30을 03-02로 굴려버리므로 왕복 비교로 실제 달력 날짜만 통과시킨다.
    if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
        fail(path, 'expected a valid calendar date');
    }
    return parsed;
}

function daysBetween(fromMs, toMs) {
    return Math.round((toMs - fromMs) / MS_PER_DAY);
}

function nonNegativeInteger(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) fail(path, 'expected a non-negative safe integer');
    return value;
}

function positiveInteger(value, path) {
    if (!Number.isSafeInteger(value) || value <= 0) fail(path, 'expected a positive safe integer');
    return value;
}

function unavailable(unavailableReason, detail = '') {
    return { available: false, evidence: EVIDENCE_GRADES.UNAVAILABLE, unavailableReason, detail };
}

/**
 * 카탈로그의 수명주기 필드를 기준 시각과 비교한다.
 * effectiveUntil은 그 날짜까지 유효(inclusive)로 해석한다.
 */
export function resolveRateSchedule(entry, { at }) {
    if (entry === null || typeof entry !== 'object') fail('entry', 'expected a pricing entry');
    const nowMs = parseDate(at, 'at');

    const effectiveFrom = entry.effectiveFrom ?? null;
    const effectiveUntil = entry.effectiveUntil ?? null;
    const guaranteedThrough = entry.guaranteedThrough ?? null;
    const sunsetEarliest = entry.sunsetEarliest ?? null;

    let status = 'active';
    let daysRemaining = null;
    let warningLevel = null;

    if (effectiveFrom !== null && nowMs < parseDate(effectiveFrom, 'entry.effectiveFrom')) {
        status = 'not-yet-effective';
    } else if (effectiveUntil !== null) {
        const untilMs = parseDate(effectiveUntil, 'entry.effectiveUntil');
        daysRemaining = daysBetween(nowMs, untilMs);
        if (daysRemaining < 0) {
            status = 'expired';
            warningLevel = 'expired';
        } else {
            status = 'active';
            for (const threshold of LIFECYCLE_WARNING_DAYS) {
                if (daysRemaining <= threshold) warningLevel = `${threshold}-day`;
            }
        }
    }

    return {
        status,
        catalogStatus: entry.status ?? 'ga',
        effectiveFrom,
        effectiveUntil,
        guaranteedThrough,
        sunsetEarliest,
        replacement: entry.replacement ?? null,
        daysRemaining,
        warningLevel,
        evidence: EVIDENCE_GRADES.AUTHORITATIVE,
    };
}

/**
 * 입력 토큰 수로 단가 구간을 고른다. 임계값과 정확히 같으면 기본 구간이다
 * (threshold 초과일 때만 상위 구간).
 */
export function resolveTier(entry, inputTokens) {
    nonNegativeInteger(inputTokens, 'inputTokens');
    if (typeof entry?.input !== 'number' || typeof entry?.output !== 'number') {
        fail('entry', 'expected numeric input and output rates');
    }
    if (entry.tiered && inputTokens > entry.tiered.threshold) {
        return {
            tier: 'high',
            threshold: entry.tiered.threshold,
            input: entry.tiered.input,
            output: entry.tiered.output,
            evidence: EVIDENCE_GRADES.AUTHORITATIVE,
        };
    }
    return {
        tier: 'base',
        threshold: entry.tiered ? entry.tiered.threshold : null,
        input: entry.input,
        output: entry.output,
        evidence: EVIDENCE_GRADES.AUTHORITATIVE,
    };
}

function resolveModifiers(entry, tier) {
    const declared = entry.modifiers ?? {};
    const modifiers = {};
    for (const name of COST_MODIFIER_NAMES) {
        if (name === 'longContext') {
            modifiers[name] = entry.tiered
                ? {
                      available: true,
                      evidence: EVIDENCE_GRADES.AUTHORITATIVE,
                      unavailableReason: null,
                      applied: tier.tier === 'high',
                      threshold: entry.tiered.threshold,
                      input: entry.tiered.input,
                      output: entry.tiered.output,
                  }
                : unavailable(REASONS.CATALOG_HAS_NO_RATE, 'This entry declares no long-context tier.');
            continue;
        }
        modifiers[name] = Object.prototype.hasOwnProperty.call(declared, name)
            ? { available: true, evidence: EVIDENCE_GRADES.AUTHORITATIVE, unavailableReason: null, ...declared[name] }
            : unavailable(REASONS.CATALOG_HAS_NO_RATE, 'The pricing catalog declares no rate for this modifier.');
    }
    return modifiers;
}

function resolveToolCharges(entry) {
    const declared = entry.toolCharges ?? {};
    const charges = {};
    for (const name of COST_TOOL_CHARGE_NAMES) {
        charges[name] = Object.prototype.hasOwnProperty.call(declared, name)
            ? { available: true, evidence: EVIDENCE_GRADES.AUTHORITATIVE, unavailableReason: null, ...declared[name] }
            : unavailable(REASONS.CATALOG_HAS_NO_RATE, 'The pricing catalog declares no charge for this tool.');
    }
    return charges;
}

export function resolvePricingFreshness({ verifiedAt, at }) {
    const verifiedMs = parseDate(verifiedAt, 'verifiedAt');
    const nowMs = parseDate(at, 'at');
    const ageDays = daysBetween(verifiedMs, nowMs);
    let status = 'fresh';
    if (ageDays < 0) status = 'future-dated';
    else if (ageDays > PRICING_FRESHNESS_DAYS.reviewDue) status = 'stale';
    else if (ageDays > PRICING_FRESHNESS_DAYS.fresh) status = 'review-due';
    return { verifiedAt, ageDays, status, evidence: EVIDENCE_GRADES.AUTHORITATIVE };
}

function usd(pricePerMillion, tokens) {
    return (tokens / 1_000_000) * pricePerMillion;
}

/**
 * 호출당·일간·월간 비용 시나리오. 로컬 artifact 토큰 수는 제공사 토큰 수와 같지
 * 않으므로 countSemantics를 결과에 그대로 보존한다.
 */
export function computeCostScenario({
    entry,
    inputTokens,
    outputTokens = 0,
    callsPerDay = 1,
    daysPerMonth = 30,
    at,
    pricingVerifiedAt,
    countSemantics = 'rate-only-no-tokenizer-equivalence',
}) {
    if (entry === null || typeof entry !== 'object') fail('entry', 'expected a pricing entry');
    nonNegativeInteger(inputTokens, 'inputTokens');
    nonNegativeInteger(outputTokens, 'outputTokens');
    positiveInteger(callsPerDay, 'callsPerDay');
    positiveInteger(daysPerMonth, 'daysPerMonth');

    const schedule = resolveRateSchedule(entry, { at });
    const tier = resolveTier(entry, inputTokens);
    const modifiers = resolveModifiers(entry, tier);
    const toolCharges = resolveToolCharges(entry);
    const freshness = resolvePricingFreshness({ verifiedAt: pricingVerifiedAt, at });

    const inputCost = usd(tier.input, inputTokens);
    const outputCost = usd(tier.output, outputTokens);
    const perCall = inputCost + outputCost;

    const excluded = [];
    for (const [name, value] of Object.entries(modifiers)) {
        if (!value.available) excluded.push({ item: `modifier.${name}`, reason: value.unavailableReason, detail: value.detail });
    }
    for (const [name, value] of Object.entries(toolCharges)) {
        if (!value.available) excluded.push({ item: `toolCharge.${name}`, reason: value.unavailableReason, detail: value.detail });
    }
    excluded.push({
        item: 'modality.nonText',
        reason: REASONS.UNSUPPORTED,
        detail: 'Image, audio, and file usage is not counted by a local text tokenizer.',
    });

    // 만료·미개시 단가로 미래 비용을 단정하지 않는다.
    const usable = schedule.status === 'active';
    const scenarioEvidence = usable ? EVIDENCE_GRADES.DERIVED : EVIDENCE_GRADES.UNAVAILABLE;
    const scenarioReason = usable ? null : REASONS.UNSUPPORTED;

    const amount = (value) => (usable
        ? { value, evidence: EVIDENCE_GRADES.DERIVED, unavailableReason: null }
        : { value: null, evidence: EVIDENCE_GRADES.UNAVAILABLE, unavailableReason: scenarioReason });

    return {
        schemaVersion: COST_SCHEMA_VERSION,
        modelId: entry.id,
        modelName: entry.name,
        provider: entry.provider,
        currency: 'USD',
        currencyBasis: {
            asOf: freshness.verifiedAt,
            fx: {
                available: false,
                evidence: EVIDENCE_GRADES.UNAVAILABLE,
                unavailableReason: REASONS.NOT_PROVIDED,
                detail: 'The catalog stores USD rates only; no exchange-rate source is configured.',
            },
        },
        freshness,
        schedule,
        baseRate: {
            input: entry.input,
            output: entry.output,
            unit: 'usd-per-million-tokens',
            evidence: EVIDENCE_GRADES.AUTHORITATIVE,
        },
        appliedRate: tier,
        modifiers,
        toolCharges,
        usage: { inputTokens, outputTokens, callsPerDay, daysPerMonth },
        perCall: {
            input: amount(inputCost),
            output: amount(outputCost),
            total: amount(perCall),
        },
        perDay: { total: amount(perCall * callsPerDay) },
        perMonth: { total: amount(perCall * callsPerDay * daysPerMonth) },
        included: ['input-tokens', 'output-tokens'],
        excluded,
        countSemantics,
        evidence: scenarioEvidence,
    };
}
