// compare.js — 모델 2열 동시 비교 뷰
import { el, createTokenBadge } from './dom.js';
import { i18n } from './i18n.js';
import { state } from './state.js';
import { MODELS, loadTokenizer, tokenizeWith } from './tokenizer.js';

export function buildCmpSelects() {
    [['cmpSelectA', state.cmpModelA], ['cmpSelectB', state.cmpModelB]].forEach(([id, val]) => {
        const sel = el(id);
        sel.innerHTML = '';
        MODELS.forEach((m) => {
            const o = document.createElement('option');
            o.value = m.id;
            o.textContent = m.label;
            sel.appendChild(o);
        });
        sel.value = val;
    });
}

export function setCmpStatus(side, kind) {
    const node = el('cmpStatus' + side);
    const L = i18n[state.lang];
    node.classList.remove('is-loading', 'is-real', 'is-fallback');
    if (kind === 'loading') {
        node.classList.add('is-loading');
        node.textContent = L.engineLoading + '…';
    } else if (kind === 'real') {
        node.classList.add('is-real');
        node.textContent = L.engineReal;
    } else {
        node.classList.add('is-fallback');
        node.textContent = L.engineFallback;
    }
}

async function ensureCmpTok(side) {
    const modelId = side === 'A' ? state.cmpModelA : state.cmpModelB;
    const cur = side === 'A' ? state.cmpTokA : state.cmpTokB;
    if (cur && cur.__modelId === modelId) return;
    setCmpStatus(side, 'loading');
    try {
        const tok = await loadTokenizer(modelId);
        if (side === 'A') state.cmpTokA = tok;
        else state.cmpTokB = tok;
        setCmpStatus(side, 'real');
    } catch (e) {
        if (side === 'A') state.cmpTokA = null;
        else state.cmpTokB = null;
        setCmpStatus(side, 'fallback');
        console.warn('compare tokenizer load failed', side, e);
    }
}

function renderCompareSide(side, result) {
    const L = i18n[state.lang];
    const sub = el('cmpSub' + side);
    const ids = el('cmpIds' + side);
    const eff = el('cmpEff' + side);
    sub.innerHTML = '';
    result.pieces.forEach((pc) => sub.appendChild(createTokenBadge(pc.surface, pc.token, false)));
    ids.textContent = `[ ${result.ids.join(', ')} ]`;
    const chars = [...el('inputText').value].length;
    const tokens = result.pieces.length;
    const total = result.ids.length;
    const cpt = tokens ? chars / tokens : 0;
    eff.innerHTML = `<b>${total}</b> ${L.tokensSuffix} · ${cpt.toFixed(2)} ${L.effCharPerTok}`;
    return total;
}

export function renderCompare() {
    const input = el('inputText').value;
    if (!input.trim()) {
        ['cmpSubA', 'cmpSubB', 'cmpIdsA', 'cmpIdsB', 'cmpEffA', 'cmpEffB', 'compareDiff'].forEach(
            (id) => (el(id).innerHTML = '')
        );
        return;
    }
    const rA = tokenizeWith(state.cmpTokA, input);
    const rB = tokenizeWith(state.cmpTokB, input);
    const tA = renderCompareSide('A', rA);
    const tB = renderCompareSide('B', rB);

    const L = i18n[state.lang];
    const labelA = (MODELS.find((m) => m.id === state.cmpModelA) || {}).label || 'A';
    const labelB = (MODELS.find((m) => m.id === state.cmpModelB) || {}).label || 'B';
    const diff = tA - tB;
    let msg;
    if (diff === 0) {
        msg = `${labelA} = ${labelB} · ${tA} ${L.tokensSuffix} (${L.cmpSame})`;
    } else {
        const less = diff < 0 ? labelA : labelB;
        msg = `${labelA} ${tA} ↔ ${labelB} ${tB} ${L.tokensSuffix} · ${less} ${Math.abs(diff)} ${L.cmpFewer}`;
    }
    el('compareDiff').textContent = msg;
}

export async function ensureCompare() {
    await Promise.all([ensureCmpTok('A'), ensureCmpTok('B')]);
    renderCompare();
}

export async function onCmpChange(side) {
    if (side === 'A') state.cmpModelA = el('cmpSelectA').value;
    else state.cmpModelB = el('cmpSelectB').value;
    await ensureCmpTok(side);
    renderCompare();
}
