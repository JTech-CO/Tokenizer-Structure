// artifactCache.js — artifact 파일 cache와 manifest 저장소.
// Cache API는 파일을, manifest 저장소는 revision·용량·상태를 소유한다.
// 두 저장소는 같은 파일을 중복 보관하지 않으며 app shell cache와도 분리된다.
import {
    CACHE_LIMITS,
    CACHE_MANIFEST_SCHEMA_VERSION,
    CACHE_NAMES,
    CACHE_REJECT_REASONS,
    classifyArtifactUrl,
    classifyResponse,
    normalizeCacheEntry,
    planMigration,
    quotaStatus,
    summarizeCache,
} from './cacheManifest.js';

/** 테스트와 비영속 대체용 메모리 manifest 저장소. */
export function createMemoryManifestStore(initial = [], version = CACHE_MANIFEST_SCHEMA_VERSION) {
    const entries = new Map(initial.map((entry) => [entry.artifactId, entry]));
    let storedVersion = version;
    return {
        kind: 'memory',
        async readVersion() { return storedVersion; },
        async writeVersion(next) { storedVersion = next; },
        async list() { return [...entries.values()]; },
        async get(artifactId) { return entries.get(artifactId) ?? null; },
        async put(entry) { entries.set(entry.artifactId, entry); },
        async remove(artifactId) { entries.delete(artifactId); },
        async clear() { entries.clear(); },
    };
}

/** 테스트용 메모리 CacheStorage. 실제 offline 저장이 아니므로 앱에서는 쓰지 않는다. */
export function createMemoryCacheStorage() {
    const caches = new Map();
    const open = async (name) => {
        if (!caches.has(name)) caches.set(name, new Map());
        const store = caches.get(name);
        return {
            async put(url, response) { store.set(url, response); },
            async match(url) { return store.get(url) ?? null; },
            async delete(url) { return store.delete(url); },
            async keys() { return [...store.keys()].map((url) => ({ url })); },
        };
    };
    return {
        kind: 'memory',
        open,
        async keys() { return [...caches.keys()]; },
        async delete(name) { return caches.delete(name); },
        async has(name) { return caches.has(name); },
    };
}

export function createIndexedDbManifestStore({
    indexedDB: factory = globalThis.indexedDB,
    dbName = 'tokenizer-structure',
    storeName = 'artifact-manifest',
    metaName = 'manifest-meta',
} = {}) {
    if (!factory) return null;

    const openDb = () => new Promise((resolve, reject) => {
        const request = factory.open(dbName, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'artifactId' });
            if (!db.objectStoreNames.contains(metaName)) db.createObjectStore(metaName, { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    const run = async (store, mode, action) => {
        const db = await openDb();
        try {
            return await new Promise((resolve, reject) => {
                const transaction = db.transaction(store, mode);
                const request = action(transaction.objectStore(store));
                transaction.onabort = () => reject(transaction.error);
                transaction.onerror = () => reject(transaction.error);
                transaction.oncomplete = () => resolve(request ? request.result : undefined);
            });
        } finally {
            db.close();
        }
    };

    return {
        kind: 'indexeddb',
        async readVersion() {
            const record = await run(metaName, 'readonly', (objectStore) => objectStore.get('schemaVersion'));
            return record ? record.value : null;
        },
        async writeVersion(next) {
            await run(metaName, 'readwrite', (objectStore) => objectStore.put({ key: 'schemaVersion', value: next }));
        },
        async list() {
            return (await run(storeName, 'readonly', (objectStore) => objectStore.getAll())) || [];
        },
        async get(artifactId) {
            return (await run(storeName, 'readonly', (objectStore) => objectStore.get(artifactId))) ?? null;
        },
        async put(entry) {
            await run(storeName, 'readwrite', (objectStore) => objectStore.put(entry));
        },
        async remove(artifactId) {
            await run(storeName, 'readwrite', (objectStore) => objectStore.delete(artifactId));
        },
        async clear() {
            await run(storeName, 'readwrite', (objectStore) => objectStore.clear());
        },
    };
}

function failureEntry(artifact, reason, files = []) {
    return {
        artifactId: artifact.id,
        revision: artifact.revision,
        files,
        totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
        status: files.length === 0 ? 'error' : 'incomplete',
        pinnedAt: null,
        verifiedAt: new Date().toISOString(),
        error: reason,
    };
}

export class ArtifactCacheManager {
    constructor({
        cacheStorage,
        manifestStore,
        fetchImpl = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null,
        cacheName = CACHE_NAMES.artifacts,
        estimateStorage = null,
    } = {}) {
        this.available = Boolean(cacheStorage && manifestStore && fetchImpl);
        this._cacheStorage = cacheStorage;
        this._manifestStore = manifestStore;
        this._fetch = fetchImpl;
        this._cacheName = cacheName;
        this._estimateStorage = estimateStorage;
        this._migrated = false;
    }

    async _ensureMigrated() {
        if (this._migrated || !this.available) return { action: 'unavailable' };
        const plan = planMigration(await this._manifestStore.readVersion());
        // 해석할 수 없는 버전을 억지로 읽지 않고 비운 뒤 다시 시작한다.
        if (plan.action === 'reset' || plan.action === 'migrate') {
            await this._manifestStore.clear();
            await this._cacheStorage.delete(this._cacheName);
        }
        if (plan.action !== 'none') await this._manifestStore.writeVersion(CACHE_MANIFEST_SCHEMA_VERSION);
        this._migrated = true;
        return plan;
    }

    async list() {
        if (!this.available) return [];
        await this._ensureMigrated();
        const stored = await this._manifestStore.list();
        const valid = [];
        for (const entry of stored) {
            try {
                valid.push(normalizeCacheEntry(entry));
            } catch {
                // 손상된 기록은 사용 가능한 것처럼 보이지 않도록 버린다.
                await this._manifestStore.remove(entry?.artifactId ?? '');
            }
        }
        return valid;
    }

    async summary() {
        const entries = await this.list();
        const base = summarizeCache(entries);
        let usage = null;
        let quota = null;
        if (typeof this._estimateStorage === 'function') {
            try {
                const estimate = await this._estimateStorage();
                usage = Number.isSafeInteger(estimate?.usage) ? estimate.usage : null;
                quota = Number.isSafeInteger(estimate?.quota) ? estimate.quota : null;
            } catch {
                usage = null;
                quota = null;
            }
        }
        return { ...base, available: this.available, usage, quota, quotaAvailable: usage !== null && quota !== null };
    }

    async canPin(artifact) {
        const entries = await this.list();
        if (entries.some((entry) => entry.artifactId === artifact.id && entry.status === 'pinned')) {
            return { allowed: false, problems: [{ code: 'already-pinned' }] };
        }
        const estimate = await this.summary();
        return quotaStatus({
            usage: estimate.usage,
            quota: estimate.quota,
            requestedBytes: Number.isSafeInteger(artifact.expectedBytes) ? artifact.expectedBytes : 0,
            entries,
        });
    }

    /**
     * artifact 파일을 모두 받아 검증한 뒤에만 pinned로 기록한다.
     * 한 파일이라도 거부되면 이미 받은 파일을 지우고 실패로 남긴다.
     */
    async pin(artifact, { onProgress = null } = {}) {
        if (!this.available) return { ok: false, reason: 'storage-unavailable', entry: null };
        await this._ensureMigrated();

        const gate = await this.canPin(artifact);
        if (!gate.allowed) {
            return { ok: false, reason: gate.problems[0]?.code ?? 'not-allowed', entry: null, problems: gate.problems };
        }

        const cache = await this._cacheStorage.open(this._cacheName);
        const written = [];
        const cleanup = async () => {
            for (const file of written) await cache.delete(file.url);
        };

        for (const [index, url] of artifact.files.entries()) {
            const urlCheck = classifyArtifactUrl(url, { revision: artifact.revision });
            if (!urlCheck.allowed) {
                await cleanup();
                const entry = failureEntry(artifact, urlCheck.reason);
                await this._manifestStore.put(entry);
                return { ok: false, reason: urlCheck.reason, entry };
            }

            let response;
            let buffer;
            try {
                response = await this._fetch(url);
                buffer = await response.arrayBuffer();
            } catch (error) {
                await cleanup();
                const entry = failureEntry(artifact, `fetch-failed: ${String(error?.message || error).slice(0, 120)}`);
                await this._manifestStore.put(entry);
                return { ok: false, reason: 'fetch-failed', entry };
            }

            const headerLength = response.headers?.get?.('content-length');
            const verdict = classifyResponse({
                url,
                revision: artifact.revision,
                status: response.status,
                type: response.type ?? 'basic',
                contentType: response.headers?.get?.('content-type') ?? null,
                contentLength: headerLength === null || headerLength === undefined ? null : Number(headerLength),
                receivedBytes: buffer.byteLength,
            });
            if (!verdict.cacheable) {
                await cleanup();
                const entry = failureEntry(artifact, verdict.reason);
                await this._manifestStore.put(entry);
                return { ok: false, reason: verdict.reason, entry };
            }

            await cache.put(url, new Response(buffer, {
                status: 200,
                headers: { 'content-type': response.headers?.get?.('content-type') ?? 'application/octet-stream' },
            }));
            written.push({ url, bytes: buffer.byteLength });
            if (onProgress) onProgress({ artifactId: artifact.id, completed: index + 1, total: artifact.files.length });
        }

        const now = new Date().toISOString();
        let entry;
        try {
            entry = normalizeCacheEntry({
                artifactId: artifact.id,
                revision: artifact.revision,
                files: written,
                totalBytes: written.reduce((sum, file) => sum + file.bytes, 0),
                status: 'pinned',
                pinnedAt: now,
                verifiedAt: now,
                error: null,
            });
        } catch (error) {
            await cleanup();
            const failed = failureEntry(artifact, `manifest-rejected: ${error.message.slice(0, 120)}`);
            await this._manifestStore.put(failed);
            return { ok: false, reason: 'manifest-rejected', entry: failed };
        }
        await this._manifestStore.put(entry);
        return { ok: true, reason: null, entry };
    }

    async unpin(artifactId) {
        if (!this.available) return { ok: false, reason: 'storage-unavailable' };
        await this._ensureMigrated();
        const entry = await this._manifestStore.get(artifactId);
        if (!entry) return { ok: true, reason: 'not-pinned' };
        const cache = await this._cacheStorage.open(this._cacheName);
        for (const file of entry.files || []) await cache.delete(file.url);
        await this._manifestStore.remove(artifactId);
        return { ok: true, reason: null };
    }

    /** manifest가 주장하는 파일이 실제로 cache에 있고 크기도 같은지 확인한다. */
    async verify(artifactId) {
        if (!this.available) return { ok: false, reason: 'storage-unavailable' };
        await this._ensureMigrated();
        const stored = await this._manifestStore.get(artifactId);
        if (!stored) return { ok: false, reason: 'not-pinned' };

        const cache = await this._cacheStorage.open(this._cacheName);
        const missing = [];
        const mismatched = [];
        for (const file of stored.files || []) {
            const response = await cache.match(file.url);
            if (!response) {
                missing.push(file.url);
                continue;
            }
            const bytes = (await response.clone().arrayBuffer()).byteLength;
            if (bytes !== file.bytes) mismatched.push(file.url);
        }
        if (missing.length === 0 && mismatched.length === 0) {
            const entry = { ...stored, status: 'pinned', verifiedAt: new Date().toISOString(), error: null };
            await this._manifestStore.put(entry);
            return { ok: true, reason: null, entry };
        }
        const entry = {
            ...stored,
            status: 'incomplete',
            verifiedAt: new Date().toISOString(),
            error: `missing=${missing.length} mismatched=${mismatched.length}`,
        };
        await this._manifestStore.put(entry);
        return { ok: false, reason: 'verification-failed', entry, missing, mismatched };
    }

    /** artifact cache와 manifest만 비운다. app shell cache는 건드리지 않는다. */
    async clearAll() {
        if (!this.available) return { ok: false, reason: 'storage-unavailable' };
        await this._cacheStorage.delete(this._cacheName);
        await this._manifestStore.clear();
        await this._manifestStore.writeVersion(CACHE_MANIFEST_SCHEMA_VERSION);
        return { ok: true, reason: null };
    }

    /**
     * 런타임이 pin과 무관하게 남겨 둔 파일이 있는지 확인한다.
     * pin하지 않았다고 해서 offline에서 못 쓴다는 뜻은 아니므로, 그 사실을 그대로 보고한다.
     */
    async inspectRuntimeCache(files = []) {
        if (!this.available || files.length === 0) {
            return { present: 0, total: files.length, complete: false, available: this.available };
        }
        const cache = await this._cacheStorage.open(this._cacheName);
        let present = 0;
        for (const url of files) {
            if (await cache.match(url)) present += 1;
        }
        return { present, total: files.length, complete: present === files.length, available: true };
    }

    /** 실제 cache에 들어 있는 URL 목록. 소유권 검사에 쓴다. */
    async cachedUrls() {
        if (!this.available) return [];
        const cache = await this._cacheStorage.open(this._cacheName);
        return (await cache.keys()).map((request) => request.url);
    }
}

export { CACHE_LIMITS, CACHE_NAMES, CACHE_REJECT_REASONS };
