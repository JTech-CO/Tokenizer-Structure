import test from 'node:test';
import assert from 'node:assert/strict';

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
    validateCacheOwnership,
} from '../js/cacheManifest.js';

const REVISION = '7956d98f2a83b2751a98ea7136fdf7fe6cf54e69';
const FILE_URL = `https://huggingface.co/Xenova/gpt-4o/resolve/${REVISION}/tokenizer.json`;

function entry(overrides = {}) {
    return {
        artifactId: 'Xenova/gpt-4o',
        revision: REVISION,
        files: [{ url: FILE_URL, bytes: 100 }],
        totalBytes: 100,
        status: 'pinned',
        pinnedAt: '2026-08-25T00:00:00.000Z',
        verifiedAt: '2026-08-25T00:00:00.000Z',
        error: null,
        ...overrides,
    };
}

test('artifact URLs require https, an allowed host, and a pinned commit SHA', () => {
    assert.equal(classifyArtifactUrl(FILE_URL, { revision: REVISION }).allowed, true);

    assert.equal(
        classifyArtifactUrl(FILE_URL.replace('https:', 'http:')).reason,
        CACHE_REJECT_REASONS.INSECURE_SCHEME,
    );
    assert.equal(
        classifyArtifactUrl('https://user:pass@huggingface.co/a/resolve/x/tokenizer.json').reason,
        CACHE_REJECT_REASONS.CREDENTIALS_IN_URL,
    );
    assert.equal(
        classifyArtifactUrl('https://evil.example.com/tokenizer.json').reason,
        CACHE_REJECT_REASONS.HOST_NOT_ALLOWED,
    );
    // 이름표 revision은 재현이 되지 않으므로 거부한다.
    assert.equal(
        classifyArtifactUrl('https://huggingface.co/a/resolve/main/tokenizer.json', { revision: 'main' }).reason,
        CACHE_REJECT_REASONS.REVISION_NOT_PINNED,
    );
    assert.equal(
        classifyArtifactUrl(FILE_URL, { revision: 'a'.repeat(40) }).reason,
        CACHE_REJECT_REASONS.REVISION_NOT_PINNED,
    );
    assert.equal(classifyArtifactUrl('not a url').allowed, false);
});

test('only a complete 200 body from an allowed host may be cached', () => {
    const base = { url: FILE_URL, revision: REVISION, status: 200, type: 'basic', contentType: 'application/json', contentLength: 100, receivedBytes: 100 };
    assert.deepEqual(classifyResponse(base), { cacheable: true, reason: null });

    assert.equal(classifyResponse({ ...base, status: 404 }).reason, CACHE_REJECT_REASONS.NON_OK_STATUS);
    assert.equal(classifyResponse({ ...base, status: 401 }).reason, CACHE_REJECT_REASONS.NON_OK_STATUS);
    assert.equal(classifyResponse({ ...base, type: 'opaque' }).reason, CACHE_REJECT_REASONS.OPAQUE_RESPONSE);
    assert.equal(classifyResponse({ ...base, type: 'opaqueredirect' }).reason, CACHE_REJECT_REASONS.OPAQUE_RESPONSE);
    // 200으로 돌아오는 HTML 오류 페이지를 정상 파일로 기록하지 않는다.
    assert.equal(
        classifyResponse({ ...base, contentType: 'text/html; charset=utf-8' }).reason,
        CACHE_REJECT_REASONS.HTML_FALLBACK,
    );
    assert.equal(classifyResponse({ ...base, receivedBytes: 0, contentLength: 0 }).reason, CACHE_REJECT_REASONS.EMPTY_BODY);
    assert.equal(classifyResponse({ ...base, receivedBytes: 60 }).reason, CACHE_REJECT_REASONS.INCOMPLETE_BODY);
    assert.equal(
        classifyResponse({ ...base, receivedBytes: CACHE_LIMITS.maxFileBytes + 1, contentLength: null }).reason,
        CACHE_REJECT_REASONS.FILE_TOO_LARGE,
    );
    assert.equal(
        classifyResponse({ ...base, contentLength: CACHE_LIMITS.maxFileBytes + 1, receivedBytes: null }).reason,
        CACHE_REJECT_REASONS.FILE_TOO_LARGE,
    );
    assert.equal(
        classifyResponse({ ...base, url: 'https://evil.example.com/x.json' }).reason,
        CACHE_REJECT_REASONS.HOST_NOT_ALLOWED,
    );
    // Content-Length가 없는 응답은 길이 검사를 건너뛰되 다른 조건은 그대로 적용한다.
    assert.equal(classifyResponse({ ...base, contentLength: null }).cacheable, true);
});

test('a manifest entry must agree with the files it claims to hold', () => {
    const normalized = normalizeCacheEntry(entry());
    assert.equal(normalized.schemaVersion, CACHE_MANIFEST_SCHEMA_VERSION);
    assert.equal(normalized.totalBytes, 100);

    assert.throws(() => normalizeCacheEntry(entry({ totalBytes: 999 })), /sum of file bytes/);
    assert.throws(() => normalizeCacheEntry(entry({ status: 'pinned', files: [], totalBytes: 0 })), /cannot be pinned/);
    assert.throws(() => normalizeCacheEntry(entry({ revision: 'main' })), /commit SHA/);
    assert.throws(() => normalizeCacheEntry(entry({ status: 'gone' })), /unknown pin status/);
    assert.throws(
        () => normalizeCacheEntry(entry({ files: [{ url: FILE_URL, bytes: 1 }, { url: FILE_URL, bytes: 1 }], totalBytes: 2 })),
        /duplicate file url/,
    );
    assert.throws(() => normalizeCacheEntry(entry({ status: 'error', error: null })), /required for an error/);
    assert.throws(() => normalizeCacheEntry(entry({ extra: 1 })), /unknown field/);
});

test('the app shell and the artifact cache may not own the same file', () => {
    const shell = ['https://app.example/index.html', 'https://app.example/js/main.js'];
    assert.equal(validateCacheOwnership({ appShellUrls: shell, artifactUrls: [FILE_URL], origin: 'https://app.example' }).valid, true);

    const duplicated = validateCacheOwnership({
        appShellUrls: [...shell, FILE_URL],
        artifactUrls: [FILE_URL],
        origin: 'https://app.example',
    });
    assert.equal(duplicated.valid, false);
    assert.equal(duplicated.problems[0].code, 'duplicate-ownership');

    const remoteInShell = validateCacheOwnership({
        appShellUrls: [FILE_URL],
        artifactUrls: [],
        origin: 'https://app.example',
    });
    assert.ok(remoteInShell.problems.some((problem) => problem.code === 'app-shell-holds-remote-file'));

    const badArtifact = validateCacheOwnership({
        appShellUrls: shell,
        artifactUrls: ['https://evil.example.com/tokenizer.json'],
        origin: 'https://app.example',
    });
    assert.ok(badArtifact.problems.some((problem) => problem.code === 'artifact-cache-holds-disallowed-host'));
});

test('the app shell cache is versioned and separate from the runtime artifact cache', () => {
    assert.ok(CACHE_NAMES.appShell.startsWith(CACHE_NAMES.appShellPrefix));
    // artifact 파일은 Transformers.js가 이미 소유한 cache를 그대로 쓴다. 두 벌을 만들지 않는다.
    assert.equal(CACHE_NAMES.artifacts, 'transformers-cache');
    assert.equal(CACHE_NAMES.artifactsOwner, '@huggingface/transformers@3.8.1');
    assert.ok(!CACHE_NAMES.artifacts.startsWith(CACHE_NAMES.appShellPrefix));
});

test('only a genuinely pinned artifact is reported as offline ready', () => {
    const summary = summarizeCache([
        entry(),
        entry({ artifactId: 'a/b', status: 'incomplete', error: 'aborted', files: [], totalBytes: 0, pinnedAt: null }),
        entry({ artifactId: 'c/d', status: 'not-pinned', files: [], totalBytes: 0, pinnedAt: null }),
    ]);
    assert.deepEqual(summary.offlineReadyArtifactIds, ['Xenova/gpt-4o']);
    assert.deepEqual(summary.incompleteArtifactIds, ['a/b']);
    assert.equal(summary.pinnedCount, 1);
    assert.equal(summary.pinnedBytes, 100);
    assert.equal(summary.totalBytes, 100);
});

test('quota checks block a new pin before the browser runs out of room', () => {
    const pinned = Array.from({ length: CACHE_LIMITS.maxPinnedArtifacts }, (_, index) => entry({ artifactId: `a/${index}` }));
    assert.ok(quotaStatus({ entries: pinned, requestedBytes: 1 }).problems.some((p) => p.code === 'pin-limit-reached'));

    const overBudget = quotaStatus({ entries: [], requestedBytes: CACHE_LIMITS.maxTotalBytes + 1 });
    assert.ok(overBudget.problems.some((problem) => problem.code === 'app-budget-exceeded'));
    assert.equal(overBudget.allowed, false);

    const overQuota = quotaStatus({ usage: 90, quota: 100, requestedBytes: 50, entries: [] });
    assert.ok(overQuota.problems.some((problem) => problem.code === 'storage-quota-exceeded'));

    const lowQuota = quotaStatus({ usage: 95, quota: 100, requestedBytes: 1, entries: [] });
    assert.deepEqual(lowQuota.problems.map((problem) => problem.code), ['storage-quota-low']);
    assert.equal(lowQuota.allowed, true, 'a low-space warning must not block the pin outright');

    // 브라우저가 quota를 알려주지 않으면 추정하지 않는다.
    const unknown = quotaStatus({ entries: [], requestedBytes: 1 });
    assert.equal(unknown.quotaAvailable, false);
    assert.equal(unknown.allowed, true);
});

test('an unknown stored schema version resets instead of being misread', () => {
    assert.deepEqual(planMigration(null).action, 'initialize');
    assert.deepEqual(planMigration(CACHE_MANIFEST_SCHEMA_VERSION).action, 'none');
    assert.deepEqual(planMigration(CACHE_MANIFEST_SCHEMA_VERSION + 1).action, 'reset');
    assert.equal(planMigration(CACHE_MANIFEST_SCHEMA_VERSION + 1).reason, 'newer-than-supported');
    assert.deepEqual(planMigration(0).action, 'reset');
    assert.deepEqual(planMigration('1').action, 'reset');
});
