// presentationView.js — 발표 모드 UI. 단계별 reveal과 발표자 메모를 화면에 연결한다.
import { el } from './dom.js';
import { state } from './state.js';
import { LESSONS } from './lessons.js';
import {
    PRESENTATION_SURFACES,
    benchmarkPresenterNotes,
    createReveal,
    isRevealed,
    learnPresenterNotes,
    resetReveal,
    revealAll,
    revealNext,
    revealPrevious,
} from './presentation.js';
import { benchmarkResult, benchmarkRevealTargets, localizeBenchmarkNote } from './benchmarkView.js';

const COPY = Object.freeze({
    ko: {
        toggle: '발표 모드', prev: '이전', next: '다음', all: '전체', reset: '초기화',
        notes: '발표자 메모', barLabel: '발표 모드 컨트롤',
        counter: '{revealed}/{total} 단계',
        noSurface: '이 화면에는 단계별 진행이 없습니다.',
        noNotes: '표시할 메모가 없습니다.',
        source: '근거: {url} · 검토일 {reviewedAt} · lesson {version}',
        runSource: 'run {runId} · {createdAt} · percentile {method}',
    },
    en: {
        toggle: 'Presentation', prev: 'Back', next: 'Next', all: 'Reveal all', reset: 'Reset',
        notes: 'Presenter notes', barLabel: 'Presentation controls',
        counter: '{revealed} of {total}',
        noSurface: 'This view has no step-by-step reveal.',
        noNotes: 'No notes to show.',
        source: 'Source: {url} · reviewed {reviewedAt} · lesson {version}',
        runSource: 'run {runId} · {createdAt} · percentile {method}',
    },
});

function copy() {
    return COPY[state.lang] || COPY.ko;
}

function format(template, values) {
    return Object.entries(values).reduce(
        (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
        template,
    );
}

function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function isPresentationSurface(view) {
    return PRESENTATION_SURFACES.includes(view);
}

function revealTargets() {
    if (state.currentView === 'learn') {
        return [...document.querySelectorAll('#lessonContent .lesson-step')];
    }
    if (state.currentView === 'benchmark') return benchmarkRevealTargets();
    return [];
}

function currentNotes() {
    if (state.currentView === 'learn') {
        const lesson = LESSONS.find((item) => item.id === state.learnLessonId) || LESSONS[0];
        return {
            kind: 'learn',
            data: learnPresenterNotes(lesson, {
                locale: state.lang,
                stepIndex: Math.max(0, state.presentationReveal.revealed - 1),
            }),
        };
    }
    if (state.currentView === 'benchmark') {
        const result = benchmarkResult();
        return result ? { kind: 'benchmark', data: benchmarkPresenterNotes(result) } : null;
    }
    return null;
}

function renderNotes() {
    const box = clear(el('presentationNotes'));
    const text = copy();
    const current = currentNotes();
    if (!current || current.data.notes.length === 0) {
        box.append(element('div', null, text.noNotes));
        return;
    }
    if (current.kind === 'learn') {
        box.append(element('span', 'presentation-source', format(text.source, {
            url: current.data.sourceUrl,
            reviewedAt: current.data.reviewedAt,
            version: current.data.lessonVersion,
        })));
    } else {
        box.append(element('span', 'presentation-source', format(text.runSource, {
            runId: current.data.runId,
            createdAt: current.data.createdAt,
            method: current.data.percentileMethod,
        })));
    }
    const list = document.createElement('ul');
    for (const note of current.data.notes) {
        // 보고서에는 영어 원문을 남기되, 발표 화면에는 화면 언어 문구를 보여준다.
        const noteText = current.kind === 'benchmark'
            ? localizeBenchmarkNote(note.code, note.text, { n: benchmarkResult()?.corpus.sampleIds.length ?? 0 })
            : note.text;
        list.append(element('li', null, noteText));
    }
    box.append(list);
}

function applyReveal() {
    const targets = revealTargets();
    const reveal = state.presentationReveal;
    targets.forEach((target, index) => {
        if (!state.presentationOn) {
            delete target.dataset.reveal;
            return;
        }
        target.dataset.reveal = isRevealed(reveal, index) ? 'shown' : 'hidden';
    });

    const text = copy();
    el('presentationCounter').textContent = reveal.total === 0
        ? text.noSurface
        : format(text.counter, { revealed: reveal.revealed, total: reveal.total });
    for (const id of ['presentationPrevBtn', 'presentationNextBtn', 'presentationAllBtn', 'presentationResetBtn']) {
        el(id).disabled = reveal.total === 0;
    }
    el('presentationPrevBtn').disabled = reveal.total === 0 || reveal.revealed <= 1;
    el('presentationNextBtn').disabled = reveal.total === 0 || reveal.revealed >= reveal.total;
    renderNotes();
}

/**
 * 현재 화면의 reveal 대상 수를 다시 세고 화면에 반영한다.
 * 대상 수가 달라지면 처음 단계로 되돌린다.
 */
export function refreshPresentation(total = null) {
    const count = total === null ? revealTargets().length : total;
    if (state.presentationReveal.total !== count) {
        state.presentationReveal = createReveal(count);
    }
    applyReveal();
}

export function setPresentation(on) {
    state.presentationOn = Boolean(on);
    document.body.classList.toggle('presentation', state.presentationOn);
    el('presentationBar').hidden = !state.presentationOn;
    el('presentationToggleBtn').setAttribute('aria-pressed', String(state.presentationOn));
    el('presentationToggleBtn').classList.toggle('is-active', state.presentationOn);
    if (!state.presentationOn) {
        el('presentationNotes').hidden = true;
        el('presentationNotesBtn').setAttribute('aria-expanded', 'false');
    }
    refreshPresentation();
}

export function applyPresentationLanguage() {
    const text = copy();
    el('presentationToggleBtn').textContent = text.toggle;
    el('presentationPrevBtn').textContent = text.prev;
    el('presentationNextBtn').textContent = text.next;
    el('presentationAllBtn').textContent = text.all;
    el('presentationResetBtn').textContent = text.reset;
    el('presentationNotesBtn').textContent = text.notes;
    el('presentationBar').setAttribute('aria-label', text.barLabel);
    el('presentationNotes').setAttribute('aria-label', text.notes);
    applyReveal();
}

export function initPresentation() {
    el('presentationToggleBtn').addEventListener('click', () => setPresentation(!state.presentationOn));
    el('presentationPrevBtn').addEventListener('click', () => {
        state.presentationReveal = revealPrevious(state.presentationReveal);
        applyReveal();
    });
    el('presentationNextBtn').addEventListener('click', () => {
        state.presentationReveal = revealNext(state.presentationReveal);
        applyReveal();
    });
    el('presentationAllBtn').addEventListener('click', () => {
        state.presentationReveal = revealAll(state.presentationReveal);
        applyReveal();
    });
    el('presentationResetBtn').addEventListener('click', () => {
        state.presentationReveal = resetReveal(state.presentationReveal);
        applyReveal();
    });
    el('presentationNotesBtn').addEventListener('click', () => {
        const notes = el('presentationNotes');
        notes.hidden = !notes.hidden;
        el('presentationNotesBtn').setAttribute('aria-expanded', String(!notes.hidden));
        if (!notes.hidden) renderNotes();
    });
    setPresentation(state.presentationOn);
}
