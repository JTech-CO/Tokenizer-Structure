import test from 'node:test';
import assert from 'node:assert/strict';

import { byteLevelToText, displaySurfaces, labelByteContinuations } from '../js/byteDisplay.js';
import { createLatestRequest } from '../js/latestRequest.js';
import { i18n } from '../js/i18n.js';
import { PRICING, PRICING_AS_OF, costOf, ratesFor } from '../js/pricing.js';

function byteEncoder() {
    const bytes = [];
    for (let i = 33; i <= 126; i++) bytes.push(i);
    for (let i = 161; i <= 172; i++) bytes.push(i);
    for (let i = 174; i <= 255; i++) bytes.push(i);
    const codePoints = bytes.slice();
    let offset = 0;
    for (let byte = 0; byte < 256; byte++) {
        if (!bytes.includes(byte)) {
            bytes.push(byte);
            codePoints.push(256 + offset);
            offset += 1;
        }
    }
    return new Map(bytes.map((byte, index) => [byte, String.fromCharCode(codePoints[index])]));
}

test('latest request guard rejects stale async completions', () => {
    const requests = createLatestRequest();
    const first = requests.begin();
    const second = requests.begin();

    assert.equal(requests.isCurrent(first), false);
    assert.equal(requests.isCurrent(second), true);
});

test('byte-level surfaces stream a split UTF-8 character without replacement glyphs', () => {
    const encodeByte = byteEncoder();
    const raw = [...new TextEncoder().encode('🤗')].map((byte) => encodeByte.get(byte));
    const surfaces = displaySurfaces([raw.slice(0, 2).join(''), raw.slice(2).join('')], true);

    assert.deepEqual(surfaces, ['', '🤗']);
    assert.equal(surfaces.join('').includes('�'), false);
    assert.equal(byteLevelToText(raw.join('')), '🤗');
});

test('split UTF-8 continuation bytes receive a reversible hexadecimal label', () => {
    const encodeByte = byteEncoder();
    const raw = [...new TextEncoder().encode('🤗')].map((byte) => encodeByte.get(byte));
    const tokens = [raw.slice(0, 2).join(''), raw.slice(2).join('')];
    const surfaces = displaySurfaces(tokens, true);

    assert.deepEqual(labelByteContinuations(tokens, surfaces, true), ['[F0 9F]', '🤗']);
});

test('byte-level spaces and newlines use visible markers', () => {
    assert.deepEqual(displaySurfaces(['ĠHello', 'Ċ'], true), ['␣Hello', '⏎']);
});

test('byte-level decoding preserves literal marker-like Unicode input', () => {
    const encodeByte = byteEncoder();
    const literal = 'ĠĊ▁';
    const raw = [...new TextEncoder().encode(literal)].map((byte) => encodeByte.get(byte)).join('');

    assert.deepEqual(displaySurfaces([raw], true), [literal]);
});

test('tiered pricing changes only after the documented threshold', () => {
    const sol = PRICING.find((entry) => entry.id === 'gpt-5.6-sol');
    assert.ok(sol);

    assert.deepEqual(ratesFor(sol, 272_000), { input: 4, output: 20, tier: 'base' });
    assert.deepEqual(ratesFor(sol, 272_001), { input: 8, output: 30, tier: 'high' });

    const gpt55 = PRICING.find((entry) => entry.id === 'gpt-5.5');
    const gpt54 = PRICING.find((entry) => entry.id === 'gpt-5.4');
    assert.deepEqual(ratesFor(gpt55, 272_001), { input: 10, output: 45, tier: 'high' });
    assert.deepEqual(ratesFor(gpt54, 272_001), { input: 5, output: 22.5, tier: 'high' });
});

test('reference costs use the rate for their own token count', () => {
    const sol = PRICING.find((entry) => entry.id === 'gpt-5.6-sol');
    assert.equal(costOf(ratesFor(sol, 1_000).input, 1_000), 0.004);
    assert.equal(costOf(ratesFor(sol, 100_000).input, 100_000), 0.4);
    assert.equal(costOf(ratesFor(sol, 300_000).input, 300_000), 2.4);
});

test('pricing catalog has unique valid entries and a current basis date', () => {
    assert.equal(PRICING_AS_OF, '2026-08-24');
    assert.equal(new Set(PRICING.map((entry) => entry.id)).size, PRICING.length);
    for (const entry of PRICING) {
        assert.ok(entry.provider);
        assert.ok(entry.name);
        assert.ok(entry.input >= 0);
        assert.ok(entry.output >= 0);
        assert.ok(entry.context > 0);
    }
});

test('Korean and English UI catalogs expose the same keys', () => {
    assert.deepEqual(Object.keys(i18n.ko).sort(), Object.keys(i18n.en).sort());
});

test('pricing lifecycle metadata identifies the documented Gemini replacement', () => {
    const flashLite = PRICING.find((entry) => entry.id === 'gemini-3.1-flash-lite');
    assert.equal(flashLite.sunsetEarliest, '2027-05-07');
    assert.equal(flashLite.replacement, 'gemini-3.5-flash-lite');
});
