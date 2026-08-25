import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

test('the shipped app keeps zero runtime and build dependencies', () => {
    // 검증한 파일이 그대로 배포되는 성질을 지키기 위한 규칙이다.
    // 도구가 필요하면 저장소 밖에 설치한다 (tools/cross-browser/README.md 참고).
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const declared = packageJson[field] || {};
        assert.deepEqual(Object.keys(declared), [], `${field} must stay empty`);
    }
    assert.equal(packageJson.scripts.test, 'node --test');
    assert.ok(!existsSync(resolve(root, 'node_modules')), 'node_modules must not be committed or required');
    assert.ok(!existsSync(resolve(root, 'package-lock.json')), 'a lockfile implies dependencies');
});

test('verification tooling stays outside the deployed app', () => {
    const toolsDir = resolve(root, 'tools', 'cross-browser');
    const files = readdirSync(toolsDir);
    for (const name of ['verify.mjs', 'operate.mjs', 'offline.mjs', 'README.md']) {
        assert.ok(files.includes(name), `missing tools/cross-browser/${name}`);
    }

    // 도구는 app shell이 아니다. Service Worker가 precache 하면 배포물에 섞인다.
    const sw = readFileSync(resolve(root, 'sw.js'), 'utf8');
    assert.ok(!sw.includes('tools/'), 'sw.js must not precache verification tooling');

    // HTML도 도구를 참조하지 않아야 한다.
    const html = readFileSync(resolve(root, 'llm_tokenizer_simulator.html'), 'utf8');
    assert.ok(!html.includes('tools/'), 'the app must not reference verification tooling');

    const readme = readFileSync(resolve(toolsDir, 'README.md'), 'utf8');
    assert.match(readme, /package\.json`?에 추가하지 마세요/);
});

test('the verification scripts are syntactically valid without installing Playwright', () => {
    const toolsDir = resolve(root, 'tools', 'cross-browser');
    for (const name of readdirSync(toolsDir).filter((file) => file.endsWith('.mjs'))) {
        const result = spawnSync(process.execPath, ['--check', resolve(toolsDir, name)], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr || `Syntax check failed: ${name}`);
    }
});

test('waitForFunction timeouts are passed as the third argument', () => {
    const toolsDir = resolve(root, 'tools', 'cross-browser');
    for (const name of readdirSync(toolsDir).filter((file) => file.endsWith('.mjs'))) {
        const source = readFileSync(resolve(toolsDir, name), 'utf8');
        const calls = [...source.matchAll(/waitForFunction\(/g)].length;
        if (calls === 0) continue;
        // Playwright 시그니처는 (fn, arg, options)다. arg 자리를 건너뛰면 기본 30초가 걸린다.
        const withTimeout = [...source.matchAll(/\n\s*null,\n\s*\{ timeout:/g)].length;
        assert.equal(withTimeout, calls, `${name}: every waitForFunction must pass null before its options`);
    }
});
