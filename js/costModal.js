// costModal.js — 전 모델 비용 일괄표 모달 (제공사 그룹 + 정렬)
import { el } from './dom.js';
import { i18n } from './i18n.js';
import { state } from './state.js';
import { MODELS, tokenizeWith } from './tokenizer.js';
import { PRICING, PRICING_AS_OF, ratesFor, costOf, formatUSD, formatInt } from './pricing.js';

const PROVIDER_ORDER = ['OpenAI', 'Google', 'Anthropic'];
const PROVIDER_COLORS = {
    OpenAI: 'hsl(150, 55%, 90%)',    // 민트
    Google: 'hsl(210, 70%, 91%)',    // 연하늘
    Anthropic: 'hsl(28, 78%, 90%)',  // 살구
};
let returnFocus = null;
let lastTokenEngine = 'heuristic';

function setBackgroundInert(inert) {
    document.querySelectorAll('body > :not(#costModal):not(script)').forEach((node) => {
        node.inert = inert;
    });
    document.body.classList.toggle('modal-open', inert);
}


function renderCostTable(tokens) {
    const L = i18n[state.lang];
    if (lastTokenEngine !== 'real') {
        el('costTable').innerHTML = `<tbody><tr><td colspan="7" class="matrix-unavailable">${L.costUnavailable}</td></tr></tbody>`;
        el('costModalSub').textContent = `${L.costBasis}: ${L.engineFallback}`;
        return;
    }
    const rows = PRICING.map((p) => {
        const rates = ratesFor(p, tokens);
        return {
            p,
            rates,
            cur: costOf(rates.input, tokens),
            k1: costOf(ratesFor(p, 1000).input, 1000),
            k100: costOf(ratesFor(p, 100000).input, 100000),
        };
    });

    if (state.costSortMode === 'asc') {
        rows.sort((a, b) => a.cur - b.cur || a.p.input - b.p.input);
    } else if (state.costSortMode === 'desc') {
        rows.sort((a, b) => b.cur - a.cur || b.p.input - a.p.input);
    } else {
        rows.sort((a, b) => {
            const pa = PROVIDER_ORDER.indexOf(a.p.provider);
            const pb = PROVIDER_ORDER.indexOf(b.p.provider);
            if (pa !== pb) return pa - pb;
            return a.cur - b.cur;
        });
    }

    const arrow = state.costSortMode === 'asc' ? ' ▲' : state.costSortMode === 'desc' ? ' ▼' : ' ⇅';
    let html =
        '<thead><tr><th class="ct-name">' + L.ctModel + '</th><th>' + L.ctProvider + '</th><th>$/1M</th>' +
        '<th>' + tokens + ' tok' + arrow + '</th>' +
        '<th>1K</th><th>100K</th><th>' + L.ctContext + '</th></tr></thead><tbody>';
    rows.forEach(({ p, rates, cur, k1, k100 }) => {
        const bg = PROVIDER_COLORS[p.provider] || '#ffffff';
        const annotations = [
            p.status ? L[p.status] : '',
            p.tiered ? L.costTieredNote : '',
            p.effectiveUntil ? `${L.promoUntil} ${p.effectiveUntil}` : '',
            p.guaranteedThrough ? `${L.promoGuaranteedThrough} ${p.guaranteedThrough}` : '',
            p.sunsetEarliest ? `${L.sunsetEarliest} ${p.sunsetEarliest} → ${p.replacement}` : '',
        ].filter(Boolean);
        const displayName = p.name + (annotations.length ? ` · ${annotations.join(' · ')}` : '');
        html +=
            '<tr style="background-color:' + bg + '">' +
            '<td class="ct-name">' + displayName + '</td>' +
            '<td>' + p.provider + '</td>' +
            '<td>$' + rates.input.toFixed(2) + '</td>' +
            '<td><b>' + formatUSD(cur) + '</b></td>' +
            '<td>' + formatUSD(k1) + '</td>' +
            '<td>' + formatUSD(k100) + '</td>' +
            '<td>' + formatInt(p.context) + '</td></tr>';
    });
    html += '</tbody>';
    el('costTable').innerHTML = html;
    const tokenizer = MODELS.find((m) => m.id === state.currentModelId);
    const basis = lastTokenEngine === 'real'
        ? (tokenizer ? tokenizer.label : state.currentModelId)
        : L.engineFallback;
    el('costModalSub').textContent = `${tokens} ${L.tokensSuffix} ${L.costInputWord} · ${L.costBasis}: ${basis} · ${L.costAsOf} ${PRICING_AS_OF} · ${L.costEstimate}`;
}

function updateSortBtns() {
    document.querySelectorAll('#costSortBtns .sort-btn').forEach((b) => {
        const active = b.dataset.sort === state.costSortMode;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
    });
}

export function setCostSort(mode) {
    state.costSortMode = mode;
    renderCostTable(state.lastCostTokens);
    updateSortBtns();
}


export function openCostModal() {
    const input = el('inputText').value;
    const r = input.trim() ? tokenizeWith(state.currentTok, input) : null;
    state.lastCostTokens = r ? r.ids.length : 0;
    lastTokenEngine = r ? r.engine : (state.currentTok ? 'real' : 'heuristic');
    renderCostTable(state.lastCostTokens);
    updateSortBtns();
    returnFocus = document.activeElement;
    const modal = el('costModal');
    setBackgroundInert(true);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    el('costTableBtn').setAttribute('aria-expanded', 'true');
    window.requestAnimationFrame(() => {
        if (modal.classList.contains('is-open')) el('costModalClose').focus();
    });
}

export function closeCostModal() {
    const modal = el('costModal');
    if (!modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    el('costTableBtn').setAttribute('aria-expanded', 'false');
    setBackgroundInert(false);
    const target = returnFocus;
    returnFocus = null;
    if (target && typeof target.focus === 'function') target.focus();
}

export function handleCostModalKeydown(e) {
    const modal = el('costModal');
    if (!modal.classList.contains('is-open')) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeCostModal();
        return;
    }
    if (e.key !== 'Tab') return;

    const focusable = [...modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((node) => !node.hasAttribute('disabled'));
    if (!focusable.length) {
        e.preventDefault();
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}
