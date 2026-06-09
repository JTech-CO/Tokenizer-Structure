// pipeline.js — 파이프라인 뷰: 엔진 로드 + 4단계 렌더 + 분석 지표(효율·비용·게이지)
import { el, escapeHtml, createTokenBadge, heatColor } from './dom.js';
import { i18n } from './i18n.js';
import { state } from './state.js';
import { MODELS, loadTokenizer, tokenizeReal, tokenizeHeuristic, isSpecialToken } from './tokenizer.js';
import { PRICING, ratesFor, costOf, formatUSD, formatInt } from './pricing.js';

// 토크나이저 모델 드롭다운
export function buildModelSelect() {
    const sel = el('modelSelect');
    sel.innerHTML = '';
    MODELS.forEach((m) => {
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = m.label;
        sel.appendChild(o);
    });
    sel.value = state.currentModelId;
}

// 비용 모델 드롭다운 (프로바이더별 optgroup)
export function buildCostSelect() {
    const sel = el('costModelSelect');
    sel.innerHTML = '';
    const groups = {};
    PRICING.forEach((p) => {
        (groups[p.provider] = groups[p.provider] || []).push(p);
    });
    Object.keys(groups).forEach((prov) => {
        const og = document.createElement('optgroup');
        og.label = prov;
        groups[prov].forEach((p) => {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = p.name;
            og.appendChild(o);
        });
        sel.appendChild(og);
    });
    sel.value = state.costModelId;
}

// 엔진 상태 배지 갱신
export function setEngineStatus(kind, frac) {
    const node = el('engineStatus');
    const L = i18n[state.lang];
    node.classList.remove('is-loading', 'is-real', 'is-fallback');
    if (kind === 'loading') {
        node.classList.add('is-loading');
        const pct = typeof frac === 'number' && isFinite(frac) ? ` ${Math.round(frac * 100)}%` : '…';
        node.textContent = `${L.engineLoading}${pct}`;
    } else if (kind === 'real') {
        node.classList.add('is-real');
        node.textContent = `${L.engineReal} · ${state.currentModelId.split('/').pop()}`;
    } else {
        node.classList.add('is-fallback');
        node.textContent = L.engineFallback;
    }
}

// 현재 모델의 토크나이저 확보 (로드/캐시). 실패 시 폴백 상태로 전환
export async function ensureTokenizer() {
    if (state.loading) return;
    if (state.currentTok && state.currentTok.__modelId === state.currentModelId) return;
    state.loading = true;
    state.currentTok = null;
    setEngineStatus('loading');
    try {
        const tok = await loadTokenizer(state.currentModelId, (frac) => setEngineStatus('loading', frac));
        state.currentTok = tok;
        setEngineStatus('real');
    } catch (e) {
        state.currentTok = null;
        setEngineStatus('fallback');
        console.warn('Tokenizer load failed, using heuristic fallback:', e);
    } finally {
        state.loading = false;
    }
}

// 4단계 결과 + 분석 지표 렌더
export function render(result) {
    state.lastResult = result;
    const L = i18n[state.lang];
    const input = el('inputText').value;

    const step1Box = el('step1Output');
    const step2Box = el('step2Output');
    const step3Box = el('step3Output');
    const step4Box = el('step4Output');
    const finalBox = el('finalOutput');
    const countBox = el('tokenCount');

    step1Box.innerHTML = '';
    step2Box.innerHTML = '';
    step3Box.innerHTML = '';
    step4Box.innerHTML = '';
    finalBox.innerHTML = '';

    const { normalized, pieces, finalTokens, ids, preDisplay, finDisplay } = result;

    // 1. Normalization + 토큰↔원문 매핑
    const mapHtml = pieces
        .map((pc, i) => `<span class="map-tok" data-ti="${i}">${escapeHtml(pc.surface) || '∅'}</span>`)
        .join('');
    step1Box.innerHTML =
        `${L.originalText} <br><span class="opacity-60">${escapeHtml(input)}</span>` +
        `<br><br>${L.normalizedText}<br><span>${escapeHtml(normalized)}</span>` +
        `<br><br>${L.mapLabel}<br><div class="map-text">${mapHtml}</div>`;

    // 2. Pre-tokenization (무채색, 디코딩 표시)
    preDisplay.forEach((s) => step2Box.appendChild(createTokenBadge(s, '', true)));

    // 3. Subword (색 또는 히트맵) + 매핑 인덱스
    pieces.forEach((pc, i) => {
        const badge = createTokenBadge(pc.surface, pc.token, false);
        badge.dataset.ti = i;
        if (state.heatmapOn) {
            badge.style.backgroundColor = heatColor(pc.len);
            badge.title = `${pc.len} ${L.effCharPerTok}`;
        }
        step3Box.appendChild(badge);
    });

    // 4. Post-processing (색 + 특수 토큰 점선)
    finDisplay.forEach((s, i) => {
        const badge = createTokenBadge(s, finalTokens[i], false);
        if (isSpecialToken(finalTokens[i])) badge.style.borderStyle = 'dashed';
        step4Box.appendChild(badge);
    });

    // 5. Token IDs
    const idString = `[ ${ids
        .map((id, i) =>
            isSpecialToken(finalTokens[i])
                ? `<span style="text-decoration: underline;">${id}</span>`
                : `<span>${id}</span>`
        )
        .join(', ')} ]`;
    finalBox.innerHTML = idString;
    countBox.textContent = `${L.totalPrefix} ${ids.length} ${L.tokensSuffix}`;

    // 6. 분석 지표
    renderEfficiency(result);
    renderCost(result);

    // 7. 단계 순차 애니메이션
    if (state.animOn) playStageAnim();
}

function renderEfficiency(result) {
    const L = i18n[state.lang];
    const box = el('efficiencyOutput');
    const text = el('inputText').value;
    const chars = [...text].length;
    const bytes = new TextEncoder().encode(text).length;
    const tokens = result.pieces.length;
    const total = result.ids.length;
    const cpt = tokens ? chars / tokens : 0;
    const bpt = tokens ? bytes / tokens : 0;
    box.innerHTML =
        `<div class="eff-row"><span>${L.effChars}</span><b>${chars}</b></div>` +
        `<div class="eff-row"><span>${L.effBytes}</span><b>${bytes}</b></div>` +
        `<div class="eff-row"><span>${L.effTokens}</span><b>${tokens} <span class="eff-dim">(+${total - tokens} ${L.effSpecial})</span></b></div>` +
        `<div class="eff-row"><span>${L.effRatio}</span><b>${cpt.toFixed(2)} ${L.effCharPerTok}</b></div>` +
        `<div class="eff-row"><span>${L.effBpt}</span><b>${bpt.toFixed(2)}</b></div>` +
        `<div class="heat-legend"><span>${L.heatLow}</span><span class="heat-bar"></span><span>${L.heatHigh}</span></div>` +
        ctxGaugeHtml(total);
}

// 컨텍스트 윈도우 게이지 (현재 토큰 / 현재 모델 max context)
function ctxGaugeHtml(total) {
    const L = i18n[state.lang];
    const model = MODELS.find((m) => m.id === state.currentModelId);
    const ctx = model ? model.context : 0;
    const pct = ctx ? Math.min(100, (total / ctx) * 100) : 0;
    const pctShow = total > 0 && pct < 0.1 ? '<0.1' : pct.toFixed(pct < 1 ? 3 : 1);
    return (
        '<div class="ctx-gauge">' +
        `<div class="ctx-head"><span>${L.ctxWindow}</span><span>${total} / ${formatInt(ctx)}</span></div>` +
        `<div class="ctx-bar"><div class="ctx-fill" style="width:${Math.max(pct, total > 0 ? 0.5 : 0)}%"></div></div>` +
        `<div class="ctx-pct">${pctShow}%</div></div>`
    );
}

// API 비용 환산 (footer 카드)
export function renderCost(result) {
    const L = i18n[state.lang];
    const box = el('costOutput');
    const entry = PRICING.find((p) => p.id === state.costModelId) || PRICING[0];
    const tokens = result ? result.ids.length : 0;
    const rates = ratesFor(entry, tokens);
    const cur = costOf(rates.input, tokens);
    const k1 = costOf(rates.input, 1000);
    const k100 = costOf(rates.input, 100000);
    box.innerHTML =
        `<div class="cost-row"><span>${L.costInputRate}</span><b>$${entry.input.toFixed(2)} /1M</b></div>` +
        `<div class="cost-row"><span>${L.costOutputRate}</span><b>$${entry.output.toFixed(2)} /1M</b></div>` +
        `<div class="cost-row"><span>${L.costContext}</span><b>${formatInt(entry.context)}</b></div>` +
        `<hr class="cost-hr">` +
        `<div class="cost-row cost-main"><span>${tokens} ${L.tokensSuffix} ${L.costInputWord}</span><b>${formatUSD(cur)}</b></div>` +
        `<div class="cost-sub">1K ≈ ${formatUSD(k1)} · 100K ≈ ${formatUSD(k100)}</div>` +
        (entry.tiered
            ? `<div class="cost-note">&gt;${formatInt(entry.tiered.threshold)} ${L.costTieredNote}: $${entry.tiered.input.toFixed(2)}/$${entry.tiered.output.toFixed(2)}</div>`
            : '');
}

export function clearAnalysis() {
    ['step1Output', 'step2Output', 'step3Output', 'step4Output', 'finalOutput', 'efficiencyOutput', 'costOutput'].forEach(
        (id) => (el(id).innerHTML = '')
    );
    el('tokenCount').textContent = `0 ${i18n[state.lang].tokensSuffix}`;
}

export function processText() {
    const input = el('inputText').value;
    if (!input.trim()) {
        clearAnalysis();
        state.lastResult = null;
        return;
    }
    let result;
    if (state.currentTok) {
        try {
            result = tokenizeReal(state.currentTok, input);
        } catch (e) {
            console.warn('Real tokenization failed, heuristic fallback:', e);
            result = tokenizeHeuristic(input);
        }
    } else {
        result = tokenizeHeuristic(input);
    }
    render(result);
}

export function playStageAnim() {
    const m = document.querySelector('main');
    m.classList.remove('anim');
    void m.offsetWidth; // 리플로우로 애니메이션 재시작
    m.classList.add('anim');
}
