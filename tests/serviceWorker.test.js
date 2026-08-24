import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CACHE_NAMES } from '../js/cacheManifest.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'sw.js'), 'utf8');
const ORIGIN = 'https://app.example';
const SCOPE = `${ORIGIN}/Tokenizer-Structure/`;

function createCacheStorage(fetchImpl) {
    const store = new Map();
    const open = async (name) => {
        if (!store.has(name)) store.set(name, new Map());
        const cache = store.get(name);
        return {
            async addAll(urls) {
                for (const url of urls) {
                    const response = await fetchImpl(url);
                    if (!response || response.status !== 200) throw new Error(`addAll failed: ${url}`);
                    cache.set(url, response);
                }
            },
            async put(request, response) { cache.set(typeof request === 'string' ? request : request.url, response); },
            async match(request) { return cache.get(typeof request === 'string' ? request : request.url) ?? null; },
            async delete(request) { return cache.delete(typeof request === 'string' ? request : request.url); },
            async keys() { return [...cache.keys()].map((url) => ({ url })); },
        };
    };
    return {
        store,
        open,
        async keys() { return [...store.keys()]; },
        async delete(name) { return store.delete(name); },
    };
}

/** sw.js를 가짜 ServiceWorkerGlobalScope에서 실제로 실행한다. */
function loadWorker({ fetchImpl }) {
    const handlers = new Map();
    const caches = createCacheStorage(fetchImpl);
    const claimed = { skipWaiting: 0, claim: 0 };

    const self = {
        location: { href: `${SCOPE}sw.js`, origin: ORIGIN },
        addEventListener: (type, handler) => handlers.set(type, handler),
        skipWaiting: async () => { claimed.skipWaiting += 1; },
        clients: { claim: async () => { claimed.claim += 1; } },
    };

    const sandbox = {
        self, caches, URL, Response, Request, Headers, Error, Promise, console,
        fetch: (input) => fetchImpl(typeof input === 'string' ? input : input.url),
        fetchImpl,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'sw.js' });

    const dispatch = async (type, event) => {
        const handler = handlers.get(type);
        assert.ok(handler, `missing ${type} handler`);
        let waited = null;
        let responded = null;
        handler({
            ...event,
            waitUntil: (promise) => { waited = promise; },
            respondWith: (promise) => { responded = promise; },
        });
        if (waited) await waited;
        return responded;
    };

    return { handlers, caches, claimed, dispatch, sandbox };
}

function okResponse(url, { contentType = 'application/javascript', body = 'ok' } = {}) {
    return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

test('the precache list matches the files actually shipped', () => {
    const listed = new Set([...source.matchAll(/^ {4}'([^']+)',$/gm)].map((match) => match[1]));

    for (const name of readdirSync(resolve(root, 'css')).filter((file) => file.endsWith('.css'))) {
        assert.ok(listed.has(`css/${name}`), `sw.js is missing css/${name}`);
    }
    for (const name of readdirSync(resolve(root, 'js')).filter((file) => file.endsWith('.js'))) {
        assert.ok(listed.has(`js/${name}`), `sw.js is missing js/${name}`);
    }
    for (const path of ['./', 'index.html', 'llm_tokenizer_simulator.html', 'vendor/huggingface-transformers-3.8.1.min.js']) {
        assert.ok(listed.has(path), `sw.js is missing ${path}`);
    }
    // 상대 경로만 담아야 scope 밖 파일을 쥐지 않는다.
    for (const path of listed) {
        assert.ok(!/^https?:/i.test(path), `absolute URL in the precache list: ${path}`);
        assert.ok(!path.includes('huggingface.co'), `artifact host in the precache list: ${path}`);
    }
});

test('the worker never claims the artifact cache the runtime owns', () => {
    assert.match(source, new RegExp(`RUNTIME_ARTIFACT_CACHE = '${CACHE_NAMES.artifacts}'`));
    assert.match(source, new RegExp(`SHELL_PREFIX = '${CACHE_NAMES.appShellPrefix}'`));
    assert.match(source, new RegExp(`SHELL_CACHE = '${CACHE_NAMES.appShell}'`));
});

test('install precaches the shell and fails rather than caching half of it', async () => {
    const worker = loadWorker({ fetchImpl: async (url) => okResponse(url) });
    await worker.dispatch('install', {});
    const cache = await worker.caches.open(CACHE_NAMES.appShell);
    const cached = await cache.keys();
    assert.ok(cached.length >= 50);
    assert.ok(cached.every((request) => request.url.startsWith(SCOPE)));
    assert.equal(worker.claimed.skipWaiting, 1);

    const broken = loadWorker({
        fetchImpl: async (url) => (url.endsWith('js/main.js')
            ? new Response('missing', { status: 404 })
            : okResponse(url)),
    });
    await assert.rejects(() => broken.dispatch('install', {}), /addAll failed/);
});

test('activate removes old shell caches but keeps the artifact cache', async () => {
    const worker = loadWorker({ fetchImpl: async (url) => okResponse(url) });
    worker.caches.store.set('tokenizer-app-shell-v0', new Map([['x', okResponse('x')]]));
    worker.caches.store.set(CACHE_NAMES.artifacts, new Map([['y', okResponse('y')]]));
    worker.caches.store.set(CACHE_NAMES.appShell, new Map());

    await worker.dispatch('activate', {});
    const names = await worker.caches.keys();
    assert.ok(!names.includes('tokenizer-app-shell-v0'));
    assert.ok(names.includes(CACHE_NAMES.artifacts), 'the runtime artifact cache must survive');
    assert.ok(names.includes(CACHE_NAMES.appShell));
    assert.equal(worker.claimed.claim, 1);
});

test('cross-origin artifact requests are not handled by the worker at all', async () => {
    const worker = loadWorker({ fetchImpl: async (url) => okResponse(url) });
    const artifactUrl = 'https://huggingface.co/Xenova/gpt-4o/resolve/abc/tokenizer.json';
    const responded = await worker.dispatch('fetch', {
        request: { method: 'GET', url: artifactUrl, mode: 'cors' },
    });
    assert.equal(responded, null, 'the worker must let artifact requests through untouched');

    const post = await worker.dispatch('fetch', {
        request: { method: 'POST', url: `${SCOPE}js/main.js`, mode: 'cors' },
    });
    assert.equal(post, null);
});

test('navigations prefer the network and fall back to the cache only offline', async () => {
    let online = true;
    const worker = loadWorker({
        fetchImpl: async (url) => {
            if (!online) throw new Error('offline');
            return okResponse(url, { contentType: 'text/html', body: 'fresh' });
        },
    });
    await worker.dispatch('install', {});

    const request = { method: 'GET', url: `${SCOPE}llm_tokenizer_simulator.html`, mode: 'navigate' };
    const fresh = await worker.dispatch('fetch', { request });
    assert.equal(await (await fresh).text(), 'fresh', 'online navigations must use the network');

    online = false;
    const offline = await worker.dispatch('fetch', { request });
    assert.equal(await (await offline).text(), 'fresh', 'offline navigations fall back to the cached shell');
});

test('an HTML error page is never cached as a JavaScript asset', async () => {
    const worker = loadWorker({
        fetchImpl: async (url) => (url.endsWith('js/late.js')
            ? okResponse(url, { contentType: 'text/html; charset=utf-8', body: '<!doctype html>404' })
            : okResponse(url)),
    });
    const request = { method: 'GET', url: `${SCOPE}js/late.js`, mode: 'cors' };
    const response = await worker.dispatch('fetch', { request });
    assert.equal((await response).status, 200);

    const cache = await worker.caches.open(CACHE_NAMES.appShell);
    assert.equal(await cache.match(request.url), null, 'an HTML fallback must not enter the shell cache');
});

test('assets follow the network too, so HTML and modules never mix versions', async () => {
    let body = 'v1';
    let online = true;
    const worker = loadWorker({
        fetchImpl: async (url) => {
            if (!online) throw new Error('offline');
            return okResponse(url, { body });
        },
    });
    await worker.dispatch('install', {});

    const request = { method: 'GET', url: `${SCOPE}js/main.js`, mode: 'cors' };
    body = 'v2';
    // 새 배포가 올라오면 첫 요청부터 새 모듈을 받아야 한다.
    // 이전 stale-while-revalidate에서는 새 HTML과 이전 모듈이 한 번 섞여
    // 새 화면이 빈 채로 떴다.
    const fresh = await worker.dispatch('fetch', { request });
    assert.equal(await (await fresh).text(), 'v2', 'an online asset request must use the network');

    online = false;
    const offline = await worker.dispatch('fetch', { request });
    assert.equal(await (await offline).text(), 'v2', 'the cache still answers when offline');
});

test('an asset that is neither reachable nor cached fails instead of hanging', async () => {
    const worker = loadWorker({ fetchImpl: async () => { throw new Error('offline'); } });
    const request = { method: 'GET', url: `${SCOPE}js/never-seen.js`, mode: 'cors' };
    await assert.rejects(async () => (await worker.dispatch('fetch', { request })), /offline/);
});
