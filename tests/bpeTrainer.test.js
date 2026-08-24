import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BPE_LIMITS,
    BPE_REJECTIONS,
    BPE_STOP_REASONS,
    BPE_TRAINING_SCHEMA_VERSION,
    buildWordFrequencies,
    compareMergeCounts,
    encodeWithMerges,
    estimateTrainingScale,
    normalizeBpeOptions,
    replayState,
    trainBpe,
} from '../js/bpeTrainer.js';

// Sennrich 예제와 같은 구조의 최소 말뭉치.
const CORPUS = ['low', 'low', 'low', 'low', 'low',
    'lower', 'lower',
    'newest', 'newest', 'newest', 'newest', 'newest', 'newest',
    'widest', 'widest', 'widest'].join(' ');

test('word frequencies are sorted deterministically, not by insertion order', () => {
    const options = normalizeBpeOptions({});
    const words = buildWordFrequencies(CORPUS, options);
    assert.deepEqual(words, [
        { word: 'newest', frequency: 6 },
        { word: 'low', frequency: 5 },
        { word: 'widest', frequency: 3 },
        { word: 'lower', frequency: 2 },
    ]);

    // 같은 빈도는 사전순으로 확정한다.
    const tied = buildWordFrequencies('b a b a c c', options);
    assert.deepEqual(tied.map((entry) => entry.word), ['a', 'b', 'c']);
});

test('training learns the expected first merges from a known corpus', () => {
    const training = trainBpe(CORPUS, { numMerges: 4 });
    assert.equal(training.schemaVersion, BPE_TRAINING_SCHEMA_VERSION);
    assert.equal(training.steps.length, 4);

    // e+s가 9회(newest 6 + widest 3)로 가장 흔하다.
    assert.deepEqual(training.steps[0].pair, ['e', 's']);
    assert.equal(training.steps[0].count, 9);
    assert.equal(training.steps[0].newToken, 'es');
    assert.equal(training.steps[0].affectedWords, 2);

    assert.deepEqual(training.steps[1].pair, ['es', 't']);
    assert.equal(training.steps[1].count, 9);
    assert.deepEqual(training.steps[2].pair, ['est', '</w>']);
    assert.equal(training.steps[2].count, 9);

    assert.deepEqual(training.merges[0], ['e', 's']);
    assert.ok(training.vocab.includes('est</w>'));
    assert.equal(training.stoppedReason, BPE_STOP_REASONS.REACHED_TARGET);
});

test('the same corpus always produces the same merge order', () => {
    const first = trainBpe(CORPUS, { numMerges: 10 });
    const shuffled = CORPUS.split(' ').reverse().join(' ');
    const second = trainBpe(shuffled, { numMerges: 10 });
    assert.deepEqual(first.merges, second.merges, 'word order must not change the result');
    assert.deepEqual(
        first.steps.map((step) => [step.pair, step.count]),
        second.steps.map((step) => [step.pair, step.count]),
    );
});

test('ties are broken lexicographically so runs stay reproducible', () => {
    // 후보 네 쌍(a+b, b+</w>, c+d, d+</w>)이 모두 2회로 동점이다.
    const training = trainBpe('ab ab cd cd', { numMerges: 3 });
    assert.deepEqual(training.steps[0].pair, ['a', 'b'], 'lexicographically smallest wins the tie');
    // 병합 뒤 후보는 ab+</w>, c+d, d+</w>이고 여전히 사전순으로 정해진다.
    assert.deepEqual(training.steps[1].pair, ['ab', '</w>']);
    assert.deepEqual(training.steps[2].pair, ['c', 'd']);
    assert.deepEqual(trainBpe('cd cd ab ab', { numMerges: 3 }).merges, training.merges);
});

test('training stops with a stated reason instead of spinning', () => {
    const exhausted = trainBpe(CORPUS, { numMerges: BPE_LIMITS.maxMerges });
    assert.equal(exhausted.stoppedReason, BPE_STOP_REASONS.NO_PAIRS_LEFT);
    assert.ok(exhausted.steps.length < BPE_LIMITS.maxMerges);
    // 마지막 단계까지 빈도가 2 이상이어야 한다.
    assert.ok(exhausted.steps.every((step) => step.count >= 2));

    const none = trainBpe(CORPUS, { numMerges: 0 });
    assert.deepEqual(none.steps, []);
    assert.deepEqual(none.vocab, none.initialVocab);
});

test('every step records the candidate frequencies it chose from', () => {
    const training = trainBpe(CORPUS, { numMerges: 3, topPairsPerStep: 4 });
    for (const step of training.steps) {
        assert.ok(step.topPairs.length > 0 && step.topPairs.length <= 4);
        assert.deepEqual(step.topPairs[0].pair, step.pair, 'the chosen pair must be the top candidate');
        assert.equal(step.topPairs[0].count, step.count);
        // 후보는 빈도 내림차순이어야 한다.
        for (let i = 1; i < step.topPairs.length; i += 1) {
            assert.ok(step.topPairs[i - 1].count >= step.topPairs[i].count);
        }
    }
});

test('replay reproduces the state at any step without retraining', () => {
    const training = trainBpe(CORPUS, { numMerges: 6 });

    const start = replayState(training, 0);
    assert.equal(start.vocabSize, training.initialVocab.length);
    assert.deepEqual(start.words.find((entry) => entry.word === 'newest').symbols,
        ['n', 'e', 'w', 'e', 's', 't', '</w>']);

    const third = replayState(training, 3);
    assert.deepEqual(third.words.find((entry) => entry.word === 'newest').symbols,
        ['n', 'e', 'w', 'est</w>']);
    assert.equal(third.vocabSize, training.initialVocab.length + 3);

    const end = replayState(training, training.merges.length);
    assert.deepEqual(end.vocab, training.vocab);
    // 병합이 진행될수록 전체 심볼 수는 줄어들기만 한다.
    assert.ok(end.totalSymbols < start.totalSymbols);
    assert.ok(third.totalSymbols < start.totalSymbols);

    assert.throws(() => replayState(training, -1), RangeError);
    assert.throws(() => replayState(training, training.merges.length + 1), RangeError);
});

test('the learned merges encode an unseen word the same way', () => {
    const training = trainBpe(CORPUS, { numMerges: 6 });
    const encoded = encodeWithMerges('lowest', training.merges);
    assert.deepEqual(encoded.symbols, ['low', 'est</w>']);
    assert.ok(encoded.applied.length > 0);

    // 학습 말뭉치에 있던 단어는 replay 상태와 정확히 일치해야 한다.
    const end = replayState(training, training.merges.length);
    for (const entry of end.words) {
        assert.deepEqual(
            encodeWithMerges(entry.word, training.merges).symbols,
            entry.symbols,
            `${entry.word} must encode to its trained split`,
        );
    }
    assert.deepEqual(encodeWithMerges('', training.merges).symbols, []);
});

test('more merges never produce more tokens for the same word', () => {
    const training = trainBpe(CORPUS, { numMerges: 8 });
    const compared = compareMergeCounts(training, 'newest', [0, 2, 4, training.merges.length]);

    assert.equal(compared[0].tokens, 7);
    for (let i = 1; i < compared.length; i += 1) {
        assert.ok(compared[i].tokens <= compared[i - 1].tokens, 'token count must not grow with vocab');
        assert.ok(compared[i].vocabSize > compared[i - 1].vocabSize);
    }
    assert.throws(() => compareMergeCounts(training, 'x', [999]), RangeError);
});

test('special tokens enter the vocabulary without being merged away', () => {
    const training = trainBpe(CORPUS, { numMerges: 5, specialTokens: ['[PAD]', '[UNK]'] });
    assert.ok(training.initialVocab.includes('[PAD]'));
    assert.ok(training.vocab.includes('[UNK]'));
    // 특수 토큰은 말뭉치에 없으므로 어떤 merge에도 등장하지 않는다.
    assert.ok(training.merges.every(([left, right]) => ![left, right].some((s) => s.startsWith('['))));
    assert.throws(() => trainBpe(CORPUS, { specialTokens: ['[PAD]', '[PAD]'] }), /must not repeat/);
});

test('lowercasing changes the corpus before training, not after', () => {
    const mixed = 'Low low LOW';
    assert.equal(buildWordFrequencies(mixed, normalizeBpeOptions({})).length, 3);
    assert.deepEqual(
        buildWordFrequencies(mixed, normalizeBpeOptions({ lowercase: true })),
        [{ word: 'low', frequency: 3 }],
    );
});

test('inputs beyond the stated limits are refused, never silently truncated', () => {
    assert.throws(() => trainBpe('   '), (error) => error.code === BPE_REJECTIONS.EMPTY_CORPUS);
    assert.throws(
        () => trainBpe('x'.repeat(BPE_LIMITS.maxCorpusCodePoints + 1)),
        (error) => error.code === BPE_REJECTIONS.CORPUS_TOO_LARGE,
    );
    assert.throws(
        () => trainBpe(Array.from({ length: BPE_LIMITS.maxUniqueWords + 1 }, (_, i) => `w${i}`).join(' ')),
        (error) => error.code === BPE_REJECTIONS.TOO_MANY_WORDS,
    );
    assert.throws(
        () => trainBpe(`a ${'b'.repeat(BPE_LIMITS.maxSymbolsPerWord)}`),
        (error) => error.code === BPE_REJECTIONS.WORD_TOO_LONG,
    );
    assert.throws(
        () => trainBpe(CORPUS, { numMerges: BPE_LIMITS.maxMerges + 1 }),
        (error) => error.code === BPE_REJECTIONS.TOO_MANY_MERGES,
    );
    assert.throws(() => normalizeBpeOptions({ unknown: 1 }), /unknown field/);
    assert.throws(() => normalizeBpeOptions({ numMerges: -1 }), /non-negative/);
});

test('the scale of a run is knowable before it starts', () => {
    const scale = estimateTrainingScale(CORPUS, { numMerges: 10 });
    assert.equal(scale.uniqueWords, 4);
    assert.equal(scale.totalWords, 16);
    assert.equal(scale.initialSymbols, 4 + 6 + 7 + 7);
    assert.equal(scale.estimatedPairScans, 10 * scale.initialSymbols);
    assert.equal(scale.limits.maxMerges, BPE_LIMITS.maxMerges);
});
