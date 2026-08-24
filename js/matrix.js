// matrix.js — 입력 샘플별 토큰 수 매트릭스 뷰
import { el } from './dom.js';
import { i18n } from './i18n.js';
import { state } from './state.js';
import { MODELS, loadTokenizer, tokenizeReal } from './tokenizer.js';

const MATRIX_SAMPLES = [
    { lang: '한국어', text: '인공지능은 세상을 빠르게 바꾸고 있습니다.' },
    { lang: 'English', text: 'Artificial intelligence is rapidly changing the world.' },
    { lang: '日本語', text: '人工知能は世界を急速に変えています。' },
    { lang: '中文', text: '人工智能正在迅速改变世界。' },
    { lang: 'Español', text: 'La inteligencia artificial está cambiando rápidamente el mundo.' },
    { lang: 'Code', text: 'for (let i = 0; i < n; i++) { sum += arr[i]; }' },
    { lang: 'Emoji', text: '🤗🚀🌍🔥✨🎉👍💡🧠⚡' },
];

let cachedRows = null;
let failedModels = 0;
let matrixPromise = null;

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
        const values = r.cells.filter(Number.isFinite);
        const min = values.length ? Math.min(...values) : 0;
        const max = values.length ? Math.max(...values) : 0;
        html +=
            '<tr><th>' + r.lang +
            ' <span style="font-weight:400;opacity:.55">' + r.chars + L.matrixChars + '</span></th>';
        r.cells.forEach((v, modelIndex) => {
            if (!Number.isFinite(v)) {
                const unavailable = shortLabel(MODELS[modelIndex].label) + ': ' + L.matrixUnavailable;
                html += '<td class="matrix-cell matrix-unavailable" title="' + unavailable + '" aria-label="' + unavailable + '">—</td>';
            } else {
                html += '<td class="matrix-cell" style="background-color:' + matrixCellColor(v, min, max) + '">' + v + '</td>';
            }
        });
        html += '</tr>';
    });
    html += '</tbody>';
    t.innerHTML = html;
}

function setMatrixStatus() {
    const L = i18n[state.lang];
    const suffix = failedModels ? ` · ${failedModels} ${L.matrixUnavailable}` : '';
    el('matrixStatus').textContent = L.matrixTitle + suffix;
}

export async function ensureMatrix() {
    const status = el('matrixStatus');
    if (cachedRows) {
        renderMatrix(cachedRows);
        setMatrixStatus();
        if (state.matrixBuilt) return;
    }
    if (matrixPromise) return matrixPromise;

    matrixPromise = (async () => {
        const toks = {};
        failedModels = 0;
        for (let i = 0; i < MODELS.length; i++) {
            const m = MODELS[i];
            status.textContent = `${i18n[state.lang].matrixLoading} ${i + 1}/${MODELS.length} · ${m.label}…`;
            try {
                toks[m.id] = await loadTokenizer(m.id);
            } catch (e) {
                toks[m.id] = null;
                failedModels += 1;
                console.warn('matrix tokenizer load failed', m.id, e);
            }
        }
        const counts = {};
        for (const model of MODELS) {
            if (!toks[model.id]) {
                counts[model.id] = null;
                continue;
            }
            try {
                counts[model.id] = MATRIX_SAMPLES.map((sample) =>
                    tokenizeReal(toks[model.id], sample.text).ids.length
                );
            } catch (error) {
                counts[model.id] = null;
                failedModels += 1;
                console.warn('matrix tokenization failed', model.id, error);
            }
        }
        cachedRows = MATRIX_SAMPLES.map((sample, rowIndex) => ({
            lang: sample.lang,
            chars: [...sample.text].length,
            cells: MODELS.map((model) =>
                counts[model.id] ? counts[model.id][rowIndex] : null
            ),
        }));
        renderMatrix(cachedRows);
        state.matrixBuilt = failedModels === 0;
        setMatrixStatus();
    })();

    try {
        await matrixPromise;
    } finally {
        matrixPromise = null;
    }
}
