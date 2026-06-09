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
import { openCostModal, closeCostModal, toggleCostSort, setCostSort } from './costModal.js';
import { buildPresets } from './presets.js';
import { setupHoverSync } from './hover.js';

// 현재 언어 기준 정적 UI 텍스트 적용
function applyLang() {
    const L = i18n[state.lang];
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
    el('costTableBtn').textContent = L.costTableBtn;
    el('costModalTitle').textContent = L.costModalTitle;
    el('sortBtnProvider').textContent = L.sortProvider;
    el('sortBtnAsc').textContent = L.sortAsc;
    el('sortBtnDesc').textContent = L.sortDesc;
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
    setEngineStatus(state.loading ? 'loading' : state.currentTok ? 'real' : 'fallback');
    if (state.currentView === 'compare') {
        setCmpStatus('A', state.cmpTokA ? 'real' : 'fallback');
        setCmpStatus('B', state.cmpTokB ? 'real' : 'fallback');
        renderCompare();
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
        if (node) node.classList.toggle('hidden', v !== name);
    });
    el('pipelineControls').classList.toggle('hidden', name !== 'pipeline');
    document.querySelectorAll('.view-tab[data-view]').forEach((b) =>
        b.classList.toggle('is-active', b.dataset.view === name)
    );
    if (name === 'compare') ensureCompare();
    if (name === 'matrix') ensureMatrix();
}

function onInput() {
    if (state.currentView === 'compare') renderCompare();
    else processText();
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
    document.querySelectorAll('.view-tab[data-view]').forEach((b) =>
        b.addEventListener('click', () => switchView(b.dataset.view))
    );
    el('costTableBtn').addEventListener('click', openCostModal);
    el('costModalClose').addEventListener('click', closeCostModal);
    el('costModal').addEventListener('click', (e) => { if (e.target === el('costModal')) closeCostModal(); });
    el('costTable').addEventListener('click', (e) => { if (e.target.closest('.ct-sort')) toggleCostSort(); });
    document.querySelectorAll('#costSortBtns .sort-btn').forEach((b) =>
        b.addEventListener('click', () => setCostSort(b.dataset.sort))
    );
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCostModal(); });
    setupHoverSync();

    applyLang();
    processText();           // 로드 전 즉시 1차 렌더(휴리스틱)
    await ensureTokenizer();  // 실제 토크나이저 로드
    processText();           // 실제 엔진으로 재렌더
}

window.addEventListener('DOMContentLoaded', init);
