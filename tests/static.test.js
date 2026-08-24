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

test('tokenizer artifacts are pinned to immutable commit revisions', () => {
    const tokenizer = readFileSync(resolve(root, 'js', 'tokenizer.js'), 'utf8');
    const revisions = [...tokenizer.matchAll(/revision:\s*'([0-9a-f]{40})'/g)].map((match) => match[1]);
    assert.equal(revisions.length, 6);
    assert.equal(new Set(revisions).size, 6);
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
