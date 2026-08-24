import test from 'node:test';
import assert from 'node:assert/strict';

import {
    LESSONS,
    LESSON_GLOSSARY,
    LESSON_LEVELS,
    LESSON_LOCALES,
    LESSON_REVIEWED_AT,
    LESSON_SCHEMA_VERSION,
    LESSON_STEP_ORDER,
    answerLessonQuestion,
    completeLessonStep,
    createLessonProgress,
    formatLessonNarrative,
    scoreLessonQuiz,
    selectLesson,
    summarizeLessonProgress,
    validateLessonCatalog,
} from '../js/lessons.js';

const EXPECTED_IDS = [
    'token-not-word',
    'korean-emoji-utf8',
    'same-text-different-tokenizers',
];

test('P1 Learn catalog is valid, versioned, immutable, and JSON-safe', () => {
    assert.deepEqual(validateLessonCatalog(), { valid: true, errors: [] });
    assert.deepEqual(LESSONS.map(({ id }) => id), EXPECTED_IDS);
    assert.equal(LESSON_SCHEMA_VERSION, '1.0.0');
    assert.equal(LESSON_REVIEWED_AT, '2026-08-24');
    assert.deepEqual(LESSON_LOCALES, ['ko', 'en']);
    assert.deepEqual(LESSON_LEVELS, ['beginner', 'technical']);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify({ lessons: LESSONS, glossary: LESSON_GLOSSARY })));
    assert.ok(Object.isFrozen(LESSONS));
    assert.ok(Object.isFrozen(LESSONS[0].steps[0].copy.beginner));
    assert.ok(Object.isFrozen(LESSON_GLOSSARY[0].definition.technical));
});

test('every five-minute path follows the six-stage learning loop and has four questions', () => {
    for (const lesson of LESSONS) {
        assert.equal(lesson.schemaVersion, LESSON_SCHEMA_VERSION);
        assert.equal(lesson.durationMinutes, 5);
        assert.equal(lesson.reviewedAt, LESSON_REVIEWED_AT);
        assert.match(lesson.lessonVersion, /^\d+\.\d+\.\d+$/);
        assert.equal(new URL(lesson.sourceUrl).protocol, 'https:');
        assert.deepEqual(lesson.steps.map(({ id }) => id), LESSON_STEP_ORDER);
        assert.equal(lesson.quiz.length, 4);
        assert.equal(new Set(lesson.quiz.map(({ id }) => id)).size, 4);
        assert.equal(lesson.enginePolicy.realAllowed, true);
        assert.equal(lesson.enginePolicy.fallbackDisclosureRequired, true);
    }
});

test('real and fallback policy prevents heuristic comparison claims', () => {
    const illustrativeLessons = LESSONS.slice(0, 2);
    for (const lesson of illustrativeLessons) {
        assert.equal(lesson.enginePolicy.realRequired, false);
        assert.equal(lesson.enginePolicy.fallbackAllowed, true);
    }

    const comparison = LESSONS[2];
    assert.equal(comparison.enginePolicy.realRequired, true);
    assert.equal(comparison.enginePolicy.fallbackAllowed, false);
    assert.equal(comparison.enginePolicy.fallbackUse, 'forbidden-for-comparison');
});

test('locale and explanation-level selection returns a detached UI projection', () => {
    const beginnerKo = selectLesson('token-not-word');
    const technicalEn = selectLesson('token-not-word', { locale: 'en', level: 'technical' });

    assert.equal(beginnerKo.title, '토큰은 단어가 아니다');
    assert.match(beginnerKo.steps[0].copy, /단어 수/);
    assert.equal(technicalEn.title, 'A token is not a word');
    assert.match(technicalEn.steps[0].copy, /linguistic word boundaries/);
    assert.deepEqual(beginnerKo.steps.map(({ id }) => id), LESSON_STEP_ORDER);
    assert.deepEqual(
        beginnerKo.glossary.map(({ id }) => id),
        LESSONS[0].glossaryTermIds
    );

    beginnerKo.sample.input = 'changed only in projection';
    beginnerKo.enginePolicy.fallbackAllowed = false;
    assert.equal(LESSONS[0].sample.input, 'unbelievable! 안녕');
    assert.equal(LESSONS[0].enginePolicy.fallbackAllowed, true);

    assert.throws(() => selectLesson('missing'), /Unknown lesson/);
    assert.throws(() => selectLesson('token-not-word', { locale: 'ja' }), /locale must be one of/);
    assert.throws(() => selectLesson('token-not-word', { level: 'expert' }), /level must be one of/);
});

test('narrative formatter reports counts in prose and preserves absent placeholders', () => {
    assert.equal(
        formatLessonNarrative('token-not-word', { wordCount: 2, tokenCount: 5 }),
        '이 입력에는 단어가 2개 있지만 토큰은 5개입니다.'
    );
    assert.equal(
        formatLessonNarrative(
            'same-text-different-tokenizers',
            { artifactA: 'A', tokenCountA: 4, artifactB: 'B', tokenCountB: 6, delta: 2 },
            { locale: 'en', level: 'technical' }
        ),
        'For the same request: A encoding length=4, B encoding length=6, delta=2.'
    );
    assert.match(
        formatLessonNarrative('korean-emoji-utf8', { codePoints: 7 }),
        /\{graphemes\}.*7.*\{utf8Bytes\}/
    );
    assert.throws(() => formatLessonNarrative('token-not-word', null), /values must be an object/);
});

test('lesson progress is sequential, immutable, and reports the next stage', () => {
    const initial = createLessonProgress('korean-emoji-utf8');
    assert.deepEqual(initial.completedStepIds, []);
    assert.throws(() => completeLessonStep(initial, 'interact'), /Complete goal before interact/);

    let progress = initial;
    for (const stepId of LESSON_STEP_ORDER) progress = completeLessonStep(progress, stepId);

    assert.deepEqual(initial.completedStepIds, []);
    assert.notStrictEqual(progress.completedStepIds, initial.completedStepIds);
    assert.deepEqual(summarizeLessonProgress(progress), {
        completedSteps: 6,
        totalSteps: 6,
        percent: 100,
        nextStepId: null,
        lessonComplete: true,
        quiz: {
            total: 4,
            answered: 0,
            correct: 0,
            percent: 0,
            passed: false,
            correctQuestionIds: [],
            incorrectQuestionIds: [],
            unansweredQuestionIds: ['q1', 'q2', 'q3', 'q4'],
        },
    });

    const duplicate = completeLessonStep(progress, 'goal');
    assert.deepEqual(duplicate, progress);
    assert.notStrictEqual(duplicate.completedStepIds, progress.completedStepIds);
});

test('quiz answer recording and three-of-four scoring are deterministic', () => {
    const lesson = LESSONS[0];
    let progress = createLessonProgress(lesson);
    progress = answerLessonQuestion(progress, 'q1', 'b');
    progress = answerLessonQuestion(progress, 'q2', 'c');
    progress = answerLessonQuestion(progress, 'q3', 'b');
    progress = answerLessonQuestion(progress, 'q4', 'a');

    assert.deepEqual(scoreLessonQuiz(lesson, progress.answers), {
        total: 4,
        answered: 4,
        correct: 3,
        percent: 75,
        passed: true,
        correctQuestionIds: ['q1', 'q2', 'q3'],
        incorrectQuestionIds: ['q4'],
        unansweredQuestionIds: [],
    });
    assert.deepEqual(createLessonProgress(lesson).answers, {});
    assert.throws(() => answerLessonQuestion(progress, 'q5', 'a'), /Unknown quiz question/);
    assert.throws(() => answerLessonQuestion(progress, 'q1', 'z'), /Unknown option/);
    assert.throws(() => scoreLessonQuiz(lesson, []), /answers must be an object/);
});

test('catalog validation returns actionable errors for malformed author data', () => {
    const malformed = JSON.parse(JSON.stringify(LESSONS));
    malformed[0].sourceUrl = 'not a URL';
    malformed[0].steps.reverse();
    malformed[0].quiz[0].correctOptionId = 'missing';
    malformed[0].glossaryTermIds.push('missing-term');
    malformed[1].durationMinutes = 10;
    malformed[2].enginePolicy.realAllowed = false;

    const result = validateLessonCatalog(malformed, JSON.parse(JSON.stringify(LESSON_GLOSSARY)));
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /sourceUrl must be a valid URL/);
    assert.match(result.errors.join('\n'), /steps must follow the required order/);
    assert.match(result.errors.join('\n'), /correctOptionId must reference an option/);
    assert.match(result.errors.join('\n'), /unknown term: missing-term/);
    assert.match(result.errors.join('\n'), /durationMinutes must be 5/);
    assert.match(result.errors.join('\n'), /cannot require a disallowed real engine/);
});
