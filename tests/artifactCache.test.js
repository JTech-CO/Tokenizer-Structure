import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ArtifactCacheManager,
    createMemoryCacheStorage,
    createMemoryManifestStore,
} from '../js/artifactCache.js';
import { CACHE_NAMES, validateCacheOwnership } from '../js/cacheManifest.js';

const REVISION = '7956d98f2a83b2751a98ea7136fdf7fe6cf54e69';
const base = `https://huggingface.co/Xenova/gpt-4o/resolve/${REVISION}/`;
const ARTIFACT = Object.freeze({
    id: 'Xenova/gpt-4o',
    revision: REVISION,
    files: [`${base}tokenizer.json`, `${base}tokenizer_config.json`],
});

function jsonResponse(body, { status = 200, contentType = 'application/json', contentLength = null } = {}) {
    const bytes = new TextEncoder().encode(body);
    const headers = { 'content-type': contentType };
    headers['content-length'] = String(contentLength === null ? bytes.byteLength : contentLength);
    return new Response(bytes, { status, headers });
}

function createManager({ fetchImpl, entries = [], version = undefined, estimateStorage = null } = {}) {
    const cacheStorage = createMemoryCacheStorage();
    const manifestStore = createMemoryManifestStore(entries, version);
    const manager = new ArtifactCacheManager({ cacheStorage, manifestStore, fetchImpl, estimateStorage });
    return { manager, cacheStorage, manifestStore };
}

const okFetch = async (url) => jsonResponse(`{"url":"${url}"}`);

test('a complete pin records every file and reports the artifact as offline ready', async () => {
    const { manager, cacheStorage } = createManager({ fetchImpl: okFetch });
    const progress = [];
    const result = await manager.pin(ARTIFACT, { onProgress: (event) => progress.push(event) });

    assert.equal(result.ok, true);
    assert.equal(result.entry.status, 'pinned');
    assert.equal(result.entry.files.length, 2);
    assert.equal(result.entry.totalBytes, result.entry.files.reduce((sum, file) => sum + file.bytes, 0));
    assert.deepEqual(progress.map((event) => event.completed), [1, 2]);

    const summary = await manager.summary();
    assert.deepEqual(summary.offlineReadyArtifactIds, ['Xenova/gpt-4o']);
    assert.equal(summary.pinnedCount, 1);

    const cache = await cacheStorage.open(CACHE_NAMES.artifacts);
    assert.equal((await cache.keys()).length, 2);
});

test('a 404 partway through leaves no partial files and no offline claim', async () => {
    const fetchImpl = async (url) => (url.endsWith('tokenizer_config.json')
        ? jsonResponse('<!doctype html>Not found', { status: 404, contentType: 'text/html' })
        : jsonResponse('{"ok":true}'));
    const { manager, cacheStorage } = createManager({ fetchImpl });

    const result = await manager.pin(ARTIFACT);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'non-ok-status');
    assert.equal(result.entry.status, 'error');

    const cache = await cacheStorage.open(CACHE_NAMES.artifacts);
    assert.equal((await cache.keys()).length, 0, 'partial downloads must be removed');
    const summary = await manager.summary();
    assert.deepEqual(summary.offlineReadyArtifactIds, []);
    assert.deepEqual(summary.incompleteArtifactIds, ['Xenova/gpt-4o']);
});

test('an HTML fallback served with status 200 is not recorded as a real file', async () => {
    const fetchImpl = async () => jsonResponse('<!doctype html><title>Sign in</title>', { contentType: 'text/html; charset=utf-8' });
    const { manager, cacheStorage } = createManager({ fetchImpl });

    const result = await manager.pin(ARTIFACT);
    assert.equal(result.reason, 'html-fallback');
    assert.equal((await (await cacheStorage.open(CACHE_NAMES.artifacts)).keys()).length, 0);
});

test('opaque and truncated responses are refused', async () => {
    const opaque = async () => ({
        status: 0,
        type: 'opaque',
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(8),
    });
    assert.equal((await createManager({ fetchImpl: opaque }).manager.pin(ARTIFACT)).reason, 'opaque-response');

    const truncated = async () => jsonResponse('{"a":1}', { contentLength: 999 });
    assert.equal((await createManager({ fetchImpl: truncated }).manager.pin(ARTIFACT)).reason, 'incomplete-body');

    const empty = async () => jsonResponse('');
    assert.equal((await createManager({ fetchImpl: empty }).manager.pin(ARTIFACT)).reason, 'empty-body');
});

test('a file outside the allowed hosts or without a pinned SHA never reaches the network', async () => {
    let calls = 0;
    const counting = async (url) => {
        calls += 1;
        return jsonResponse(`{"url":"${url}"}`);
    };
    const { manager } = createManager({ fetchImpl: counting });

    const badHost = await manager.pin({ ...ARTIFACT, files: ['https://evil.example.com/tokenizer.json'] });
    assert.equal(badHost.reason, 'host-not-allowed');

    const badRevision = await manager.pin({
        id: 'a/b',
        revision: 'main',
        files: ['https://huggingface.co/a/b/resolve/main/tokenizer.json'],
    });
    assert.equal(badRevision.reason, 'revision-not-pinned');
    assert.equal(calls, 0, 'a rejected URL must not be fetched');
});

test('unpinning removes the cached files and the manifest entry', async () => {
    const { manager, cacheStorage } = createManager({ fetchImpl: okFetch });
    await manager.pin(ARTIFACT);
    assert.equal((await manager.unpin(ARTIFACT.id)).ok, true);

    assert.equal((await (await cacheStorage.open(CACHE_NAMES.artifacts)).keys()).length, 0);
    assert.deepEqual((await manager.summary()).offlineReadyArtifactIds, []);
    assert.equal((await manager.unpin(ARTIFACT.id)).reason, 'not-pinned');
});

test('verification downgrades an artifact whose files disappeared', async () => {
    const { manager, cacheStorage } = createManager({ fetchImpl: okFetch });
    await manager.pin(ARTIFACT);
    assert.equal((await manager.verify(ARTIFACT.id)).ok, true);

    const cache = await cacheStorage.open(CACHE_NAMES.artifacts);
    await cache.delete(ARTIFACT.files[0]);

    const verified = await manager.verify(ARTIFACT.id);
    assert.equal(verified.ok, false);
    assert.deepEqual(verified.missing, [ARTIFACT.files[0]]);
    assert.equal(verified.entry.status, 'incomplete');
    // 확인에 실패한 artifact를 계속 offline 가능으로 표시하지 않는다.
    assert.deepEqual((await manager.summary()).offlineReadyArtifactIds, []);
});

test('clearing artifacts never touches the app shell cache', async () => {
    const { manager, cacheStorage } = createManager({ fetchImpl: okFetch });
    const shell = await cacheStorage.open(CACHE_NAMES.appShell);
    await shell.put('https://app.example/js/main.js', new Response('shell'));
    await manager.pin(ARTIFACT);

    assert.equal((await manager.clearAll()).ok, true);
    assert.deepEqual(await manager.list(), []);
    assert.equal((await (await cacheStorage.open(CACHE_NAMES.appShell)).keys()).length, 1);
});

test('the app shell cache and the artifact cache hold disjoint URLs', async () => {
    const { manager, cacheStorage } = createManager({ fetchImpl: okFetch });
    const shell = await cacheStorage.open(CACHE_NAMES.appShell);
    for (const url of ['https://app.example/index.html', 'https://app.example/js/main.js']) {
        await shell.put(url, new Response('shell'));
    }
    await manager.pin(ARTIFACT);

    const ownership = validateCacheOwnership({
        appShellUrls: (await shell.keys()).map((request) => request.url),
        artifactUrls: await manager.cachedUrls(),
        origin: 'https://app.example',
    });
    assert.equal(ownership.valid, true, JSON.stringify(ownership.problems));
});

test('an unreadable stored schema version resets the cache instead of being misread', async () => {
    const stale = [{ artifactId: 'a/b', revision: REVISION, files: [], totalBytes: 0, status: 'not-pinned' }];
    const { manager, manifestStore } = createManager({ fetchImpl: okFetch, entries: stale, version: 99 });

    assert.deepEqual(await manager.list(), []);
    assert.equal(await manifestStore.readVersion(), 1);
});

test('a corrupt manifest record is dropped rather than reported as usable', async () => {
    const corrupt = [{ artifactId: 'a/b', revision: REVISION, files: [], totalBytes: 42, status: 'pinned' }];
    const { manager } = createManager({ fetchImpl: okFetch, entries: corrupt });
    assert.deepEqual(await manager.list(), []);
});

test('pinning stops before the browser storage quota is exhausted', async () => {
    const estimateStorage = async () => ({ usage: 99, quota: 100 });
    const { manager } = createManager({ fetchImpl: okFetch, estimateStorage });

    const gate = await manager.canPin({ ...ARTIFACT, expectedBytes: 50 });
    assert.equal(gate.allowed, false);
    assert.ok(gate.problems.some((problem) => problem.code === 'storage-quota-exceeded'));

    const result = await manager.pin({ ...ARTIFACT, expectedBytes: 50 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'storage-quota-exceeded');
});

test('an unavailable storage backend reports itself instead of pretending to work', async () => {
    const manager = new ArtifactCacheManager({ cacheStorage: null, manifestStore: null, fetchImpl: null });
    assert.equal(manager.available, false);
    assert.deepEqual(await manager.list(), []);
    assert.equal((await manager.pin(ARTIFACT)).reason, 'storage-unavailable');
    assert.equal((await manager.verify(ARTIFACT.id)).reason, 'storage-unavailable');
    assert.equal((await manager.summary()).available, false);
});

test('runtime-cached files are reported separately from an explicit pin', async () => {
    const { manager, cacheStorage } = createManager({ fetchImpl: okFetch });

    const none = await manager.inspectRuntimeCache(ARTIFACT.files);
    assert.deepEqual(none, { present: 0, total: 2, complete: false, available: true });

    // 런타임이 pin과 무관하게 남긴 파일을 흉내 낸다.
    const cache = await cacheStorage.open(CACHE_NAMES.artifacts);
    await cache.put(ARTIFACT.files[0], new Response('runtime'));
    const partial = await manager.inspectRuntimeCache(ARTIFACT.files);
    assert.deepEqual(partial, { present: 1, total: 2, complete: false, available: true });
    // 파일이 있어도 사용자가 고정한 것은 아니므로 pin 목록에는 들어가지 않는다.
    assert.deepEqual((await manager.summary()).offlineReadyArtifactIds, []);

    await cache.put(ARTIFACT.files[1], new Response('runtime'));
    assert.equal((await manager.inspectRuntimeCache(ARTIFACT.files)).complete, true);
});
