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
    } else if (state.lastResult) {
        render(state.lastResult);
    } else {
        processText();
    }
}

async function onModelChange() {
    state.currentModelId = el('modelSelect').value;
    await ensureTokenizer();
    processText();
}

function onHeatmapToggle() {
    state.heatmapOn = el('heatmapToggle').checked;
    if (state.lastResult) render(state.lastResult);
}

function onAnimToggle() {
    state.animOn = el('animToggle').checked;
    const m = document.querySelector('main');
    if (state.animOn) playStageAnim();
    else m.classList.remove('anim');
}

function onCostModelChange() {
    state.costModelId = el('costModelSelect').value;
    renderCost(state.lastResult);
}

function switchView(name) {
    if (name === 'matrix' && !el('matrixView')) return;
    state.currentView = name;
    ['pipeline', 'compare', 'matrix'].forEach((v) => {
        const node = el(v + 'View');
        if (node) {
            const isHidden = v !== name;
            node.hidden = isHidden;
            node.classList.toggle('hidden', isHidden);
        }
    });
    el('pipelineControls').classList.toggle('hidden', name !== 'pipeline');
    el('inputRow').classList.toggle('hidden', name === 'matrix');
    el('presetBtns').classList.toggle('hidden', name === 'matrix');
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
    if (state.currentView === 'compare') renderCompare();
    else if (state.currentView === 'pipeline') processText();
}

async function init() {
    buildModelSelect();
    buildCostSelect();
    buildCmpSelects();
    el('modelSelect').addEventListener('change', onModelChange);
    el('langToggleBtn').addEventListener('click', toggleLang);
    el('inputText').addEventListener('input', onInput);
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

    applyLang();
    processText();           // 로드 전 즉시 1차 렌더(휴리스틱)
    await ensureTokenizer();  // 실제 토크나이저 로드
    processText();           // 실제 엔진으로 재렌더
}

window.addEventListener('DOMContentLoaded', init);
