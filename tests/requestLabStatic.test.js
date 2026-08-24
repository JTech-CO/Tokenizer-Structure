import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'llm_tokenizer_simulator.html'), 'utf8');
const jsDir = resolve(root, 'js');
const jsFiles = readdirSync(jsDir).filter((name) => name.endsWith('.js'));
const jsSources = Object.fromEntries(
    jsFiles.map((name) => [name, readFileSync(resolve(jsDir, name), 'utf8')]),
);

test('the Request Lab tab and panel are wired into the single main landmark', () => {
    const tabButton = html.match(/<button[^>]*id="tabRequest"[^>]*>/);
    assert.ok(tabButton, 'Missing the Request Lab tab button');
    assert.match(tabButton[0], /role="tab"/);
    assert.match(tabButton[0], /aria-controls="requestView"/);
    assert.match(html, /<div id="requestView"[^>]*role="tabpanel"[^>]*aria-labelledby="tabRequest"/);
    assert.match(html, /href="css\/p2\.css"/);

    const container = html.slice(
        html.indexOf('<main id="viewContainer"'),
        html.indexOf('</main>'),
    );
    assert.ok(container.includes('id="requestView"'));

    for (const id of [
        'requestMessages', 'requestAddMessage', 'optionAddGenerationPrompt',
        'requestTools', 'requestDocuments', 'requestSpecStatus',
        'requestOverhead', 'requestDuplication', 'requestCapabilities',
        'requestTemplateText', 'requestSegments', 'requestProviderSlots', 'requestUnsupported',
        'requestReservedOutput', 'requestReservedReasoning', 'requestBudget', 'requestTimeline', 'requestReplay',
        'requestCostModel', 'requestCallsPerDay', 'requestCost', 'requestCostExcluded',
    ]) {
        assert.match(html, new RegExp(`id="${id}"`), `Missing Request Lab element: ${id}`);
    }
});

test('the serialized template output stays keyboard reachable and labelled', () => {
    // aria-label을 붙이는 스크롤 영역은 role 없이는 aria-prohibited-attr 위반이 된다.
    assert.match(html, /id="requestTemplateText"[^>]*role="group"[^>]*tabindex="0"/);
    assert.match(jsSources['requestLabView.js'], /setAttribute\('aria-label', copy\(\)\.templateScrollLabel\)/);
});

test('the Request Lab is registered as a view and keeps the artifact selector visible', () => {
    const main = jsSources['main.js'];
    assert.match(main, /VIEW_NAMES = new Set\(\[[^\]]*'request'/);
    assert.match(main, /initRequestLab\(renderRequestLab\)/);
    assert.match(main, /applyRequestLabLanguage\(\)/);
    // artifact 선택이 chat template 능력을 바꾸므로 모델 컨트롤은 남아야 한다.
    assert.match(main, /pipelineControls[^\n]*'request'/);
    assert.match(main, /if \(name === 'request'\) renderRequestLab\(\);/);
});

test('no provider API endpoint or credential is reachable from the browser bundle', () => {
    const providerHosts = [
        'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com',
        'api.mistral.ai', 'api.cohere.ai', 'openrouter.ai',
    ];
    for (const [name, source] of Object.entries(jsSources)) {
        for (const host of providerHosts) {
            assert.ok(!source.includes(host), `${name} must not reach ${host} from the browser`);
        }
    }
    assert.ok(!html.includes('api.openai.com'));

    // 로컬 분석 경로는 gateway 없이 완전해야 하므로 요청 전송 코드가 있어서는 안 된다.
    for (const name of ['requestLabView.js', 'chatTemplate.js', 'requestContract.js', 'costScenario.js', 'contextBudget.js']) {
        assert.doesNotMatch(jsSources[name], /\bfetch\s*\(/, `${name} must not perform network requests`);
        assert.doesNotMatch(jsSources[name], /XMLHttpRequest|navigator\.sendBeacon|new WebSocket/, name);
    }
});

test('no secret-looking credential is checked into the app source', () => {
    const patterns = [
        /sk-[A-Za-z0-9]{20,}/,
        /sk-ant-[A-Za-z0-9-]{20,}/,
        /AIza[0-9A-Za-z_-]{30,}/,
        /hf_[A-Za-z0-9]{30,}/,
        /\bBearer\s+[A-Za-z0-9._-]{20,}/,
        /(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9._-]{20,}['"]/i,
    ];
    const sources = { ...jsSources, 'llm_tokenizer_simulator.html': html };
    for (const [name, source] of Object.entries(sources)) {
        for (const pattern of patterns) {
            assert.doesNotMatch(source, pattern, `${name} looks like it contains a credential`);
        }
    }
});

test('provider count slots exist in the UI but are never filled locally', () => {
    const view = jsSources['requestLabView.js'];
    assert.match(view, /renderProviderSlots/);
    // 로컬 코드가 provider 계수를 만들어 넣지 않는다.
    assert.doesNotMatch(view, /providerCounts\.(preflight|actual)\s*=/);
    assert.match(jsSources['chatTemplate.js'], /status: 'not-configured'/);
});
