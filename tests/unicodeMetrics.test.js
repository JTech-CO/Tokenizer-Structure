import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { measureText, normalizationSnapshot } from '../js/unicodeMetrics.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(resolve(root, 'tests', 'fixtures', 'unicode-golden.json'), 'utf8'));

test('Unicode golden fixture keeps all text units independent', () => {
    for (const entry of fixture.cases) {
        const actual = measureText(entry.input);
        assert.equal(actual.utf16CodeUnits, entry.metrics.utf16CodeUnits, entry.id);
        assert.equal(actual.codePoints, entry.metrics.codePoints, entry.id);
        assert.equal(actual.graphemes, entry.metrics.graphemes, entry.id);
        assert.equal(actual.utf8Bytes, entry.metrics.utf8Bytes, entry.id);
        assert.equal(normalizationSnapshot(entry.input).NFC, entry.nfc, entry.id);
    }
});

test('grapheme count is explicitly unavailable without Intl.Segmenter', () => {
    const metrics = measureText('👩🏽‍💻', undefined);
    if (typeof Intl.Segmenter === 'function') {
        assert.equal(metrics.graphemes, 1);
        assert.equal(metrics.graphemesUnavailableReason, null);
    }

    const unavailable = measureText('👩🏽‍💻', null);
    assert.equal(unavailable.graphemes, null);
    assert.equal(unavailable.graphemesUnavailableReason, 'intl-segmenter-unavailable');
});

test('Unicode metrics reject non-string input instead of coercing it', () => {
    assert.throws(() => measureText(null), /must be a string/);
    assert.throws(() => normalizationSnapshot(42), /must be a string/);
});
