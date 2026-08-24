// hover.js — 두 토큰 조각 표시 영역의 같은 data-ti 항목을 동기화
import { el } from './dom.js';

function hlToken(ti, on) {
    document.querySelectorAll('[data-ti="' + ti + '"]').forEach((e) => e.classList.toggle('tok-hl', on));
}

function syncFromEvent(e, on) {
    const target = e.target instanceof Element ? e.target.closest('[data-ti]') : null;
    if (target) hlToken(target.dataset.ti, on);
}

export function setupHoverSync() {
    [el('step1Output'), el('step3Output')].forEach((container) => {
        container.addEventListener('mouseover', (e) => syncFromEvent(e, true));
        container.addEventListener('mouseout', (e) => syncFromEvent(e, false));
        container.addEventListener('focusin', (e) => syncFromEvent(e, true));
        container.addEventListener('focusout', (e) => syncFromEvent(e, false));
    });
}
