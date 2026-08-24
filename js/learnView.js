import { el } from './dom.js';
import { state } from './state.js';
import { tokenizeWith } from './tokenizer.js';
import {
    LESSONS,
    answerLessonQuestion,
    completeLessonStep,
    createLessonProgress,
    formatLessonNarrative,
    scoreLessonQuiz,
    selectLesson,
    summarizeLessonProgress,
} from './lessons.js';

const COPY = Object.freeze({
    ko: {
        tab: '5분 Learn', title: '5분 학습 경로', level: '설명 수준', beginner: '초급', technical: '기술',
        paths: '학습 경로', lesson: '학습 내용', glossary: '용어집', reviewed: '검토일', source: '근거',
        progress: '진행', complete: '이 단계 완료', completed: '완료됨', nextFirst: '앞 단계를 먼저 완료하세요.',
        openSample: '샘플로 직접 해보기', quiz: '오개념 확인 4문항', score: '채점', unanswered: '4문항에 모두 답하세요.',
        passed: '통과', retry: '다시 확인', summary: '현재 수치 한 줄 요약', fallback: '폴백 결과는 설명용이며 artifact 비교의 근거가 아닙니다.',
    },
    en: {
        tab: '5-min Learn', title: 'Five-minute learning paths', level: 'Explanation level', beginner: 'Beginner', technical: 'Technical',
        paths: 'Paths', lesson: 'Lesson', glossary: 'Glossary', reviewed: 'Reviewed', source: 'Source',
        progress: 'Progress', complete: 'Complete this step', completed: 'Completed', nextFirst: 'Complete the preceding step first.',
        openSample: 'Try the sample', quiz: 'Four misconception checks', score: 'Score answers', unanswered: 'Answer all four questions.',
        passed: 'Passed', retry: 'Review and retry', summary: 'Current numeric summary', fallback: 'Fallback output is illustrative and cannot support artifact comparison claims.',
    },
});

const progressByLesson = new Map();
let openSample = () => {};

function currentProgress() {
    if (!progressByLesson.has(state.learnLessonId)) {
        progressByLesson.set(state.learnLessonId, createLessonProgress(state.learnLessonId));
    }
    return progressByLesson.get(state.learnLessonId);
}

function setCurrentProgress(progress) {
    progressByLesson.set(state.learnLessonId, progress);
}

function wordCount(text) {
    const trimmed = text.trim();
    return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

function narrativeValues(lesson) {
    const result = state.lastResult;
    const input = result?.input;
    const values = {
        wordCount: input ? wordCount(input.text) : 0,
        tokenCount: result?.ids.length ?? 0,
        graphemes: input?.graphemeLength ?? '—',
        codePoints: input?.codePointLength ?? 0,
        utf8Bytes: input?.utf8ByteLength ?? 0,
        artifactA: result?.modelId || state.currentModelId,
        tokenCountA: result?.ids.length ?? '—',
        artifactB: state.cmpModelB,
        tokenCountB: '—',
        delta: '—',
    };
    if (lesson.id === 'same-text-different-tokenizers' && state.cmpTokB && result) {
        const second = tokenizeWith(state.cmpTokB, result.input.text, state.cmpModelB, state.analysisOptions);
        if (second.engine === 'real') {
            values.tokenCountB = second.ids.length;
            values.delta = second.ids.length - result.ids.length;
        }
    }
    return values;
}

function buildLessonNav() {
    const container = el('lessonNav');
    container.innerHTML = '';
    for (const lesson of LESSONS) {
        const projection = selectLesson(lesson.id, { locale: state.lang, level: state.explanationLevel });
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lesson-nav-button';
        button.classList.toggle('is-active', lesson.id === state.learnLessonId);
        button.setAttribute('aria-pressed', String(lesson.id === state.learnLessonId));
        button.textContent = `${projection.durationMinutes} min · ${projection.title}`;
        button.addEventListener('click', () => {
            state.learnLessonId = lesson.id;
            el('lessonSelect').value = lesson.id;
            renderLearn();
        });
        container.appendChild(button);
    }
}

function sourceLink(text, url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = text;
    return link;
}

function renderSteps(lesson, progress) {
    const container = document.createElement('section');
    const progressSummary = summarizeLessonProgress(progress);
    lesson.steps.forEach((step, index) => {
        const details = document.createElement('details');
        details.className = 'lesson-step';
        details.open = step.id === progressSummary.nextStepId || (index === 0 && progressSummary.nextStepId === null);
        const summary = document.createElement('summary');
        const done = progress.completedStepIds.includes(step.id);
        summary.textContent = `${index + 1}. ${step.heading}${done ? ' ✓' : ''}`;
        const body = document.createElement('div');
        body.className = 'lesson-step-body';
        const copy = document.createElement('p');
        copy.textContent = step.copy;
        body.appendChild(copy);
        if (step.id === 'interact') {
            const sampleButton = document.createElement('button');
            sampleButton.type = 'button';
            sampleButton.className = 'p1-button';
            sampleButton.textContent = COPY[state.lang].openSample;
            sampleButton.addEventListener('click', () => openSample(lesson.sample));
            body.appendChild(sampleButton);
        }
        const completeButton = document.createElement('button');
        completeButton.type = 'button';
        completeButton.className = 'p1-button';
        completeButton.textContent = done ? COPY[state.lang].completed : COPY[state.lang].complete;
        completeButton.disabled = done || progressSummary.nextStepId !== step.id;
        completeButton.title = !done && progressSummary.nextStepId !== step.id ? COPY[state.lang].nextFirst : '';
        completeButton.addEventListener('click', () => {
            setCurrentProgress(completeLessonStep(currentProgress(), step.id));
            renderLearn();
        });
        body.appendChild(completeButton);
        details.append(summary, body);
        container.appendChild(details);
    });
    return container;
}

function renderQuiz(lesson, progress) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.className = 'p1-subheading';
    heading.textContent = COPY[state.lang].quiz;
    section.appendChild(heading);
    lesson.quiz.forEach((question, index) => {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'lesson-quiz-item';
        const legend = document.createElement('legend');
        legend.textContent = `${index + 1}. ${question.prompt}`;
        fieldset.appendChild(legend);
        question.options.forEach((candidate) => {
            const label = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `${lesson.id}-${question.id}`;
            radio.value = candidate.id;
            radio.checked = progress.answers[question.id] === candidate.id;
            radio.addEventListener('change', () => {
                setCurrentProgress(answerLessonQuestion(currentProgress(), question.id, candidate.id));
            });
            label.append(radio, document.createTextNode(` ${candidate.label}`));
            fieldset.appendChild(label);
        });
        section.appendChild(fieldset);
    });
    const scoreButton = document.createElement('button');
    scoreButton.type = 'button';
    scoreButton.className = 'p1-button';
    scoreButton.textContent = COPY[state.lang].score;
    const result = document.createElement('div');
    result.className = 'action-status';
    result.id = 'lessonQuizResult';
    scoreButton.addEventListener('click', () => {
        const score = scoreLessonQuiz(lesson.id, currentProgress().answers);
        if (score.answered < score.total) {
            result.textContent = COPY[state.lang].unanswered;
            return;
        }
        result.textContent = `${score.correct}/${score.total} · ${score.passed ? COPY[state.lang].passed : COPY[state.lang].retry}`;
        result.style.color = score.passed ? '#166534' : '#991b1b';
        const explanations = lesson.quiz.map((question) => `${question.id.toUpperCase()}: ${question.explanation}`).join('\n');
        result.style.whiteSpace = 'pre-wrap';
        result.textContent += `\n${explanations}`;
    });
    section.append(scoreButton, result);
    return section;
}

function renderGlossary(lesson) {
    const container = el('lessonGlossary');
    container.innerHTML = '';
    lesson.glossary.forEach((entry) => {
        const details = document.createElement('details');
        details.className = 'glossary-item';
        const summary = document.createElement('summary');
        summary.textContent = entry.term;
        const definition = document.createElement('p');
        definition.textContent = entry.definition;
        details.append(summary, definition, sourceLink(COPY[state.lang].source, entry.sourceUrl));
        container.appendChild(details);
    });
}

function renderLessonContent(lesson) {
    const progress = currentProgress();
    const status = summarizeLessonProgress(progress);
    const container = el('lessonContent');
    container.innerHTML = '';
    const title = document.createElement('h2');
    title.textContent = lesson.title;
    const meta = document.createElement('p');
    meta.className = 'p1-note';
    meta.append(
        document.createTextNode(`${lesson.durationMinutes} min · ${COPY[state.lang].reviewed} ${lesson.reviewedAt} · `),
        sourceLink(COPY[state.lang].source, lesson.sourceUrl),
    );
    const progressText = document.createElement('p');
    progressText.className = 'p1-note';
    progressText.textContent = `${COPY[state.lang].progress}: ${status.completedSteps}/${status.totalSteps} (${status.percent}%)`;
    const narrativeHeading = document.createElement('h3');
    narrativeHeading.className = 'p1-subheading';
    narrativeHeading.textContent = COPY[state.lang].summary;
    const narrative = document.createElement('div');
    narrative.className = 'text-diff';
    narrative.textContent = formatLessonNarrative(lesson.id, narrativeValues(lesson), {
        locale: state.lang,
        level: state.explanationLevel,
    });
    container.append(title, meta, progressText, narrativeHeading, narrative);
    if (state.lastResult?.engine === 'heuristic') {
        const fallback = document.createElement('p');
        fallback.className = 'p1-note input-warning';
        fallback.textContent = COPY[state.lang].fallback;
        container.appendChild(fallback);
    }
    container.append(renderSteps(lesson, progress), renderQuiz(lesson, progress));
}

export function renderLearn() {
    const lesson = selectLesson(state.learnLessonId, {
        locale: state.lang,
        level: state.explanationLevel,
    });
    buildLessonNav();
    renderLessonContent(lesson);
    renderGlossary(lesson);
    el('lessonSelect').value = state.learnLessonId;
    el('explanationLevel').value = state.explanationLevel;
}

export function applyLearnLanguage() {
    const L = COPY[state.lang];
    el('tabLearn').textContent = L.tab;
    el('learnTitle').textContent = L.title;
    el('explanationLevelLabel').textContent = L.level;
    el('levelBeginnerOption').textContent = L.beginner;
    el('levelTechnicalOption').textContent = L.technical;
    el('lessonPathsTitle').textContent = L.paths;
    el('lessonContentTitle').textContent = L.lesson;
    el('lessonGlossaryTitle').textContent = L.glossary;
    [...el('lessonSelect').options].forEach((option) => {
        option.textContent = selectLesson(option.value, {
            locale: state.lang, level: state.explanationLevel,
        }).title;
    });
    renderLearn();
}

export function initLearn(options = {}) {
    openSample = typeof options.openSample === 'function' ? options.openSample : () => {};
    const select = el('lessonSelect');
    select.innerHTML = '';
    LESSONS.forEach((lesson) => {
        const projection = selectLesson(lesson.id, { locale: state.lang, level: state.explanationLevel });
        const option = document.createElement('option');
        option.value = lesson.id;
        option.textContent = projection.title;
        select.appendChild(option);
    });
    select.addEventListener('change', () => {
        state.learnLessonId = select.value;
        renderLearn();
    });
    el('explanationLevel').addEventListener('change', (event) => {
        state.explanationLevel = event.target.value;
        applyLearnLanguage();
    });
    applyLearnLanguage();
}
