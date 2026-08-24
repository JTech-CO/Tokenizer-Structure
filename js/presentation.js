// presentation.js — P3 발표 모드의 순수 로직.
// 단계별 reveal 상태와 발표자 메모를 만들고, 메모는 이미 검토된 데이터에서만 끌어온다.
import { benchmarkCaveats, summarizeBenchmark } from './benchmarkDomain.js';

export const PRESENTATION_SURFACES = Object.freeze(['learn', 'benchmark']);

function fail(path, message) {
    throw new TypeError(path + ': ' + message);
}

export function createReveal(total) {
    if (!Number.isSafeInteger(total) || total < 0) fail('total', 'expected a non-negative safe integer');
    return { total, revealed: total === 0 ? 0 : 1 };
}

function clampReveal(reveal, revealed) {
    return { total: reveal.total, revealed: Math.min(reveal.total, Math.max(reveal.total === 0 ? 0 : 1, revealed)) };
}

export function revealNext(reveal) {
    return clampReveal(reveal, reveal.revealed + 1);
}

export function revealPrevious(reveal) {
    return clampReveal(reveal, reveal.revealed - 1);
}

export function revealAll(reveal) {
    return clampReveal(reveal, reveal.total);
}

export function resetReveal(reveal) {
    return createReveal(reveal.total);
}

export function isRevealed(reveal, index) {
    if (!Number.isSafeInteger(index) || index < 0) fail('index', 'expected a non-negative safe integer');
    return index < reveal.revealed;
}

export function revealComplete(reveal) {
    return reveal.total === 0 || reveal.revealed >= reveal.total;
}

/**
 * 학습 경로의 발표자 메모. 새 문구를 만들지 않고 lesson 데이터의 기술 수준 설명과
 * 오개념 해설만 사용하므로 lessonVersion과 검토일이 그대로 근거가 된다.
 */
export function learnPresenterNotes(lesson, { locale = 'ko', stepIndex = 0 } = {}) {
    if (!lesson || !Array.isArray(lesson.steps)) fail('lesson', 'expected a lesson with steps');
    if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) fail('stepIndex', 'expected a non-negative safe integer');

    const step = lesson.steps[Math.min(stepIndex, lesson.steps.length - 1)];
    const notes = [];
    if (step) {
        notes.push({
            code: `step:${step.id}`,
            text: step.copy?.technical?.[locale] || step.copy?.beginner?.[locale] || '',
        });
    }
    for (const question of lesson.quiz || []) {
        notes.push({
            code: `quiz:${question.id}`,
            text: question.explanation?.technical?.[locale] || question.explanation?.beginner?.[locale] || '',
        });
    }
    return {
        lessonId: lesson.id,
        lessonVersion: lesson.lessonVersion,
        reviewedAt: lesson.reviewedAt,
        sourceUrl: lesson.sourceUrl,
        notes: notes.filter((note) => note.text !== ''),
    };
}

/**
 * 말뭉치 비교의 발표자 메모. 보고서에 들어가는 주의 문구와 실제 집계만 사용한다.
 */
export function benchmarkPresenterNotes(result) {
    const summary = summarizeBenchmark(result);
    const notes = benchmarkCaveats(result).map((item) => ({ code: item.code, text: item.text }));

    notes.unshift({
        code: 'comparable-subset',
        text: `Ranking uses ${summary.comparable.sampleCount} of ${result.corpus.sampleIds.length} samples, where every successful column produced a result.`,
    });
    if (summary.failedColumns.length > 0) {
        notes.unshift({
            code: 'failed-columns',
            text: `Failed columns: ${summary.failedColumns.join(', ')}.`,
        });
    }
    return {
        runId: result.runId,
        createdAt: result.createdAt,
        percentileMethod: result.percentileMethod,
        notes,
    };
}
