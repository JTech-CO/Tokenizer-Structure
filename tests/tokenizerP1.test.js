import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenizeHeuristic, tokenizeReal } from '../js/tokenizer.js';

function fakeTokenizer() {
    const calls = [];
    const tokenizer = (text, options) => {
        calls.push({ text, options: { ...options }, paddingSide: tokenizer.padding_side });
        const ids = options.add_special_tokens ? [101, 7, 102] : [7];
        while (options.padding === 'max_length' && ids.length < options.max_length) ids.push(0);
        if (options.truncation && options.max_length) ids.splice(options.max_length);
        return {
            input_ids: ids,
            attention_mask: ids.map((id) => id === 0 ? 0 : 1),
            token_type_ids: ids.map(() => 0),
        };
    };
    tokenizer.__modelId = 'fixture/tokenizer';
    tokenizer.__revision = '0123456789abcdef0123456789abcdef01234567';
    tokenizer.padding_side = 'right';
    tokenizer.all_special_ids = [0, 101, 102];
    tokenizer.unk_token = '[UNK]';
    tokenizer.normalizer = { normalize: (text) => text.normalize('NFC') };
    tokenizer.pre_tokenizer = { pre_tokenize_text: (text) => [text] };
    const model = () => ['hello'];
    model.convert_ids_to_tokens = (ids) => ids.map((id) => ({ 0: '[PAD]', 7: 'hello', 101: '[CLS]', 102: '[SEP]' }[id]));
    tokenizer.model = model;
    tokenizer.decode = (ids, options) => ids
        .filter((id) => id === 7 || (!options.skip_special_tokens && id !== 0))
        .map((id) => ({ 7: 'hello', 101: '[CLS]', 102: '[SEP]' }[id] || ''))
        .join('');
    tokenizer.calls = calls;
    return tokenizer;
}

test('real adapter applies canonical pair/padding/truncation options and restores padding side', () => {
    const tokenizer = fakeTokenizer();
    const result = tokenizeReal(tokenizer, 'hello', {
        textPair: 'pair',
        padding: 'max-length',
        paddingSide: 'left',
        truncation: true,
        maxLength: 5,
    });

    assert.equal(tokenizer.padding_side, 'right');
    assert.equal(tokenizer.calls.length, 1);
    assert.deepEqual(tokenizer.calls[0], {
        text: 'hello',
        paddingSide: 'left',
        options: {
            add_special_tokens: true,
            text_pair: 'pair',
            padding: 'max_length',
            truncation: true,
            max_length: 5,
            return_tensor: false,
            return_token_type_ids: true,
        },
    });
    assert.equal(result.schemaVersion, 2);
    assert.deepEqual(result.encoding.attentionMask, [1, 1, 1, 0, 0]);
    assert.deepEqual(result.encoding.specialTokenMask, [1, 0, 1, 1, 1]);
    assert.equal(result.encoding.paddingSide, 'left');
    assert.equal(result.roundTrip.unavailableReason, null);
});

test('heuristic adapter preserves canonical options without claiming unsupported runtime details', () => {
    const result = tokenizeHeuristic('hello', null, null, { addSpecialTokens: false });

    assert.equal(result.finalTokens.includes('<|begin_of_text|>'), false);
    assert.equal(result.options.addSpecialTokens, false);
    assert.equal(result.roundTrip.classification, 'unavailable');
    assert.equal(result.encoding.availability.originalOffsets.available, false);
});
