// matrix.js — 언어 효율 매트릭스 뷰 (동일 의미 문장 × 모델 토큰 수)
import { el } from './dom.js';
import { i18n } from './i18n.js';
import { state } from './state.js';
import { MODELS, loadTokenizer, tokenizeWith } from './tokenizer.js';

const MATRIX_SAMPLES = [
    { lang: '한국어', text: '인공지능은 세상을 빠르게 바꾸고 있습니다.' },
    { lang: 'English', text: 'Artificial intelligence is rapidly changing the world.' },
    { lang: '日本語', text: '人工知能は世界を急速に変えています。' },
    { lang: '中文', text: '人工智能正在迅速改变世界。' },
    { lang: 'Español', text: 'La inteligencia artificial está cambiando el mundo.' },
    { lang: 'Code', text: 'for (let i = 0; i < n; i++) { sum += arr[i]; }' },
    { lang: 'Emoji', text: '🤗🚀🌍🔥✨🎉👍💡🧠⚡' },
];

// 행 내 토큰수 상대 색 (적음=초록 효율, 많음=빨강 비효율)
function matrixCellColor(val, min, max) {
    if (max === min) return 'hsl(90, 60%, 85%)';
    const t = (val - min) / (max - min);
    const hue = (1 - t) * 120;
    return `hsl(${hue}, 65%, 82%)`;
}

function shortLabel(label) {
    return label.replace(/\s*·.*$/, '');
}

function renderMatrix(rows) {
    const L = i18n[state.lang];
    const t = el('matrixTable');
    let html = '<thead><tr><th>' + L.matrixLang + '</th>';
    MODELS.forEach((m) => (html += '<th>' + shortLabel(m.label) + '</th>'));
    html += '</tr></thead><tbody>';
    rows.forEach((r) => {
        const min = Math.min(...r.cells);
        const max = Math.max(...r.cells);
        html +=
            '<tr><th>' + r.lang +
            ' <span style="font-weight:400;opacity:.55">' + r.chars + L.matrixChars + '</span></th>';
        r.cells.forEach((v) => {
            html += '<td class="matrix-cell" style="background-color:' + matrixCellColor(v, min, max) + '">' + v + '</td>';
        });
        html += '</tr>';
    });
    html += '</tbody>';
    t.innerHTML = html;
}

export async function ensureMatrix() {
    const L = i18n[state.lang];
    const status = el('matrixStatus');
    if (state.matrixBuilt) {
        status.textContent = L.matrixTitle;
        return;
    }
    const toks = {};
    for (let i = 0; i < MODELS.length; i++) {
        const m = MODELS[i];
        status.textContent = `${L.matrixLoading} ${i + 1}/${MODELS.length} · ${m.label}…`;
        try {
            toks[m.id] = await loadTokenizer(m.id);
        } catch (e) {
            toks[m.id] = null;
            console.warn('matrix tokenizer load failed', m.id, e);
        }
    }
    const rows = MATRIX_SAMPLES.map((s) => ({
        lang: s.lang,
        chars: [...s.text].length,
        cells: MODELS.map((m) => tokenizeWith(toks[m.id], s.text).ids.length),
    }));
    renderMatrix(rows);
    state.matrixBuilt = true;
    status.textContent = L.matrixTitle;
}
