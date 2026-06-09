// presets.js — 입력 프리셋 버튼
import { el } from './dom.js';
import { state } from './state.js';

const PRESETS = [
    { ko: '이모지', en: 'Emoji', text: '🤗🚀🌍🔥✨🎉👍💡🧠⚡' },
    { ko: '코드', en: 'Code', text: 'function add(a, b) { return a + b; }' },
    { ko: '다국어', en: 'Multilingual', text: 'Hello 안녕하세요 こんにちは 你好 مرحبا Привет' },
    { ko: '특수문자', en: 'Symbols', text: '①②③ ™®© ½¼¾ €£¥₩ →←↑↓ ∑∏∫' },
    { ko: '긴 단어', en: 'Long word', text: 'Pneumonoultramicroscopicsilicovolcanoconiosis' },
    { ko: 'URL', en: 'URL', text: 'https://example.com/path?query=value&id=42' },
];

// onSelect: 입력 적용 후 호출할 콜백 (main의 onInput)
export function buildPresets(onSelect) {
    const box = el('presetBtns');
    box.innerHTML = '';
    PRESETS.forEach((p) => {
        const b = document.createElement('button');
        b.className = 'preset-btn';
        b.textContent = state.lang === 'ko' ? p.ko : p.en;
        b.addEventListener('click', () => {
            el('inputText').value = p.text;
            if (onSelect) onSelect();
        });
        box.appendChild(b);
    });
}
