import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'llm_tokenizer_simulator.html'), 'utf8');
const read = (relative) => readFileSync(resolve(root, relative), 'utf8');

test('the operate tab and panel live inside the single main landmark', () => {
    const tabButton = html.match(/<button[^>]*id="tabOperate"[^>]*>/);
    assert.ok(tabButton, 'Missing the operate tab button');
    assert.match(tabButton[0], /role="tab"/);
    assert.match(tabButton[0], /aria-controls="operateView"/);
    assert.match(html, /<div id="operateView"[^>]*role="tabpanel"[^>]*aria-labelledby="tabOperate"/);
    assert.match(html, /href="css\/p4\.css"/);

    const container = html.slice(html.indexOf('<main id="viewContainer"'), html.indexOf('</main>'));
    assert.ok(container.includes('id="operateView"'));

    for (const id of [
        'operateStorage', 'operateStorageActions', 'operateStatus', 'operateRefreshBtn',
        'operateArtifacts', 'operateCustomFiles', 'operateCustomResult', 'operateFreshness',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `Missing operate element: ${id}`);
    }
});

test('operate scroll panels without focusable children are keyboard reachable', () => {
    for (const id of ['operateStorageTitle', 'operateArtifactsTitle', 'operateFreshnessTitle']) {
        assert.match(html, new RegExp(`aria-labelledby="${id}"[^>]*tabindex="0"`), id);
    }
});

test('the operate view is registered and re-rendered on view changes', () => {
    const main = read('js/main.js');
    assert.match(main, /VIEW_NAMES = new Set\(\[[^\]]*'operate'/);
    assert.match(main, /initOperate\(\)/);
    assert.match(main, /applyOperateLanguage\(\)/);
    assert.match(main, /if \(name === 'operate'\) renderOperate\(\);/);
    assert.match(main, /registerAppShellWorker\(\)/);
    assert.match(main, /inputRow[^\n]*'operate'/);
});

test('the app never pins an artifact file the runtime would not request', () => {
    const view = read('js/operateView.js');
    // Transformers.js v3.8.1은 tokenizer.json과 tokenizer_config.json만 요청한다.
    // 더 많은 파일을 pin하면 offline 표시가 실제 사용 가능성과 어긋난다.
    assert.match(view, /\['tokenizer\.json', 'tokenizer_config\.json'\]/);
    assert.match(view, /resolve\/\$\{model\.revision\}/);
});

test('operate helpers never invent a revision or a license for local uploads', () => {
    const custom = read('js/customArtifact.js');
    assert.match(custom, /revision: null/);
    assert.match(custom, /revisionUnavailableReason: 'local-upload-has-no-commit'/);
    assert.match(custom, /status: 'unknown'/);
    assert.match(custom, /persistence: 'session-only'/);

    const tokenizer = read('js/tokenizer.js');
    // 세션 artifact는 새로고침하면 사라져야 하므로 어디에도 저장하지 않는다.
    assert.doesNotMatch(tokenizer, /localStorage|sessionStorage|indexedDB/);
    assert.match(tokenizer, /clearSessionTokenizers/);
});

test('custom artifacts are built with the public constructor, never remote code', () => {
    const tokenizer = read('js/tokenizer.js');
    assert.match(tokenizer, /new PreTrainedTokenizer\(tokenizerJson, tokenizerConfig \|\| \{\}\)/);
    assert.doesNotMatch(tokenizer, /trust_remote_code|auto_map/);
    for (const name of ['js/customArtifact.js', 'js/cacheManifest.js']) {
        const source = read(name);
        assert.doesNotMatch(source, /\bnew Function\b|\beval\s*\(/, `${name} must not evaluate code`);
        assert.doesNotMatch(source, /document\.|window\./, `${name} must stay pure`);
    }
});

test('the pure cache and custom-artifact modules perform no network access', () => {
    for (const name of ['js/cacheManifest.js', 'js/customArtifact.js']) {
        const source = read(name);
        assert.doesNotMatch(source, /\bfetch\s*\(/, `${name} must not fetch`);
        assert.doesNotMatch(source, /XMLHttpRequest|navigator\.sendBeacon|new WebSocket/, name);
    }
});

test('the CSP already allows the service worker the app registers', () => {
    const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)[1];
    assert.match(csp, /worker-src 'self'/);
    assert.match(csp, /script-src 'self'(?:;|$)/);
    // Service Worker는 동일 출처 스크립트여야 하므로 원격 script 허용이 없어야 한다.
    assert.doesNotMatch(csp, /script-src[^;]*https:/);
});
