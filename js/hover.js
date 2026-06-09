// hover.js — token↔원문 양방향 하이라이트 (data-ti 매핑)
import { el } from './dom.js';

function hlToken(ti, on) {
    document.querySelectorAll('[data-ti="' + ti + '"]').forEach((e) => e.classList.toggle('tok-hl', on));
}

// step1 매핑 텍스트 ↔ step3 서브워드 배지 hover 동기화 (위임)
export function setupHoverSync() {
    [el('step1Output'), el('step3Output')].forEach((c) => {
        c.addEventListener('mouseover', (e) => {
            const t = e.target.closest('[data-ti]');
            if (t) hlToken(t.dataset.ti, true);
        });
        c.addEventListener('mouseout', (e) => {
            const t = e.target.closest('[data-ti]');
            if (t) hlToken(t.dataset.ti, false);
        });
    });
}
