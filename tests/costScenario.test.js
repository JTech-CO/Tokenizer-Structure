import test from 'node:test';
import assert from 'node:assert/strict';

import {
    COST_MODIFIER_NAMES,
    COST_TOOL_CHARGE_NAMES,
    computeCostScenario,
    resolvePricingFreshness,
    resolveRateSchedule,
    resolveTier,
} from '../js/costScenario.js';
import { PRICING, PRICING_AS_OF, PRICING_CATALOG, ratesFor } from '../js/pricing.js';
import { EVIDENCE_GRADES } from '../js/analysisContract.js';

const TIERED = Object.freeze({
    provider: 'Demo', name: 'Demo Tiered', id: 'demo-tiered',
    input: 2, output: 12, context: 1_000_000,
    tiered: { threshold: 272_000, input: 4, output: 18 },
});

const EXPIRING = Object.freeze({
    provider: 'Demo', name: 'Demo Expiring', id: 'demo-expiring',
    input: 1, output: 5, context: 100_000, effectiveUntil: '2026-12-31',
});

test('tier boundaries follow N-1 base, N base, N+1 high', () => {
    const threshold = TIERED.tiered.threshold;
    assert.equal(resolveTier(TIERED, threshold - 1).tier, 'base');
    assert.equal(resolveTier(TIERED, threshold).tier, 'base');
    assert.equal(resolveTier(TIERED, threshold + 1).tier, 'high');
    assert.equal(resolveTier(TIERED, threshold + 1).input, 4);
    assert.equal(resolveTier(TIERED, 0).threshold, threshold);
});

test('resolveTier keeps the same boundary semantics as the existing ratesFor helper', () => {
    for (const tokens of [0, 271_999, 272_000, 272_001, 1_000_000]) {
        assert.equal(resolveTier(TIERED, tokens).input, ratesFor(TIERED, tokens).input);
        assert.equal(resolveTier(TIERED, tokens).output, ratesFor(TIERED, tokens).output);
    }
});

test('date boundaries follow D-1 active, D active, D+1 expired', () => {
    const before = resolveRateSchedule(EXPIRING, { at: '2026-12-30' });
    assert.equal(before.status, 'active');
    assert.equal(before.daysRemaining, 1);
    assert.equal(before.warningLevel, '1-day');

    const onDate = resolveRateSchedule(EXPIRING, { at: '2026-12-31' });
    assert.equal(onDate.status, 'active');
    assert.equal(onDate.daysRemaining, 0);
    assert.equal(onDate.warningLevel, '1-day');

    const after = resolveRateSchedule(EXPIRING, { at: '2027-01-01' });
    assert.equal(after.status, 'expired');
    assert.equal(after.daysRemaining, -1);
    assert.equal(after.warningLevel, 'expired');
});

test('expiry warnings escalate through the 30/7/1 day thresholds', () => {
    assert.equal(resolveRateSchedule(EXPIRING, { at: '2026-11-01' }).warningLevel, null);
    assert.equal(resolveRateSchedule(EXPIRING, { at: '2026-12-05' }).warningLevel, '30-day');
    assert.equal(resolveRateSchedule(EXPIRING, { at: '2026-12-27' }).warningLevel, '7-day');
    assert.equal(resolveRateSchedule(EXPIRING, { at: '2026-12-31' }).warningLevel, '1-day');
});

test('a not-yet-effective rate is not treated as active', () => {
    const future = { ...EXPIRING, effectiveFrom: '2026-10-01', effectiveUntil: '2027-10-01' };
    assert.equal(resolveRateSchedule(future, { at: '2026-09-30' }).status, 'not-yet-effective');
    assert.equal(resolveRateSchedule(future, { at: '2026-10-01' }).status, 'active');
});

test('scenario totals scale per call, per day, and per month', () => {
    const scenario = computeCostScenario({
        entry: TIERED,
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        callsPerDay: 4,
        daysPerMonth: 30,
        at: '2026-08-25',
        pricingVerifiedAt: PRICING_AS_OF,
    });
    // 1M input tokens above the threshold uses the high tier: 4 USD + 0.5M output at 18 USD.
    assert.equal(scenario.appliedRate.tier, 'high');
    assert.equal(scenario.perCall.input.value, 4);
    assert.equal(scenario.perCall.output.value, 9);
    assert.equal(scenario.perCall.total.value, 13);
    assert.equal(scenario.perDay.total.value, 52);
    assert.equal(scenario.perMonth.total.value, 1560);
    assert.equal(scenario.currency, 'USD');
});

test('unpriced modifiers and tool charges are excluded with a reason, never zero', () => {
    const scenario = computeCostScenario({
        entry: TIERED,
        inputTokens: 100,
        at: '2026-08-25',
        pricingVerifiedAt: PRICING_AS_OF,
    });
    assert.equal(scenario.modifiers.longContext.available, true);
    assert.equal(scenario.modifiers.longContext.applied, false);

    for (const name of COST_MODIFIER_NAMES.filter((item) => item !== 'longContext')) {
        assert.equal(scenario.modifiers[name].available, false);
        assert.equal(scenario.modifiers[name].unavailableReason, 'catalog-has-no-rate');
        assert.equal(scenario.modifiers[name].value, undefined);
    }
    for (const name of COST_TOOL_CHARGE_NAMES) {
        assert.equal(scenario.toolCharges[name].available, false);
        assert.equal(scenario.toolCharges[name].unavailableReason, 'catalog-has-no-rate');
    }

    const excludedItems = scenario.excluded.map((item) => item.item);
    for (const name of COST_TOOL_CHARGE_NAMES) {
        assert.ok(excludedItems.includes(`toolCharge.${name}`));
    }
    assert.ok(excludedItems.includes('modality.nonText'));
    for (const item of scenario.excluded) assert.ok(item.reason);
});

test('an expired rate reports null costs instead of a confident number', () => {
    const scenario = computeCostScenario({
        entry: EXPIRING,
        inputTokens: 1_000_000,
        at: '2027-01-01',
        pricingVerifiedAt: PRICING_AS_OF,
    });
    assert.equal(scenario.schedule.status, 'expired');
    assert.equal(scenario.perCall.total.value, null);
    assert.equal(scenario.perMonth.total.value, null);
    assert.equal(scenario.perCall.total.evidence, EVIDENCE_GRADES.UNAVAILABLE);
    assert.ok(scenario.perCall.total.unavailableReason);
});

test('currency basis and exchange rates are declared, not assumed', () => {
    const scenario = computeCostScenario({
        entry: TIERED, inputTokens: 10, at: '2026-08-25', pricingVerifiedAt: PRICING_AS_OF,
    });
    assert.equal(scenario.currency, 'USD');
    assert.equal(scenario.currencyBasis.asOf, PRICING_AS_OF);
    assert.equal(scenario.currencyBasis.fx.available, false);
    assert.equal(scenario.countSemantics, PRICING_CATALOG.countSemantics);
});

test('pricing freshness moves from fresh to review-due to stale', () => {
    assert.equal(resolvePricingFreshness({ verifiedAt: '2026-08-24', at: '2026-08-25' }).status, 'fresh');
    assert.equal(resolvePricingFreshness({ verifiedAt: '2026-08-24', at: '2026-08-31' }).status, 'fresh');
    assert.equal(resolvePricingFreshness({ verifiedAt: '2026-08-24', at: '2026-09-01' }).status, 'review-due');
    assert.equal(resolvePricingFreshness({ verifiedAt: '2026-08-24', at: '2026-10-01' }).status, 'stale');
    assert.equal(resolvePricingFreshness({ verifiedAt: '2026-08-24', at: '2026-08-01' }).status, 'future-dated');
});

test('every catalog entry produces a scenario without throwing', () => {
    for (const entry of PRICING) {
        const scenario = computeCostScenario({
            entry, inputTokens: 12_345, outputTokens: 1_000,
            at: '2026-08-25', pricingVerifiedAt: PRICING_AS_OF,
        });
        assert.equal(scenario.provider, entry.provider);
        assert.equal(scenario.baseRate.input, entry.input);
        assert.ok(['active', 'expired', 'not-yet-effective'].includes(scenario.schedule.status));
    }
});

test('invalid dates and negative usage are rejected instead of coerced', () => {
    assert.throws(() => resolveRateSchedule(TIERED, { at: '2026-8-25' }), /YYYY-MM-DD/);
    assert.throws(() => resolveRateSchedule(TIERED, { at: '2026-02-30' }), /valid calendar date/);
    assert.throws(() => computeCostScenario({
        entry: TIERED, inputTokens: -1, at: '2026-08-25', pricingVerifiedAt: PRICING_AS_OF,
    }), /non-negative/);
    assert.throws(() => computeCostScenario({
        entry: TIERED, inputTokens: 1, callsPerDay: 0, at: '2026-08-25', pricingVerifiedAt: PRICING_AS_OF,
    }), /positive/);
});
