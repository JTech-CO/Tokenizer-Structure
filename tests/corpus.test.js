import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BUILTIN_CORPORA,
    CORPUS_LIMITS,
    CORPUS_SCHEMA_VERSION,
    corpusDomains,
    corpusLanguages,
    filterCorpus,
    findCorpus,
    normalizeCorpus,
    normalizeCorpusSample,
    parseCorpusLines,
} from '../js/corpus.js';

test('built-in corpora are valid, uniquely identified, and tagged', () => {
    assert.ok(BUILTIN_CORPORA.length >= 2);
    const ids = new Set();
    for (const corpus of BUILTIN_CORPORA) {
        assert.equal(corpus.schemaVersion, CORPUS_SCHEMA_VERSION);
        assert.equal(corpus.source, 'builtin');
        assert.ok(!ids.has(corpus.id), `duplicate corpus id: ${corpus.id}`);
        ids.add(corpus.id);
        for (const sample of corpus.samples) {
            assert.ok(sample.codePointLength > 0);
            assert.ok(sample.utf8ByteLength >= sample.codePointLength);
            assert.match(sample.language, /^(?:[a-z]{2,3}|und)$/);
            assert.match(sample.domain, /^[a-z][a-z0-9-]*$/);
        }
    }
    assert.ok(findCorpus('language-mix'));
    assert.equal(findCorpus('missing'), null);
});

test('sample normalization computes Unicode metrics and rejects bad tags', () => {
    const sample = normalizeCorpusSample({ id: 'a1', text: '한글 A🤗', language: 'ko', domain: 'prose' });
    // 한(3) + 글(3) + 공백(1) + A(1) + 🤗(4) = 5 code points / 12 UTF-8 bytes
    assert.equal(sample.codePointLength, 5);
    assert.equal(sample.utf8ByteLength, 12);

    assert.throws(() => normalizeCorpusSample({ id: 'A1', text: 'x' }), /id/);
    assert.throws(() => normalizeCorpusSample({ id: 'a1', text: '   ' }), /text/);
    assert.throws(() => normalizeCorpusSample({ id: 'a1', text: 'x', language: 'Korean' }), /language/);
    assert.throws(() => normalizeCorpusSample({ id: 'a1', text: 'x', domain: 'Prose' }), /domain/);
    assert.throws(() => normalizeCorpusSample({ id: 'a1', text: 'x', extra: 1 }), /unknown field/);
    assert.throws(
        () => normalizeCorpusSample({ id: 'a1', text: 'x'.repeat(CORPUS_LIMITS.maxTextCodePoints + 1) }),
        /code points/,
    );
});

test('corpus normalization rejects duplicates and oversized collections', () => {
    const build = (count) => ({
        id: 'c1',
        name: 'c',
        samples: Array.from({ length: count }, (_, index) => ({ id: `s${index}`, text: 'x' })),
    });
    assert.equal(normalizeCorpus(build(3)).samples.length, 3);
    assert.throws(() => normalizeCorpus(build(0)), /at least one sample/);
    assert.throws(() => normalizeCorpus(build(CORPUS_LIMITS.maxSamples + 1)), /samples/);
    assert.throws(() => normalizeCorpus({
        id: 'c1', name: 'c', samples: [{ id: 'dup', text: 'a' }, { id: 'dup', text: 'b' }],
    }), /duplicate sample id/);
    assert.throws(() => normalizeCorpus({
        id: 'c1',
        name: 'c',
        samples: Array.from({ length: 40 }, (_, index) => ({
            id: `s${index}`,
            text: 'x'.repeat(CORPUS_LIMITS.maxTextCodePoints),
        })),
    }), /total text/);
});

test('user lines become samples with optional inline tags', () => {
    const corpus = parseCorpusLines(
        '[ko,prose] 안녕하세요\n\n[und,code] const a = 1;\nplain line\n[,chat] tagged domain only',
        { defaultLanguage: 'en', defaultDomain: 'prose' },
    );
    assert.equal(corpus.source, 'user');
    assert.deepEqual(
        corpus.samples.map((item) => [item.language, item.domain, item.text]),
        [
            ['ko', 'prose', '안녕하세요'],
            ['und', 'code', 'const a = 1;'],
            ['en', 'prose', 'plain line'],
            ['en', 'chat', 'tagged domain only'],
        ],
    );
    // 줄 번호를 id로 쓰므로 빈 줄을 건너뛰어도 id가 겹치지 않는다.
    assert.equal(new Set(corpus.samples.map((item) => item.id)).size, corpus.samples.length);
});

test('user lines reject empty input and tag-only lines', () => {
    assert.throws(() => parseCorpusLines('   \n\n'), /at least one non-empty line/);
    assert.throws(() => parseCorpusLines('[ko,prose]   '), /has tags but no text/);
    assert.throws(() => parseCorpusLines('[Korean,prose] x'), /language/);
});

test('filters narrow by language and domain without mutating the source corpus', () => {
    const corpus = findCorpus('domain-mix');
    assert.ok(corpusLanguages(corpus).includes('und'));
    assert.ok(corpusDomains(corpus).includes('code'));

    const codeOnly = filterCorpus(corpus, { domains: ['code'] });
    assert.ok(codeOnly.samples.length > 0);
    assert.ok(codeOnly.samples.every((item) => item.domain === 'code'));
    assert.equal(corpus.samples.length > codeOnly.samples.length, true);

    const none = filterCorpus(corpus, { domains: ['nonexistent'] });
    assert.equal(none.samples.length, 0);
});
