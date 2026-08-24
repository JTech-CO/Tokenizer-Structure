import test from 'node:test';
import assert from 'node:assert/strict';

import {
    benchmarkPresenterNotes,
    createReveal,
    isRevealed,
    learnPresenterNotes,
    resetReveal,
    revealAll,
    revealComplete,
    revealNext,
    revealPrevious,
} from '../js/presentation.js';
import { LESSONS } from '../js/lessons.js';
import { computeCellMetrics, createBenchmarkResult } from '../js/benchmarkDomain.js';
import { normalizeCorpus } from '../js/corpus.js';

test('reveal starts at the first step and never leaves the valid range', () => {
    let reveal = createReveal(3);
    assert.deepEqual(reveal, { total: 3, revealed: 1 });
    assert.equal(isRevealed(reveal, 0), true);
    assert.equal(isRevealed(reveal, 1), false);

    reveal = revealNext(reveal);
    assert.equal(reveal.revealed, 2);
    reveal = revealNext(revealNext(reveal));
    assert.equal(reveal.revealed, 3, 'must not advance past the last step');
    assert.equal(revealComplete(reveal), true);

    reveal = revealPrevious(revealPrevious(revealPrevious(reveal)));
    assert.equal(reveal.revealed, 1, 'must not fall below the first step');

    assert.equal(revealAll(reveal).revealed, 3);
    assert.deepEqual(resetReveal(revealAll(reveal)), { total: 3, revealed: 1 });
});

test('an empty deck is complete and reveals nothing', () => {
    const reveal = createReveal(0);
    assert.deepEqual(reveal, { total: 0, revealed: 0 });
    assert.equal(isRevealed(reveal, 0), false);
    assert.equal(revealComplete(reveal), true);
    assert.equal(revealNext(reveal).revealed, 0);
    assert.throws(() => createReveal(-1), /non-negative/);
    assert.throws(() => isRevealed(reveal, -1), /non-negative/);
});

test('learn presenter notes reuse reviewed lesson data instead of new copy', () => {
    const lesson = LESSONS[0];
    const notes = learnPresenterNotes(lesson, { locale: 'ko', stepIndex: 0 });

    assert.equal(notes.lessonId, lesson.id);
    assert.equal(notes.lessonVersion, lesson.lessonVersion);
    assert.equal(notes.reviewedAt, lesson.reviewedAt);
    assert.equal(notes.sourceUrl, lesson.sourceUrl);
    assert.ok(notes.notes.length >= 1 + lesson.quiz.length);

    const stepNote = notes.notes.find((item) => item.code === `step:${lesson.steps[0].id}`);
    assert.equal(stepNote.text, lesson.steps[0].copy.technical.ko);
    const quizNote = notes.notes.find((item) => item.code === `quiz:${lesson.quiz[0].id}`);
    assert.equal(quizNote.text, lesson.quiz[0].explanation.technical.ko);

    const english = learnPresenterNotes(lesson, { locale: 'en', stepIndex: 1 });
    assert.equal(
        english.notes.find((item) => item.code === `step:${lesson.steps[1].id}`).text,
        lesson.steps[1].copy.technical.en,
    );
    // 마지막 단계를 넘어서 요청해도 마지막 단계로 고정한다.
    const clamped = learnPresenterNotes(lesson, { stepIndex: 99 });
    assert.equal(clamped.notes[0].code, `step:${lesson.steps.at(-1).id}`);
});

test('benchmark presenter notes state the comparable subset and failures', () => {
    const corpus = normalizeCorpus({
        id: 'notes-corpus',
        name: 'Notes',
        samples: [
            { id: 's1', text: 'aaaa' },
            { id: 's2', text: 'bbbb' },
        ],
    });
    const metrics = computeCellMetrics({ tokens: 4, codePointLength: 4, utf8ByteLength: 4, contextWindow: 100 });
    const result = createBenchmarkResult({
        runId: 'benchmark-1',
        createdAt: '2026-08-25T00:00:00.000Z',
        corpus,
        options: {},
        columns: [
            { modelId: 'a', label: 'a', revision: 'r1', contextWindow: 100, status: 'ok' },
            { modelId: 'b', label: 'b', revision: 'r2', contextWindow: 100, status: 'failed', failure: { stage: 'load', code: 'tokenizer-load-failed' } },
        ],
        cells: [
            { sampleId: 's1', modelId: 'a', status: 'ok', metrics },
            { sampleId: 's2', modelId: 'a', status: 'ok', metrics },
            { sampleId: 's1', modelId: 'b', status: 'failed', failure: { stage: 'load', code: 'tokenizer-load-failed' } },
            { sampleId: 's2', modelId: 'b', status: 'failed', failure: { stage: 'load', code: 'tokenizer-load-failed' } },
        ],
    });

    const notes = benchmarkPresenterNotes(result);
    assert.equal(notes.runId, 'benchmark-1');
    assert.equal(notes.percentileMethod, 'nearest-rank');
    const codes = notes.notes.map((item) => item.code);
    assert.deepEqual(codes.slice(0, 2), ['failed-columns', 'comparable-subset']);
    assert.ok(codes.includes('small-sample-not-language-ranking'));
    assert.ok(codes.includes('token-count-is-not-quality'));
    assert.ok(notes.notes[0].text.includes('b'));
    assert.ok(notes.notes[1].text.includes('2 of 2'));
});
