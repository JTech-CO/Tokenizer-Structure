import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'llm_tokenizer_simulator.html');
const html = readFileSync(htmlPath, 'utf8');

test('all JavaScript modules pass Node syntax checking', () => {
    const jsDir = resolve(root, 'js');
    for (const name of readdirSync(jsDir).filter((entry) => entry.endsWith('.js'))) {
        const file = resolve(jsDir, name);
        const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr || `Syntax check failed: ${name}`);
    }
});

test('main HTML has unique IDs and referenced local assets exist', () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML id found');

    const assets = [...html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((value) => !/^(?:https?:|data:|#)/.test(value));
    for (const asset of assets) {
        assert.ok(existsSync(resolve(root, asset)), `Missing local asset: ${asset}`);
    }
});

test("every static el('id') reference exists in the main HTML", () => {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
    const sources = readdirSync(resolve(root, 'js'))
        .filter((entry) => entry.endsWith('.js'))
        .map((entry) => readFileSync(resolve(root, 'js', entry), 'utf8'))
        .join('\n');
    const references = new Set(
        [...sources.matchAll(/\bel\(['"]([^'"]+)['"]\)/g)].map((match) => match[1])
    );
    for (const id of references) {
        assert.ok(ids.has(id), `Missing HTML id referenced by el(): ${id}`);
    }
});

test('tokenizer engine imports and re-exports the separate artifact catalog', () => {
    const tokenizer = readFileSync(resolve(root, 'js', 'tokenizer.js'), 'utf8');
    assert.match(tokenizer, /import\s*\{\s*MODELS\s*\}\s*from\s*['"]\.\/artifacts\.js['"]/);
    assert.match(tokenizer, /export\s*\{\s*MODELS\s*\}\s*from\s*['"]\.\/artifacts\.js['"]/);
    assert.doesNotMatch(tokenizer, /revision:\s*'[0-9a-f]{40}'/);
});

test('tokenizer imports both byte display helpers it calls locally', () => {
    const tokenizer = readFileSync(resolve(root, 'js', 'tokenizer.js'), 'utf8');
    assert.match(
        tokenizer,
        /import\s*\{[^}]*\bdisplaySurface\b[^}]*\bdisplaySurfaces\b[^}]*\}\s*from\s*['"]\.\/byteDisplay\.js['"]/
    );
});

test('documentation no longer claims unsupported tokenizer equivalence', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    const blog = readFileSync(resolve(root, '설명용 글', 'blog_text.md'), 'utf8');
    assert.doesNotMatch(readme + blog, /GPT-4o\s*=\s*GPT-5|Llama 3\.2/);
});

test('tokenizer stage failures are explicit instead of silently masquerading as real stages', () => {
    const tokenizer = readFileSync(resolve(root, 'js', 'tokenizer.js'), 'utf8');
    assert.match(tokenizer, /Tokenizer normalization failed/);
    assert.match(tokenizer, /Tokenizer pre-tokenization failed/);
    assert.match(tokenizer, /Tokenizer subword model failed/);
    assert.doesNotMatch(tokenizer, /catch\s*\{\s*normalized\s*=\s*text/);
    assert.doesNotMatch(tokenizer, /catch\s*\{\s*subwords\s*=\s*preTokens\.slice/);
});

test('scrollable data tables and cost sorting controls expose keyboard state', () => {
    assert.match(html, /id="matrixTableWrap"[^>]*tabindex="0"/);
    assert.match(html, /id="costTableWrap"[^>]*tabindex="0"/);
    for (const id of ['sortBtnProvider', 'sortBtnAsc', 'sortBtnDesc']) {
        assert.match(html, new RegExp(`id="${id}"[^>]*aria-pressed="(?:true|false)"`));
    }
});

test('every view tabpanel sits inside exactly one main landmark', () => {
    const mainOpen = [...html.matchAll(/<main\b/g)].length;
    const mainClose = [...html.matchAll(/<\/main>/g)].length;
    assert.equal(mainOpen, 1, 'Exactly one <main> landmark is expected');
    assert.equal(mainClose, 1);
    assert.match(html, /<main id="viewContainer"/);

    const container = html.slice(
        html.indexOf('<main id="viewContainer"'),
        html.indexOf('</main>'),
    );
    for (const id of ['pipelineView', 'compareView', 'matrixView', 'inspectorView', 'learnView']) {
        assert.ok(container.includes(`id="${id}"`), `${id} must live inside the main landmark`);
    }
    // 모달은 landmark 밖 overlay이므로 main 안에 들어가지 않는다.
    assert.ok(!container.includes('id="costModal"'));
});

test('scrollable output regions are keyboard reachable and labelled', () => {
    const labelled = {
        step1Output: 'step1Title',
        step2Output: 'step2Title',
        step3Output: 'step3Title',
        step4Output: 'step4Title',
        finalOutput: 'finalTitle',
        efficiencyOutput: 'efficiencyTitle',
        costOutput: 'costTitle',
        cmpSubA: 'cmpLabelA',
        cmpSubB: 'cmpLabelB',
    };
    for (const [id, labelledBy] of Object.entries(labelled)) {
        assert.match(html, new RegExp(`id="${id}" role="group" tabindex="0" aria-labelledby="${labelledBy}"`));
    }
    for (const id of ['cmpIdsA', 'cmpIdsB']) {
        assert.match(html, new RegExp(`id="${id}" role="group" tabindex="0"`));
    }
    // aria-label을 쓰는 div는 role 없이는 aria-prohibited-attr 위반이 된다.
    for (const id of ['matrixTableWrap', 'costTableWrap', 'tokenDetailWrap', 'inspectorLenses']) {
        assert.match(html, new RegExp(`id="${id}"[^>]*role="group"`));
    }
});

test('pipeline grid selector stays in sync across HTML, CSS, and JS', () => {
    assert.match(html, /<div id="pipelineGrid" class="[^"]*grid-cols-4/);
    const baseCss = readFileSync(resolve(root, 'css/base.css'), 'utf8');
    const viewsCss = readFileSync(resolve(root, 'css/views.css'), 'utf8');
    const mainJs = readFileSync(resolve(root, 'js/main.js'), 'utf8');
    const pipelineJs = readFileSync(resolve(root, 'js/pipeline.js'), 'utf8');

    // 반응형 열 축소와 단계 애니메이션이 래퍼 <main>이 아니라 실제 grid를 대상으로 해야 한다.
    assert.equal([...baseCss.matchAll(/#pipelineGrid\s*\{/g)].length, 2);
    assert.match(viewsCss, /#pipelineGrid\.anim > \.step-card \{/);
    assert.doesNotMatch(baseCss, /#pipelineView > main/);
    assert.doesNotMatch(viewsCss, /(?<![-\w])main\.anim/);
    for (const source of [mainJs, pipelineJs]) {
        assert.match(source, /pipelineGrid/);
        assert.doesNotMatch(source, /querySelector\('main'\)/);
    }
});

test('i18n covers every aria-label applied at runtime', () => {
    const i18nSource = readFileSync(resolve(root, 'js/i18n.js'), 'utf8');
    const mainJs = readFileSync(resolve(root, 'js/main.js'), 'utf8');
    const keys = [...mainJs.matchAll(/setAttribute\('aria-label', L\.(\w+)\)/g)].map((m) => m[1]);
    assert.ok(keys.length >= 7, 'aria-label i18n wiring is expected in applyLang');
    for (const key of new Set(keys)) {
        assert.equal(
            [...i18nSource.matchAll(new RegExp(`^ {8}${key}:`, 'gm'))].length,
            2,
            `${key} must exist in both ko and en dictionaries`,
        );
    }
});
