// costModal.js — 전 모델 비용 일괄표 모달 (제공사 그룹 + 정렬)
import { el } from './dom.js';
import { i18n } from './i18n.js';
import { state } from './state.js';
import { tokenizeWith } from './tokenizer.js';
import { PRICING, PRICING_AS_OF, ratesFor, costOf, formatUSD, formatInt } from './pricing.js';

const PROVIDER_ORDER = ['OpenAI', 'Google', 'Anthropic'];
const PROVIDER_COLORS = {
    OpenAI: 'hsl(150, 55%, 90%)',    // 민트
    Google: 'hsl(210, 70%, 91%)',    // 연하늘
    Anthropic: 'hsl(28, 78%, 90%)',  // 살구
};

function renderCostTable(tokens) {
    const L = i18n[state.lang];
    const rows = PRICING.map((p) => {
        const rates = ratesFor(p, tokens);
        return {
            p,
            cur: costOf(rates.input, tokens),
            k1: costOf(rates.input, 1000),
            k100: costOf(rates.input, 100000),
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
        '<th class="ct-sort" title="' + L.ctSortHint + '">' + tokens + ' tok' + arrow + '</th>' +
        '<th>1K</th><th>100K</th><th>' + L.ctContext + '</th></tr></thead><tbody>';
    rows.forEach(({ p, cur, k1, k100 }) => {
        const bg = PROVIDER_COLORS[p.provider] || '#ffffff';
        html +=
            '<tr style="background-color:' + bg + '">' +
            '<td class="ct-name">' + p.name + (p.tiered ? ' *' : '') + '</td>' +
            '<td>' + p.provider + '</td>' +
            '<td>$' + p.input.toFixed(2) + '</td>' +
            '<td><b>' + formatUSD(cur) + '</b></td>' +
            '<td>' + formatUSD(k1) + '</td>' +
            '<td>' + formatUSD(k100) + '</td>' +
            '<td>' + formatInt(p.context) + '</td></tr>';
    });
    html += '</tbody>';
    el('costTable').innerHTML = html;
    el('costModalSub').textContent = `${tokens} ${L.tokensSuffix} ${L.costInputWord} · ${L.costAsOf} ${PRICING_AS_OF}`;
}

function updateSortBtns() {
    document.querySelectorAll('#costSortBtns .sort-btn').forEach((b) =>
        b.classList.toggle('is-active', b.dataset.sort === state.costSortMode)
    );
}

export function setCostSort(mode) {
    state.costSortMode = mode;
    renderCostTable(state.lastCostTokens);
    updateSortBtns();
}

export function toggleCostSort() {
    setCostSort(state.costSortMode === 'provider' ? 'asc' : state.costSortMode === 'asc' ? 'desc' : 'provider');
}

export function openCostModal() {
    const input = el('inputText').value;
    const r = input.trim() ? tokenizeWith(state.currentTok, input) : null;
    state.lastCostTokens = r ? r.ids.length : 0;
    renderCostTable(state.lastCostTokens);
    updateSortBtns();
    el('costModal').classList.add('is-open');
}

export function closeCostModal() {
    el('costModal').classList.remove('is-open');
}
