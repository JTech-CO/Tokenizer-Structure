// dom.js — DOM 유틸 + 토큰 배지/색상
import { isSpecialToken } from './tokenizer.js';

export const el = (id) => document.getElementById(id);

// HTML 이스케이프 (innerHTML 주입 안전)
export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}

// 문자열 → 밝고 고대비인 HSL 색 (특수 토큰은 회색)
export function stringToColor(str) {
    if (isSpecialToken(str)) return 'hsl(0, 0%, 90%)';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 100%, 85%)`;
}

// 토큰당 문자수 → 효율 히트 색 (1자=빨강 비효율, 6자+=초록 효율)
export function heatColor(len) {
    const t = Math.min(Math.max(len, 1), 6);
    const hue = ((t - 1) / 5) * 130;
    return `hsl(${hue}, 70%, 78%)`;
}

// 토큰 배지 생성 (surface=표시문자열, colorRaw=색 결정용 raw 토큰)
export function createTokenBadge(surface, colorRaw, skipColor = false) {
    const span = document.createElement('span');
    span.className = 'token-badge';
    span.textContent = surface === '' ? '∅' : surface;

    if (!skipColor) {
        span.style.backgroundColor = stringToColor(String(colorRaw));
        span.style.color = '#000000';
        span.style.borderColor = '#000000';
    } else {
        span.style.backgroundColor = 'transparent';
        span.style.color = '#000000';
        span.style.borderColor = '#000000';
    }
    return span;
}
