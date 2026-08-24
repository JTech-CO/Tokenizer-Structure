import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_ANALYSIS_OPTIONS,
    normalizeAnalysisOptions,
    optionsEqual,
    toTokenizerCallOptions,
} from '../js/analysisOptions.js';

test('analysis options normalize to one canonical P1 shape', () => {
    assert.deepEqual(normalizeAnalysisOptions(), DEFAULT_ANALYSIS_OPTIONS);
    assert.deepEqual(normalizeAnalysisOptions({
        addSpecialTokens: false,
        textPair: 'pair',
        padding: 'max-length',
        paddingSide: 'left',
        truncation: true,
        maxLength: 32,
    }), {
        addSpecialTokens: false,
        textPair: 'pair',
        padding: 'max-length',
        paddingSide: 'left',
        truncation: true,
        maxLength: 32,
        stride: 0,
    });
});

test('runtime option mapping uses the documented Transformers.js v3 names', () => {
    assert.deepEqual(toTokenizerCallOptions({
        textPair: 'B',
        padding: 'max-length',
        truncation: true,
        maxLength: 12,
    }), {
        add_special_tokens: true,
        text_pair: 'B',
        padding: 'max_length',
        truncation: true,
        max_length: 12,
        return_tensor: false,
        return_token_type_ids: true,
    });
});

test('unsafe, ambiguous, or unsupported options fail before runtime', () => {
    assert.throws(() => normalizeAnalysisOptions({ padding: 'max-length' }), /maxLength/);
    assert.throws(() => normalizeAnalysisOptions({ maxLength: 0 }), /1 to 8192/);
    assert.throws(() => normalizeAnalysisOptions({ stride: 1 }), /do not expose overflow stride/);
    assert.throws(() => normalizeAnalysisOptions({ add_special_tokens: true }), /unknown field/);
});

test('canonical option equality ignores omitted defaults', () => {
    assert.equal(optionsEqual({}, { addSpecialTokens: true, stride: 0 }), true);
    assert.equal(optionsEqual({}, { addSpecialTokens: false }), false);
});
