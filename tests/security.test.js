import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mainHtml = readFileSync(resolve(root, 'llm_tokenizer_simulator.html'), 'utf8');
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
const tokenizerSource = readFileSync(resolve(root, 'js', 'tokenizer.js'), 'utf8');
const utilities = readFileSync(resolve(root, 'css', 'utilities.css'), 'utf8');
const vendorManifest = JSON.parse(readFileSync(resolve(root, 'vendor', 'manifest.json'), 'utf8'));

function contentSecurityPolicy(html) {
    const match = html.match(
        /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i,
    );
    assert.ok(match, 'Missing Content-Security-Policy meta tag');
    return match[1];
}

function sha256(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

test('Tailwind Play CDN is replaced by a checked-in utility stylesheet', () => {
    assert.doesNotMatch(mainHtml, /cdn\.tailwindcss\.com/i);
    assert.match(mainHtml, /href="css\/utilities\.css"/);
    assert.ok(
        mainHtml.indexOf('css/utilities.css') < mainHtml.indexOf('css/base.css'),
        'Reset/utility CSS must load before component CSS',
    );

    const requiredUtilities = [
        'flex', 'grid', 'flex-1', 'flex-col', 'flex-wrap', 'shrink-0',
        'items-center', 'justify-between', 'justify-center', 'justify-end',
        'grid-cols-2', 'grid-cols-3', 'grid-cols-4',
        'gap-1', 'gap-2', 'gap-3', 'gap-4',
        'p-3', 'p-4', 'px-3', 'px-4', 'py-1', 'py-2', 'py-3',
        'border-2', 'border-b-2', 'border-t-2',
        'text-xs', 'text-sm', 'text-lg', 'text-2xl',
        'font-sans', 'font-mono', 'font-bold',
        'overflow-auto', 'overflow-hidden', 'overflow-y-auto',
        'hidden', 'sr-only', 'opacity-60', 'opacity-80',
    ];
    for (const className of requiredUtilities) {
        assert.ok(utilities.includes('.' + className), 'Missing local utility: ' + className);
    }
    assert.match(utilities, /\.h-\\\[14\\\.4rem\\\]/);
    assert.match(utilities, /\.text-\\\[11px\\\]/);
    assert.match(utilities, /\.top-3\\\.5/);
});

test('runtime JavaScript is local and pinned to the vendored release', () => {
    assert.match(
        tokenizerSource,
        /from ['"]\.\.\/vendor\/huggingface-transformers-3\.8\.1\.min\.js['"]/,
    );
    assert.doesNotMatch(
        tokenizerSource,
        /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers/,
    );
    assert.equal(vendorManifest.package, '@huggingface/transformers');
    assert.equal(vendorManifest.version, '3.8.1');
    assert.equal(vendorManifest.usage, 'tokenizer-only');
});

test('vendored runtime and license match the recorded SHA-256 values', () => {
    for (const entry of vendorManifest.files) {
        const path = resolve(root, 'vendor', entry.path);
        assert.ok(existsSync(path), 'Missing vendored file: ' + entry.path);
        assert.equal(sha256(path), entry.sha256, entry.path);
    }
});

test('meta CSP blocks remote scripts and limits network access to HF artifacts', () => {
    const mainCsp = contentSecurityPolicy(mainHtml);
    assert.match(mainCsp, /default-src 'self'/);
    assert.match(mainCsp, /base-uri 'none'/);
    assert.match(mainCsp, /object-src 'none'/);
    assert.match(mainCsp, /form-action 'none'/);
    assert.match(mainCsp, /script-src 'self'(?:;|$)/);
    assert.doesNotMatch(mainCsp, /script-src[^;]*https:/);
    assert.doesNotMatch(mainCsp, /(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
    assert.doesNotMatch(mainCsp, /(?:^|\s)'wasm-unsafe-eval'(?:\s|;|$)/);
    assert.match(mainCsp, /connect-src 'self'[^;]*https:\/\/huggingface\.co/);

    const indexCsp = contentSecurityPolicy(indexHtml);
    assert.match(indexCsp, /default-src 'none'/);
});

test('the vendored runtime still owns the artifact cache name the app relies on', () => {
    // 이 앱은 별도 artifact cache를 만들지 않고 런타임이 쓰는 cache를 그대로 쓴다.
    // 버전을 올려 이름이 바뀌면 offline pin이 조용히 다른 저장소를 가리키게 된다.
    const vendorSource = readFileSync(
        resolve(root, 'vendor', 'huggingface-transformers-3.8.1.min.js'),
        'utf8',
    );
    assert.match(vendorSource, /caches\.open\("transformers-cache"\)/);
});
