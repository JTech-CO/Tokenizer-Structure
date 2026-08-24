import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PRICING,
    PRICING_AS_OF,
    PRICING_CATALOG,
    PRICING_SOURCES,
} from '../js/pricing.js';

test('provider pricing metadata stays separate from tokenizer artifacts', () => {
    assert.equal(PRICING_CATALOG.schemaVersion, '1.0.0');
    assert.equal(PRICING_CATALOG.kind, 'provider-pricing');
    assert.equal(PRICING_CATALOG.verifiedAt, PRICING_AS_OF);
    assert.equal(PRICING_CATALOG.countSemantics, 'rate-only-no-tokenizer-equivalence');
    assert.deepEqual(Object.keys(PRICING_SOURCES).sort(), ['Anthropic', 'Google', 'OpenAI']);

    for (const provider of Object.keys(PRICING_SOURCES)) {
        const source = PRICING_SOURCES[provider];
        assert.match(source.url, /^https:\/\//);
        assert.equal(source.verifiedAt, PRICING_AS_OF);
        assert.ok(PRICING.some((entry) => entry.provider === provider));
    }
});
