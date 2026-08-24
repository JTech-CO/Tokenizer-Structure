// cacheManifest.js — P4 저장 소유권과 cache 기록 정책(순수).
// app shell과 artifact cache가 같은 파일을 중복 소유하지 않고,
// 401/404·HTML fallback·opaque·부분 응답을 정상 cache로 기록하지 않는다.

export const CACHE_MANIFEST_SCHEMA_VERSION = 1;

// app shell cache 이름에만 버전을 넣어 구버전을 activate에서 정리한다.
//
// artifact 파일은 Transformers.js v3.8.1이 `caches.open("transformers-cache")`로
// 이미 소유하고 있다. 별도 cache를 만들면 같은 파일을 두 벌 갖게 되므로,
// 이 앱은 그 cache를 artifact 저장소로 그대로 쓰고 manifest만 따로 관리한다.
// 이름이 바뀌면 tests/security.test.js의 vendor 검사에서 드러난다.
export const CACHE_NAMES = Object.freeze({
    appShellPrefix: 'tokenizer-app-shell-',
    appShell: 'tokenizer-app-shell-v1',
    artifacts: 'transformers-cache',
    artifactsOwner: '@huggingface/transformers@3.8.1',
});

export const CACHE_LIMITS = Object.freeze({
    maxFileBytes: 64 * 1024 * 1024,
    maxArtifactBytes: 96 * 1024 * 1024,
    maxTotalBytes: 512 * 1024 * 1024,
    maxFilesPerArtifact: 12,
    maxPinnedArtifacts: 4,
    // 남은 quota가 이 비율 아래면 새 pin을 막는다.
    minFreeQuotaRatio: 0.1,
});

export const ARTIFACT_HOST_ALLOWLIST = Object.freeze([
    'huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co', 'cdn-lfs.hf.co',
]);

export const CACHE_REJECT_REASONS = Object.freeze({
    NON_OK_STATUS: 'non-ok-status',
    OPAQUE_RESPONSE: 'opaque-response',
    HTML_FALLBACK: 'html-fallback',
    EMPTY_BODY: 'empty-body',
    INCOMPLETE_BODY: 'incomplete-body',
    FILE_TOO_LARGE: 'file-too-large',
    HOST_NOT_ALLOWED: 'host-not-allowed',
    INSECURE_SCHEME: 'insecure-scheme',
    CREDENTIALS_IN_URL: 'credentials-in-url',
    REVISION_NOT_PINNED: 'revision-not-pinned',
});

export const PIN_STATUSES = Object.freeze(['not-pinned', 'pinning', 'pinned', 'incomplete', 'error']);

const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const STATUS_SET = new Set(PIN_STATUSES);

function fail(path, message) {
    throw new TypeError(path + ': ' + message);
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(value, allowed, path) {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) fail(path + '.' + key, 'unknown field');
    }
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function nonNegativeInteger(value, path) {
    if (!Number.isSafeInteger(value) || value < 0) fail(path, 'expected a non-negative safe integer');
    return value;
}

/**
 * artifact 파일 URL이 허용된 host와 고정 revision을 쓰는지 확인한다.
 * 자격증명이 포함된 URL과 http는 허용하지 않는다.
 */
export function classifyArtifactUrl(url, { revision = null } = {}) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { allowed: false, reason: CACHE_REJECT_REASONS.HOST_NOT_ALLOWED };
    }
    if (parsed.protocol !== 'https:') {
        return { allowed: false, reason: CACHE_REJECT_REASONS.INSECURE_SCHEME };
    }
    if (parsed.username !== '' || parsed.password !== '') {
        return { allowed: false, reason: CACHE_REJECT_REASONS.CREDENTIALS_IN_URL };
    }
    if (!ARTIFACT_HOST_ALLOWLIST.includes(parsed.hostname)) {
        return { allowed: false, reason: CACHE_REJECT_REASONS.HOST_NOT_ALLOWED };
    }
    // 이름표(main, refs/…)로는 재현이 되지 않으므로 40자리 commit SHA만 허용한다.
    if (revision !== null && !REVISION_PATTERN.test(revision)) {
        return { allowed: false, reason: CACHE_REJECT_REASONS.REVISION_NOT_PINNED };
    }
    if (revision !== null && !parsed.pathname.includes(revision)) {
        return { allowed: false, reason: CACHE_REJECT_REASONS.REVISION_NOT_PINNED };
    }
    return { allowed: true, reason: null };
}

/**
 * 응답을 cache에 기록해도 되는지 판정한다.
 * 성공처럼 보이지만 실제로는 실패인 응답을 정상 cache로 남기지 않는 것이 목적이다.
 */
export function classifyResponse({
    url,
    status,
    type = 'basic',
    contentType = null,
    contentLength = null,
    receivedBytes = null,
    revision = null,
    maxFileBytes = CACHE_LIMITS.maxFileBytes,
} = {}) {
    const urlCheck = classifyArtifactUrl(url, { revision });
    if (!urlCheck.allowed) return { cacheable: false, reason: urlCheck.reason };

    // opaque 응답은 상태와 본문을 확인할 수 없으므로 성공으로 취급하지 않는다.
    if (type === 'opaque' || type === 'opaqueredirect') {
        return { cacheable: false, reason: CACHE_REJECT_REASONS.OPAQUE_RESPONSE };
    }
    if (status !== 200) return { cacheable: false, reason: CACHE_REJECT_REASONS.NON_OK_STATUS };
    // 401/404가 HTML 오류 페이지로 200처럼 돌아오는 경우를 막는다.
    if (typeof contentType === 'string' && /^text\/html\b/i.test(contentType.trim())) {
        return { cacheable: false, reason: CACHE_REJECT_REASONS.HTML_FALLBACK };
    }
    if (receivedBytes !== null) {
        nonNegativeInteger(receivedBytes, 'receivedBytes');
        if (receivedBytes === 0) return { cacheable: false, reason: CACHE_REJECT_REASONS.EMPTY_BODY };
        if (receivedBytes > maxFileBytes) {
            return { cacheable: false, reason: CACHE_REJECT_REASONS.FILE_TOO_LARGE };
        }
    }
    if (contentLength !== null && receivedBytes !== null) {
        nonNegativeInteger(contentLength, 'contentLength');
        if (contentLength !== receivedBytes) {
            return { cacheable: false, reason: CACHE_REJECT_REASONS.INCOMPLETE_BODY };
        }
    }
    if (contentLength !== null && receivedBytes === null && contentLength > maxFileBytes) {
        return { cacheable: false, reason: CACHE_REJECT_REASONS.FILE_TOO_LARGE };
    }
    return { cacheable: true, reason: null };
}

export function normalizeCacheEntry(value, path = 'cacheEntry') {
    if (!isPlainObject(value)) fail(path, 'expected a plain object');
    assertKnownKeys(
        value,
        ['schemaVersion', 'artifactId', 'revision', 'files', 'totalBytes', 'status', 'pinnedAt', 'verifiedAt', 'error'],
        path,
    );
    if (hasOwn(value, 'schemaVersion') && value.schemaVersion !== CACHE_MANIFEST_SCHEMA_VERSION) {
        fail(`${path}.schemaVersion`, `expected ${CACHE_MANIFEST_SCHEMA_VERSION}`);
    }
    if (typeof value.artifactId !== 'string' || value.artifactId === '') {
        fail(`${path}.artifactId`, 'expected a non-empty string');
    }
    if (typeof value.revision !== 'string' || !REVISION_PATTERN.test(value.revision)) {
        fail(`${path}.revision`, 'expected a 40-character commit SHA');
    }
    if (!STATUS_SET.has(value.status)) fail(`${path}.status`, 'unknown pin status');

    if (!Array.isArray(value.files)) fail(`${path}.files`, 'expected an array');
    if (value.files.length > CACHE_LIMITS.maxFilesPerArtifact) {
        fail(`${path}.files`, `must not exceed ${CACHE_LIMITS.maxFilesPerArtifact} files`);
    }
    const seen = new Set();
    const files = value.files.map((file, index) => {
        const filePath = `${path}.files[${index}]`;
        if (!isPlainObject(file)) fail(filePath, 'expected a plain object');
        assertKnownKeys(file, ['url', 'bytes'], filePath);
        const check = classifyArtifactUrl(file.url, { revision: value.revision });
        if (!check.allowed) fail(`${filePath}.url`, check.reason);
        if (seen.has(file.url)) fail(`${filePath}.url`, 'duplicate file url');
        seen.add(file.url);
        nonNegativeInteger(file.bytes, `${filePath}.bytes`);
        if (file.bytes > CACHE_LIMITS.maxFileBytes) fail(`${filePath}.bytes`, 'exceeds the per-file limit');
        return { url: file.url, bytes: file.bytes };
    });

    const measured = files.reduce((sum, file) => sum + file.bytes, 0);
    const totalBytes = hasOwn(value, 'totalBytes') ? value.totalBytes : measured;
    nonNegativeInteger(totalBytes, `${path}.totalBytes`);
    // 저장된 합계가 실제 파일 합과 다르면 조용히 덮지 않고 손상으로 본다.
    if (totalBytes !== measured) fail(`${path}.totalBytes`, `must equal the sum of file bytes (${measured})`);
    if (totalBytes > CACHE_LIMITS.maxArtifactBytes) {
        fail(`${path}.totalBytes`, 'exceeds the per-artifact limit');
    }
    // pinned는 실제로 파일을 갖고 있을 때만 주장할 수 있다.
    if (value.status === 'pinned' && files.length === 0) {
        fail(`${path}.status`, 'cannot be pinned with no cached files');
    }

    const pinnedAt = hasOwn(value, 'pinnedAt') ? value.pinnedAt : null;
    const verifiedAt = hasOwn(value, 'verifiedAt') ? value.verifiedAt : null;
    for (const [key, stamp] of [['pinnedAt', pinnedAt], ['verifiedAt', verifiedAt]]) {
        if (stamp !== null && (typeof stamp !== 'string' || Number.isNaN(Date.parse(stamp)))) {
            fail(`${path}.${key}`, 'expected an ISO timestamp or null');
        }
    }
    const error = hasOwn(value, 'error') ? value.error : null;
    if (error !== null && (typeof error !== 'string' || error === '')) {
        fail(`${path}.error`, 'expected a non-empty string or null');
    }
    if ((value.status === 'error' || value.status === 'incomplete') && error === null) {
        fail(`${path}.error`, 'is required for an error or incomplete entry');
    }

    return {
        schemaVersion: CACHE_MANIFEST_SCHEMA_VERSION,
        artifactId: value.artifactId,
        revision: value.revision,
        files,
        totalBytes,
        status: value.status,
        pinnedAt,
        verifiedAt,
        error,
    };
}

/**
 * 두 cache가 같은 URL을 동시에 소유하는지 확인한다.
 * app shell은 동일 출처 자산만, artifact cache는 허용 host만 가져야 한다.
 */
export function validateCacheOwnership({ appShellUrls = [], artifactUrls = [], origin = null } = {}) {
    const shell = new Set(appShellUrls);
    const overlap = artifactUrls.filter((url) => shell.has(url));
    const problems = [];
    if (overlap.length > 0) {
        problems.push({ code: 'duplicate-ownership', urls: overlap.slice(0, 10) });
    }
    const foreignShell = appShellUrls.filter((url) => {
        if (origin === null) return false;
        try {
            return new URL(url, origin).origin !== origin;
        } catch {
            return true;
        }
    });
    if (foreignShell.length > 0) {
        problems.push({ code: 'app-shell-holds-remote-file', urls: foreignShell.slice(0, 10) });
    }
    const foreignArtifact = artifactUrls.filter((url) => !classifyArtifactUrl(url).allowed);
    if (foreignArtifact.length > 0) {
        problems.push({ code: 'artifact-cache-holds-disallowed-host', urls: foreignArtifact.slice(0, 10) });
    }
    return { valid: problems.length === 0, problems };
}

export function summarizeCache(entries = []) {
    const normalized = entries.map((entry, index) => normalizeCacheEntry(entry, `entries[${index}]`));
    const pinned = normalized.filter((entry) => entry.status === 'pinned');
    return {
        schemaVersion: CACHE_MANIFEST_SCHEMA_VERSION,
        entries: normalized,
        pinnedCount: pinned.length,
        // 사용 가능하다고 표시하는 것은 실제로 pinned인 항목뿐이다.
        offlineReadyArtifactIds: pinned.map((entry) => entry.artifactId),
        incompleteArtifactIds: normalized
            .filter((entry) => entry.status === 'incomplete' || entry.status === 'error')
            .map((entry) => entry.artifactId),
        totalBytes: normalized.reduce((sum, entry) => sum + entry.totalBytes, 0),
        pinnedBytes: pinned.reduce((sum, entry) => sum + entry.totalBytes, 0),
    };
}

export function quotaStatus({ usage = null, quota = null, requestedBytes = 0, entries = [] } = {}) {
    nonNegativeInteger(requestedBytes, 'requestedBytes');
    const summary = summarizeCache(entries);
    const problems = [];

    if (summary.pinnedCount >= CACHE_LIMITS.maxPinnedArtifacts) {
        problems.push({ code: 'pin-limit-reached', limit: CACHE_LIMITS.maxPinnedArtifacts });
    }
    if (summary.totalBytes + requestedBytes > CACHE_LIMITS.maxTotalBytes) {
        problems.push({ code: 'app-budget-exceeded', limit: CACHE_LIMITS.maxTotalBytes });
    }
    if (usage !== null && quota !== null) {
        nonNegativeInteger(usage, 'usage');
        nonNegativeInteger(quota, 'quota');
        const free = quota - usage - requestedBytes;
        if (free < 0) problems.push({ code: 'storage-quota-exceeded', free });
        else if (quota > 0 && free / quota < CACHE_LIMITS.minFreeQuotaRatio) {
            problems.push({ code: 'storage-quota-low', free });
        }
    }
    return {
        allowed: problems.every((problem) => problem.code === 'storage-quota-low'),
        problems,
        usage,
        quota,
        // 브라우저가 quota를 알려주지 않으면 추정하지 않는다.
        quotaAvailable: usage !== null && quota !== null,
    };
}

/**
 * 저장된 schema version에서 현재 version으로 가는 계획.
 * 알 수 없는 버전은 조용히 읽지 않고 초기화 대상으로 표시한다.
 */
export function planMigration(storedVersion) {
    if (storedVersion === null || storedVersion === undefined) {
        return { action: 'initialize', from: null, to: CACHE_MANIFEST_SCHEMA_VERSION };
    }
    if (storedVersion === CACHE_MANIFEST_SCHEMA_VERSION) {
        return { action: 'none', from: storedVersion, to: CACHE_MANIFEST_SCHEMA_VERSION };
    }
    if (!Number.isSafeInteger(storedVersion) || storedVersion < 1) {
        return { action: 'reset', from: storedVersion, to: CACHE_MANIFEST_SCHEMA_VERSION, reason: 'invalid-version' };
    }
    if (storedVersion > CACHE_MANIFEST_SCHEMA_VERSION) {
        // 더 새로운 버전이 쓴 데이터를 낮은 버전이 해석하면 손상된다.
        return { action: 'reset', from: storedVersion, to: CACHE_MANIFEST_SCHEMA_VERSION, reason: 'newer-than-supported' };
    }
    return { action: 'migrate', from: storedVersion, to: CACHE_MANIFEST_SCHEMA_VERSION };
}
