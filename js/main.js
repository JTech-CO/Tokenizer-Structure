// main.js — 진입점: i18n 적용, 뷰 전환, 토글, 이벤트 바인딩, init
import { el } from './dom.js';
import { i18n } from './i18n.js';
import { state } from './state.js';
import {
    buildModelSelect, buildCostSelect, setEngineStatus, ensureTokenizer,
    render, renderCost, processText, playStageAnim,
} from './pipeline.js';
import { buildCmpSelects, setCmpStatus, renderCompare, ensureCompare, onCmpChange } from './compare.js';
import { ensureMatrix } from './matrix.js';
import { openCostModal, closeCostModal, handleCostModalKeydown, setCostSort } from './costModal.js';
import { buildPresets } from './presets.js';
import { setupHoverSync } from './hover.js';
import { MODELS } from './tokenizer.js';
import { normalizeAnalysisOptions } from './analysisOptions.js';
import { syncInputEditorScroll, updateInputEditor } from './inputEditor.js';
import {
    applyInspectorLanguage, initInspector, renderInspector, restoreInspectorShare,
    syncInspectorControls,
} from './inspectorView.js';
import { applyLearnLanguage, initLearn, renderLearn } from './learnView.js';
import { applyRequestLabLanguage, initRequestLab, renderRequestLab } from './requestLabView.js';
import { applyBenchmarkLanguage, initBenchmark, renderBenchmarkResult } from './benchmarkView.js';
import { applyPresentationLanguage, initPresentation, refreshPresentation, setPresentation } from './presentationView.js';
import { BUILTIN_CORPORA } from './corpus.js';
import { BENCHMARK_METRICS } from './benchmarkDomain.js';
import { applyOperateLanguage, initOperate, registerAppShellWorker, renderOperate } from './operateView.js';

const VIEW_NAMES = new Set(['pipeline', 'compare', 'matrix', 'inspector', 'learn', 'request', 'benchmark', 'operate']);
const CORPUS_IDS = new Set([...BUILTIN_CORPORA.map((corpus) => corpus.id), 'user']);
const MODEL_IDS = new Set(MODELS.map((model) => model.id));
const LENS_NAMES = new Set(['spaces', 'nfc', 'nfd', 'case', 'emoji', 'code-indentation']);
const LESSON_NAMES = new Set(['token-not-word', 'korean-emoji-utf8', 'same-text-different-tokenizers']);

function restoreSharedState() {
    try {
        const restored = restoreInspectorShare(window.location.search);
        if (!restored) return;
        const shared = restored.state;
        if (typeof shared.modelId === 'string' && MODELS.some((model) => model.id === shared.modelId)) {
            state.currentModelId = shared.modelId;
        }
        if (typeof shared.view === 'string' && VIEW_NAMES.has(shared.view)) state.currentView = shared.view;
        if (shared.lang === 'ko' || shared.lang === 'en') state.lang = shared.lang;
        if (typeof shared.lens === 'string' && LENS_NAMES.has(shared.lens)) state.inspectorLens = shared.lens;
        if (typeof shared.lessonId === 'string' && LESSON_NAMES.has(shared.lessonId)) {
            state.learnLessonId = shared.lessonId;
        }
        if (shared.level === 'beginner' || shared.level === 'technical') {
            state.explanationLevel = shared.level;
        }
        if (shared.options !== undefined) state.analysisOptions = normalizeAnalysisOptions(shared.options);
        if (typeof shared.corpusId === 'string' && CORPUS_IDS.has(shared.corpusId)) {
            state.benchmarkCorpusId = shared.corpusId;
        }
        if (typeof shared.benchmarkMetric === 'string' && BENCHMARK_METRICS.includes(shared.benchmarkMetric)) {
            state.benchmarkMetric = shared.benchmarkMetric;
        }
        if (Array.isArray(shared.benchmarkColumns)) {
            const columns = shared.benchmarkColumns.filter((id) => MODEL_IDS.has(id));
            if (columns.length >= 2 && columns.length <= 4) state.benchmarkColumns = columns;
        }
        if (typeof shared.presentation === 'boolean') state.presentationOn = shared.presentation;
        if (restored.includesInput && typeof shared.text === 'string') el('inputText').value = shared.text;
    } catch (error) {
        console.warn('Ignored invalid Inspector share state:', error);
    }
}

function analyzeActiveView() {
    const inputStatus = updateInputEditor(state.lang);
    const result = processText();
    if (state.currentView === 'inspector') renderInspector(result);
    if (state.currentView === 'learn') renderLearn();
    if (state.currentView === 'request') renderRequestLab();
    refreshPresentation();
    return { inputStatus, result };
}

function openLessonSample(sample) {
    el('inputText').value = sample.input;
    updateInputEditor(state.lang);
    if (sample.interactionKind === 'artifact-comparison') switchView('compare');
    else {
        if (sample.interactionKind === 'unicode-metrics') state.inspectorLens = 'nfd';
        switchView('inspector');
    }
}

// 현재 언어 기준 정적 UI 텍스트 적용
function applyLang() {
    const L = i18n[state.lang];
    document.documentElement.lang = state.lang;
    document.title = L.documentTitle;
    el('mainTitle').textContent = L.mainTitle;
    el('langToggleBtn').textContent = L.toggleBtn;
    el('inputText').placeholder = L.placeholder;
    el('step1Title').textContent = L.step1Title;
    el('step1Desc').textContent = L.step1Desc;
    el('step2Title').textContent = L.step2Title;
    el('step2Desc').textContent = L.step2Desc;
    el('step3Title').textContent = L.step3Title;
    el('step3Desc').textContent = L.step3Desc;
    el('step4Title').textContent = L.step4Title;
    el('step4Desc').textContent = L.step4Desc;
    el('finalTitle').textContent = L.finalTitle;
    el('heatmapLabel').textContent = L.heatmapLabel;
    el('animLabel').textContent = L.animLabel;
    el('efficiencyTitle').textContent = L.efficiencyTitle;
    el('costTitle').textContent = L.costTitle;
    el('tabPipeline').textContent = L.tabPipeline;
    el('tabCompare').textContent = L.tabCompare;
    el('tabMatrix').textContent = L.tabMatrix;
    el('matrixTableWrap').setAttribute('aria-label', L.matrixScrollLabel);
    el('costTableWrap').setAttribute('aria-label', L.costTableScrollLabel);
    el('viewTabs').setAttribute('aria-label', L.viewsLabel);
    el('cmpIdsA').setAttribute('aria-label', L.compareIdsScrollLabelA);
    el('cmpIdsB').setAttribute('aria-label', L.compareIdsScrollLabelB);
    el('tokenDetailWrap').setAttribute('aria-label', L.tokenDetailScrollLabel);
    el('inspectorLenses').setAttribute('aria-label', L.lensGroupLabel);
    el('costTableBtn').textContent = L.costTableBtn;
    el('costModalTitle').textContent = L.costModalTitle;
    el('sortBtnProvider').textContent = L.sortProvider;
    el('sortBtnAsc').textContent = L.sortAsc;
    el('sortBtnDesc').textContent = L.sortDesc;
    el('modelSelectLabel').textContent = L.modelSelectLabel;
    el('inputTextLabel').textContent = L.inputLabel;
    el('costModelLabel').textContent = L.costModelLabel;
    el('cmpLabelA').textContent = L.compareModelA;
    el('cmpLabelB').textContent = L.compareModelB;
    el('modelSelect').title = L.modelSelectLabel;
    el('costModelSelect').title = L.costModelLabel;
    el('cmpSelectA').title = L.compareModelA;
    el('cmpSelectB').title = L.compareModelB;
    el('heatmapToggleWrap').title = L.heatmapTitle;
    el('animToggleWrap').title = L.animTitle;
    el('costModalClose').title = L.closeLabel;
    el('costModalClose').setAttribute('aria-label', L.closeLabel);
    applyInspectorLanguage();
    applyLearnLanguage();
    applyRequestLabLanguage();
    applyBenchmarkLanguage();
    applyOperateLanguage();
    applyPresentationLanguage();
    updateInputEditor(state.lang);
    buildCostSelect();
    buildPresets(onInput);
}

function toggleLang() {
    const inputEl = el('inputText');
    // 사용자가 기본 문장을 유지 중일 때만 예시 문장 언어 전환
    if (inputEl.value === i18n[state.lang].defaultInput) {
        inputEl.value = i18n[state.lang === 'ko' ? 'en' : 'ko'].defaultInput;
    }
    state.lang = state.lang === 'ko' ? 'en' : 'ko';
    applyLang();
    const engineKind = state.loading
        ? 'loading'
        : state.lastResult
            ? (state.lastResult.engine === 'real' ? 'real' : 'fallback')
            : state.currentTok ? 'real' : 'fallback';
    setEngineStatus(engineKind);
    if (state.currentView === 'compare') {
        setCmpStatus('A', state.cmpLoadingA ? 'loading' : state.cmpTokA ? 'real' : 'fallback');
        setCmpStatus('B', state.cmpLoadingB ? 'loading' : state.cmpTokB ? 'real' : 'fallback');
        renderCompare();
    } else if (state.currentView === 'matrix') {
        ensureMatrix();
    } else if (state.currentView === 'inspector') {
        renderInspector(state.lastResult);
    } else if (state.currentView === 'learn') {
        renderLearn();
    } else if (state.lastResult) {
        render(state.lastResult);
    } else {
        analyzeActiveView();
    }
    // 다시 그린 DOM에는 reveal 표시가 없으므로 발표 상태를 복원한다.
    refreshPresentation();
}

async function onModelChange() {
    state.currentModelId = el('modelSelect').value;
    await ensureTokenizer();
    analyzeActiveView();
}

function onHeatmapToggle() {
    state.heatmapOn = el('heatmapToggle').checked;
    if (state.lastResult) render(state.lastResult);
}

function onAnimToggle() {
    state.animOn = el('animToggle').checked;
    const m = el('pipelineGrid');
    if (state.animOn) playStageAnim();
    else m.classList.remove('anim');
}

function onCostModelChange() {
    state.costModelId = el('costModelSelect').value;
    renderCost(state.lastResult);
}

function switchView(name) {
    if (!VIEW_NAMES.has(name) || !el(name + 'View')) return;
    state.currentView = name;
    [...VIEW_NAMES].forEach((v) => {
        const node = el(v + 'View');
        if (node) {
            const isHidden = v !== name;
            node.hidden = isHidden;
            node.classList.toggle('hidden', isHidden);
        }
    });
    // Request Lab은 자체 composer를 쓰므로 공용 입력줄과 preset을 숨기지만,
    // artifact 선택은 chat template 능력을 바꾸므로 모델 컨트롤은 남긴다.
    el('pipelineControls').classList.toggle('hidden', !['pipeline', 'inspector', 'learn', 'request'].includes(name));
    el('inputRow').classList.toggle('hidden', ['matrix', 'request', 'benchmark', 'operate'].includes(name));
    el('presetBtns').classList.toggle('hidden', ['matrix', 'learn', 'request', 'benchmark', 'operate'].includes(name));
    document.querySelectorAll('.view-tab[data-view]').forEach((b) => {
        const active = b.dataset.view === name;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
        b.tabIndex = active ? 0 : -1;
    });
    if (name === 'pipeline') {
        if (state.lastResult) render(state.lastResult);
        else processText();
    }
    if (name === 'compare') ensureCompare();
    if (name === 'matrix') ensureMatrix();
    if (name === 'inspector') analyzeActiveView();
    if (name === 'learn') { processText(); renderLearn(); }
    if (name === 'request') renderRequestLab();
    if (name === 'benchmark') renderBenchmarkResult();
    if (name === 'operate') renderOperate();
    refreshPresentation();
}

function onViewTabKeydown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const tabs = [...document.querySelectorAll('.view-tab[data-view]')];
    const current = tabs.indexOf(event.currentTarget);
    let next = current;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    switchView(tabs[next].dataset.view);
}

function onInput() {
    const status = updateInputEditor(state.lang);
    if (!status.accepted) {
        processText();
        if (state.currentView === 'inspector') renderInspector(null);
        if (state.currentView === 'learn') { renderLearn(); refreshPresentation(); }
        return;
    }
    if (state.currentView === 'compare') renderCompare();
    else if (state.currentView === 'pipeline') processText();
    else if (state.currentView === 'inspector') analyzeActiveView();
    else if (state.currentView === 'learn') { processText(); renderLearn(); refreshPresentation(); }
}

async function init() {
    restoreSharedState();
    buildModelSelect();
    buildCostSelect();
    buildCmpSelects();
    el('modelSelect').addEventListener('change', onModelChange);
    el('langToggleBtn').addEventListener('click', toggleLang);
    el('inputText').addEventListener('input', onInput);
    el('inputText').addEventListener('scroll', syncInputEditorScroll);
    el('heatmapToggle').addEventListener('change', onHeatmapToggle);
    el('animToggle').addEventListener('change', onAnimToggle);
    el('costModelSelect').addEventListener('change', onCostModelChange);
    el('cmpSelectA').addEventListener('change', () => onCmpChange('A'));
    el('cmpSelectB').addEventListener('change', () => onCmpChange('B'));
    document.querySelectorAll('.view-tab[data-view]').forEach((b) => {
        b.addEventListener('click', () => switchView(b.dataset.view));
        b.addEventListener('keydown', onViewTabKeydown);
    });
    el('costTableBtn').addEventListener('click', openCostModal);
    el('costModalClose').addEventListener('click', closeCostModal);
    el('costModal').addEventListener('click', (e) => { if (e.target === el('costModal')) closeCostModal(); });
    document.querySelectorAll('#costSortBtns .sort-btn').forEach((b) =>
        b.addEventListener('click', () => setCostSort(b.dataset.sort))
    );
    document.addEventListener('keydown', handleCostModalKeydown);
    setupHoverSync();
    initInspector({ reanalyze: analyzeActiveView });
    initLearn({ openSample: openLessonSample });
    initRequestLab(renderRequestLab);
    initBenchmark({ onReveal: (total) => refreshPresentation(total) });
    initOperate();
    initPresentation();

    applyLang();
    setPresentation(state.presentationOn);
    syncInspectorControls();
    updateInputEditor(state.lang);
    switchView(state.currentView); // 로드 전 즉시 1차 렌더(휴리스틱)
    // app shell만 담는 Service Worker. HTML은 네트워크를 먼저 시도하므로 갱신이 막히지 않는다.
    registerAppShellWorker().catch((error) => console.warn('Service worker registration skipped:', error));
    await ensureTokenizer();  // 실제 토크나이저 로드
    if (state.currentView === 'compare') renderCompare();
    else if (state.currentView === 'matrix') ensureMatrix();
    else analyzeActiveView(); // 실제 엔진으로 재렌더
}

window.addEventListener('DOMContentLoaded', init);
