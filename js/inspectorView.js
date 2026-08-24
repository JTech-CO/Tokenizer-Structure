import { el } from './dom.js';
import { state } from './state.js';
import { normalizeAnalysisOptions } from './analysisOptions.js';
import { tokenizeWith } from './tokenizer.js';
import {
    UNICODE_LENS_IDS,
    applyUnicodeLens,
    createInspectorExport,
    decodeShareState,
    diffCodePoints,
    encodeShareState,
    serializeInspectorCsv,
    serializeInspectorJson,
} from './inspectorDomain.js';

const COPY = Object.freeze({
    ko: {
        tab: 'Inspector', title: 'Inspector 옵션', optionNote: '이 옵션은 화면·JSON/CSV export·공유 복원에 같은 canonical 값으로 적용됩니다.',
        addSpecial: '특수 토큰 추가', textPair: '두 번째 텍스트 (선택)', padding: 'Padding', paddingNone: '없음', paddingMax: 'max length까지',
        paddingSide: 'Padding 방향', runtime: 'artifact 기본값', left: '왼쪽', right: '오른쪽', truncation: 'Truncation', maxLength: 'Max length', stride: 'Stride',
        strideHelp: 'v3.8.1 공개 tokenizer 호출에서 overflow stride 미지원', summary: '분석 요약', details: 'Token 상세',
        engine: '엔진', model: 'Artifact', tokens: '최종 Token IDs', revision: '고정 revision', roundtrip: 'Encode → decode', normalization: '원문 ↔ 정규화 diff',
        lenses: 'Unicode A/B 렌즈', baseline: '기준', variant: '변형', delta: '차이', noChange: '이 렌즈에서는 입력이 바뀌지 않았습니다.',
        exportJson: 'JSON 저장', exportCsv: 'CSV 저장', copyJson: 'JSON 복사', share: '공유 링크 복사', includeInput: '링크에 원문 포함',
        sharePrivate: '기본값은 원문을 링크에서 제외합니다.', copied: '클립보드에 복사했습니다.', downloaded: '파일을 저장했습니다.', failed: '작업을 완료하지 못했습니다.',
        real: '실제 artifact', heuristic: '교육용 폴백', sourceA: '입력 A', sourceB: '입력 B', sourceSpecial: '특수 토큰', sourcePadding: 'padding', sourceUnknown: 'source 미지원',
        unavailable: '미지원', raw: 'raw token', display: '표시', bytes: '표시 UTF-8 bytes', masks: 'attention / type', source: 'source', offsets: 'original / normalized offset',
        rt: {
            lossless: '원문과 정확히 일치합니다.', normalization: 'Unicode/모델 정규화로 달라졌지만 설명 가능한 차이입니다.',
            'unknown-token': 'UNK가 포함되어 정보 손실 가능성이 있습니다.', 'special-token-removal': 'decode에서 특수 토큰을 제거한 설명 가능한 차이입니다.',
            truncation: '설정한 truncation 때문에 뒤쪽 내용이 제거되었습니다.', other: '분류되지 않은 차이입니다. 아래 diff를 확인하세요.', unavailable: '실제 decode를 제공하지 않는 결과입니다.',
        },
    },
    en: {
        tab: 'Inspector', title: 'Inspector options', optionNote: 'The same canonical options drive the UI, JSON/CSV exports, and restored share state.',
        addSpecial: 'Add special tokens', textPair: 'Text pair (optional)', padding: 'Padding', paddingNone: 'None', paddingMax: 'To max length',
        paddingSide: 'Padding side', runtime: 'Artifact default', left: 'Left', right: 'Right', truncation: 'Truncation', maxLength: 'Max length', stride: 'Stride',
        strideHelp: 'Overflow stride is unavailable in the v3.8.1 public tokenizer call', summary: 'Analysis summary', details: 'Token details',
        engine: 'Engine', model: 'Artifact', tokens: 'Final Token IDs', revision: 'Pinned revision', roundtrip: 'Encode → decode', normalization: 'Raw ↔ normalized diff',
        lenses: 'Unicode A/B lenses', baseline: 'Baseline', variant: 'Variant', delta: 'Delta', noChange: 'This lens does not change the input.',
        exportJson: 'Save JSON', exportCsv: 'Save CSV', copyJson: 'Copy JSON', share: 'Copy share link', includeInput: 'Include raw input in link',
        sharePrivate: 'Raw input is excluded from links by default.', copied: 'Copied to the clipboard.', downloaded: 'Saved the file.', failed: 'The action could not be completed.',
        real: 'Real artifact', heuristic: 'Illustrative fallback', sourceA: 'Input A', sourceB: 'Input B', sourceSpecial: 'Special token', sourcePadding: 'Padding', sourceUnknown: 'Source unavailable',
        unavailable: 'Unavailable', raw: 'Raw token', display: 'Display', bytes: 'Display UTF-8 bytes', masks: 'attention / type', source: 'Source', offsets: 'original / normalized offset',
        rt: {
            lossless: 'The decoded text exactly matches the input.', normalization: 'A Unicode/model normalization difference is classified and expected.',
            'unknown-token': 'An UNK token may have lost information.', 'special-token-removal': 'The decoder removed special tokens; this is an expected classified difference.',
            truncation: 'Configured truncation removed trailing content.', other: 'Unclassified text change; inspect the diff below.', unavailable: 'This result does not provide a real decode.',
        },
    },
});

const LENS_LABELS = Object.freeze({
    ko: { spaces: '공백', nfc: 'NFC', nfd: 'NFD', case: '대소문자', emoji: 'Emoji', 'code-indentation': '코드 들여쓰기' },
    en: { spaces: 'Spaces', nfc: 'NFC', nfd: 'NFD', case: 'Case', emoji: 'Emoji', 'code-indentation': 'Code indentation' },
});

let reanalyze = () => {};

function setText(id, text) {
    el(id).textContent = text;
}

function unavailableText(claim) {
    const reason = claim?.unavailableReason || 'runtime-not-exposed';
    return `${COPY[state.lang].unavailable} (${reason})`;
}

function optionValue() {
    const maxRaw = el('optionMaxLength').value.trim();
    return normalizeAnalysisOptions({
        addSpecialTokens: el('optionAddSpecial').checked,
        textPair: el('optionTextPair').value,
        padding: el('optionPadding').value,
        paddingSide: el('optionPaddingSide').value,
        truncation: el('optionTruncation').checked,
        maxLength: maxRaw === '' ? null : Number(maxRaw),
        stride: 0,
    });
}

function syncOptionAvailability() {
    const paddingSupported = !state.currentTok || Number.isSafeInteger(state.currentTok.pad_token_id);
    el('optionPadding').disabled = !paddingSupported;
    el('optionPadding').title = paddingSupported
        ? ''
        : 'This artifact does not declare a pad token.';
    const needsLength = el('optionPadding').value === 'max-length' || el('optionTruncation').checked;
    el('optionMaxLength').disabled = !needsLength;
    if (el('optionPadding').value === 'max-length' && el('optionMaxLength').value === '') {
        el('optionMaxLength').value = '128';
    }
}

function commitOptions() {
    try {
        syncOptionAvailability();
        state.analysisOptions = optionValue();
        el('inspectorOptionStatus').textContent = '';
        reanalyze();
    } catch (error) {
        el('inspectorOptionStatus').textContent = error.message;
    }
}

export function syncInspectorControls() {
    const options = normalizeAnalysisOptions(state.analysisOptions);
    el('optionAddSpecial').checked = options.addSpecialTokens;
    el('optionTextPair').value = options.textPair || '';
    el('optionPadding').value = options.padding;
    el('optionPaddingSide').value = options.paddingSide;
    el('optionTruncation').checked = options.truncation;
    el('optionMaxLength').value = options.maxLength === null ? '' : String(options.maxLength);
    syncOptionAvailability();
}

function renderDiff(container, before, after) {
    container.innerHTML = '';
    try {
        const diff = diffCodePoints(before, after);
        for (const segment of diff.segments) {
            const span = document.createElement('span');
            span.textContent = segment.value;
            if (segment.type === 'delete') span.className = 'diff-delete';
            if (segment.type === 'insert') span.className = 'diff-insert';
            container.appendChild(span);
        }
    } catch {
        container.textContent = `${before}\n→\n${after}`;
    }
}

function summaryCard(label, value) {
    const card = document.createElement('div');
    card.className = 'summary-card';
    const key = document.createElement('span');
    key.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = value;
    card.append(key, strong);
    return card;
}

function renderSummary(result) {
    const L = COPY[state.lang];
    const summary = el('inspectorSummary');
    summary.innerHTML = '';
    summary.append(
        summaryCard(L.engine, result.engine === 'real' ? L.real : L.heuristic),
        summaryCard(L.model, result.modelId || result.requestedModelId || '—'),
        summaryCard(L.tokens, String(result.ids.length)),
        summaryCard(L.revision, result.provenance.artifact?.revision || '—'),
    );

    const roundTrip = result.roundTrip;
    setText('roundTripClassification', L.rt[roundTrip.classification] || L.rt.other);
    const decoded = roundTrip.decoded;
    const box = el('roundTripDiff');
    if (decoded === null) {
        box.textContent = unavailableText({ unavailableReason: roundTrip.unavailableReason });
    } else {
        renderDiff(box, result.input.text, decoded);
    }
    renderDiff(el('normalizationDiff'), result.input.text, result.normalized);
}

function hexBytes(value) {
    return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function sourceFor(result, index) {
    const encoding = result.encoding;
    const L = COPY[state.lang];
    if (encoding.specialTokenMask?.[index] === 1) return L.sourceSpecial;
    if (encoding.attentionMask?.[index] === 0) return L.sourcePadding;
    if (encoding.tokenTypeIds?.[index] === 1) return L.sourceB;
    if (result.options.textPair !== null && encoding.tokenTypeIds === null) return L.sourceUnknown;
    return L.sourceA;
}

function maskFor(result, index) {
    const attention = result.encoding.attentionMask;
    const types = result.encoding.tokenTypeIds;
    const a = attention === null ? '—' : attention[index];
    const t = types === null ? '—' : types[index];
    return `${a} / ${t}`;
}

function offsetFor(result, index) {
    const encoding = result.encoding;
    if (encoding.originalOffsets && encoding.normalizedOffsets) {
        return `${encoding.originalOffsets[index]?.join('..') || '—'} / ${encoding.normalizedOffsets[index]?.join('..') || '—'}`;
    }
    return unavailableText(encoding.availability.originalOffsets);
}

function appendCell(row, value, className = '') {
    const cell = document.createElement('td');
    cell.textContent = value === '' ? '∅' : String(value);
    if (className) cell.className = className;
    row.appendChild(cell);
}

function renderTokenDetails(result) {
    const body = el('inspectorTokenRows');
    body.innerHTML = '';
    result.ids.forEach((id, index) => {
        const row = document.createElement('tr');
        appendCell(row, index);
        appendCell(row, id);
        appendCell(row, result.finalTokens[index]);
        appendCell(row, result.finDisplay[index]);
        appendCell(row, hexBytes(result.finDisplay[index]) || '—');
        appendCell(row, maskFor(result, index));
        appendCell(row, sourceFor(result, index));
        appendCell(row, offsetFor(result, index), result.encoding.originalOffsets ? '' : 'detail-unavailable');
        body.appendChild(row);
    });
}

function renderLens(result) {
    const lens = state.inspectorLens;
    const variantText = applyUnicodeLens(result.input.text, lens);
    const box = el('lensResult');
    box.innerHTML = '';
    if (variantText === result.input.text) {
        box.textContent = COPY[state.lang].noChange;
        return;
    }
    const variant = tokenizeWith(state.currentTok, variantText, state.currentModelId, state.analysisOptions);
    const delta = variant.ids.length - result.ids.length;
    const text = document.createElement('div');
    text.className = 'text-diff';
    renderDiff(text, result.input.text, variantText);
    const summary = document.createElement('p');
    summary.className = 'p1-note';
    summary.textContent = `${COPY[state.lang].baseline}: ${result.ids.length} · ${COPY[state.lang].variant}: ${variant.ids.length} · ${COPY[state.lang].delta}: ${delta > 0 ? '+' : ''}${delta}`;
    box.append(text, summary);
}

export function renderInspector(result = state.lastResult) {
    syncOptionAvailability();
    if (!result) {
        el('inspectorSummary').textContent = '—';
        el('inspectorTokenRows').innerHTML = '';
        return;
    }
    renderSummary(result);
    renderTokenDetails(result);
    renderLens(result);
}

async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard API unavailable');
}

function setActionStatus(message, failed = false) {
    const status = el('inspectorActionStatus');
    status.textContent = message;
    status.style.color = failed ? '#991b1b' : '#166534';
}

function downloadText(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function currentExport() {
    if (!state.lastResult) throw new Error('No analysis result');
    return createInspectorExport(state.lastResult);
}

async function runAction(action) {
    const L = COPY[state.lang];
    try {
        if (action === 'json') {
            downloadText('tokenizer-inspector.json', serializeInspectorJson(currentExport()), 'application/json;charset=utf-8');
            setActionStatus(L.downloaded);
        } else if (action === 'csv') {
            downloadText('tokenizer-inspector.csv', serializeInspectorCsv(currentExport()), 'text/csv;charset=utf-8');
            setActionStatus(L.downloaded);
        } else if (action === 'copy') {
            await writeClipboard(serializeInspectorJson(currentExport()));
            setActionStatus(L.copied);
        } else if (action === 'share') {
            const query = encodeShareState({
                modelId: state.currentModelId,
                view: 'inspector',
                lens: state.inspectorLens,
                lang: state.lang,
                options: state.analysisOptions,
                text: el('inputText').value,
            }, { includeInput: el('shareIncludeInput').checked });
            const url = new URL(window.location.href);
            url.search = query;
            url.hash = '';
            await writeClipboard(url.toString());
            setActionStatus(L.copied);
        }
    } catch (error) {
        console.warn('Inspector action failed:', error);
        setActionStatus(`${L.failed} ${error.message}`, true);
    }
}

function buildLensButtons() {
    const container = el('inspectorLenses');
    container.innerHTML = '';
    for (const lens of UNICODE_LENS_IDS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'p1-button';
        button.dataset.lens = lens;
        button.textContent = LENS_LABELS[state.lang][lens];
        button.classList.toggle('is-active', state.inspectorLens === lens);
        button.setAttribute('aria-pressed', String(state.inspectorLens === lens));
        button.addEventListener('click', () => {
            state.inspectorLens = lens;
            buildLensButtons();
            renderInspector();
        });
        container.appendChild(button);
    }
}

export function applyInspectorLanguage() {
    const L = COPY[state.lang];
    setText('tabInspector', L.tab);
    setText('inspectorOptionsTitle', L.title);
    setText('inspectorOptionsNote', L.optionNote);
    setText('labelAddSpecial', L.addSpecial);
    setText('labelTextPair', L.textPair);
    setText('labelPadding', L.padding);
    setText('paddingNoneOption', L.paddingNone);
    setText('paddingMaxOption', L.paddingMax);
    setText('labelPaddingSide', L.paddingSide);
    setText('paddingRuntimeOption', L.runtime);
    setText('paddingLeftOption', L.left);
    setText('paddingRightOption', L.right);
    setText('labelTruncation', L.truncation);
    setText('labelMaxLength', L.maxLength);
    setText('labelStride', L.stride);
    setText('strideHelp', L.strideHelp);
    setText('inspectorSummaryTitle', L.summary);
    setText('inspectorDetailsTitle', L.details);
    setText('roundTripTitle', L.roundtrip);
    setText('normalizationDiffTitle', L.normalization);
    setText('lensTitle', L.lenses);
    setText('exportJsonBtn', L.exportJson);
    setText('exportCsvBtn', L.exportCsv);
    setText('copyJsonBtn', L.copyJson);
    setText('shareBtn', L.share);
    setText('shareIncludeLabel', L.includeInput);
    setText('sharePrivacyNote', L.sharePrivate);
    const headers = [L.raw, L.display, L.bytes, L.masks, L.source, L.offsets];
    ['tokenRawHead', 'tokenDisplayHead', 'tokenBytesHead', 'tokenMasksHead', 'tokenSourceHead', 'tokenOffsetsHead']
        .forEach((id, index) => setText(id, headers[index]));
    buildLensButtons();
    if (state.lastResult) renderInspector();
}

export function restoreInspectorShare(search) {
    const restored = decodeShareState(search);
    if (!restored) return null;
    return restored;
}

export function initInspector(options = {}) {
    reanalyze = typeof options.reanalyze === 'function' ? options.reanalyze : () => {};
    syncInspectorControls();
    ['optionAddSpecial', 'optionPadding', 'optionPaddingSide', 'optionTruncation', 'optionMaxLength']
        .forEach((id) => el(id).addEventListener('change', commitOptions));
    el('optionTextPair').addEventListener('change', commitOptions);
    el('exportJsonBtn').addEventListener('click', () => void runAction('json'));
    el('exportCsvBtn').addEventListener('click', () => void runAction('csv'));
    el('copyJsonBtn').addEventListener('click', () => void runAction('copy'));
    el('shareBtn').addEventListener('click', () => void runAction('share'));
    applyInspectorLanguage();
}
