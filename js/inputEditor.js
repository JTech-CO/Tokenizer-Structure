import { el } from './dom.js';
import { analyzeInput } from './inspectorDomain.js';

const COPY = Object.freeze({
    ko: {
        metrics: ({ lines, characters, utf8Bytes }) => `${lines}줄 · ${characters.toLocaleString()} code points · ${utf8Bytes.toLocaleString()} UTF-8 bytes`,
        remaining: ({ characters, utf8Bytes }) => `남음: ${characters.toLocaleString()} code points · ${utf8Bytes.toLocaleString()} bytes`,
        large: '대형 입력입니다. 분석과 모델 로드에 시간이 더 걸릴 수 있습니다.',
        exceeded: '입력 제한을 초과했습니다. 제한 안으로 줄이면 분석을 다시 시작합니다.',
    },
    en: {
        metrics: ({ lines, characters, utf8Bytes }) => `${lines} lines · ${characters.toLocaleString()} code points · ${utf8Bytes.toLocaleString()} UTF-8 bytes`,
        remaining: ({ characters, utf8Bytes }) => `Remaining: ${characters.toLocaleString()} code points · ${utf8Bytes.toLocaleString()} bytes`,
        large: 'Large input: analysis and tokenizer loading may take longer.',
        exceeded: 'Input limits exceeded. Reduce the text to resume analysis.',
    },
});

let lastStatus = null;

function lineNumbers(lines) {
    return Array.from({ length: lines }, (_, index) => String(index + 1)).join('\n');
}

export function syncInputEditorScroll() {
    const input = el('inputText');
    el('inputLineNumbers').scrollTop = input.scrollTop;
}

export function updateInputEditor(lang = 'ko') {
    const input = el('inputText');
    const status = analyzeInput(input.value);
    lastStatus = status;
    el('inputLineNumbers').textContent = lineNumbers(status.metrics.lines);
    el('inputMetrics').textContent = COPY[lang].metrics(status.metrics);
    el('inputRemaining').textContent = COPY[lang].remaining(status.remaining);
    const warning = el('inputWarning');
    warning.textContent = status.accepted
        ? status.largeInput ? COPY[lang].large : ''
        : COPY[lang].exceeded;
    input.setAttribute('aria-invalid', String(!status.accepted));
    return status;
}

export function getLastInputStatus() {
    return lastStatus;
}
