// operateView.js — P4 운영 화면. 저장 상태, artifact pin, 세션 한정 custom artifact,
// 데이터 신선도를 실제 값으로만 보여준다.
import { el } from './dom.js';
import { state } from './state.js';
import { ARTIFACTS_VERIFIED_AT, MODELS, TOKENIZER_ENGINE_COMPATIBILITY } from './artifacts.js';
import { PRICING_AS_OF, PRICING_CATALOG, formatInt } from './pricing.js';
import { buildModelSelect } from './pipeline.js';
import { registerSessionTokenizer } from './tokenizer.js';
import { CACHE_NAMES, validateCacheOwnership } from './cacheManifest.js';
import { ArtifactCacheManager, createIndexedDbManifestStore } from './artifactCache.js';
import { resolvePricingFreshness } from './costScenario.js';
import {
    CUSTOM_ARTIFACT_FILES,
    createCustomArtifactDescriptor,
    evaluateSmokeTest,
    fingerprintCustomArtifact,
    parseCustomArtifact,
} from './customArtifact.js';

const COPY = Object.freeze({
    ko: {
        tab: '운영',
        storageTitle: '저장소와 app shell',
        storageNote: 'artifact 파일은 Transformers.js가 소유한 cache를 그대로 쓰고, app shell은 별도 cache에 둡니다. 두 저장소는 같은 파일을 갖지 않습니다.',
        artifactsTitle: 'Artifact와 offline pin',
        customTitle: 'Custom artifact (세션 한정)',
        freshnessTitle: '데이터 신선도',
        cacheApi: 'Cache API', indexedDb: 'IndexedDB', available: '사용 가능', unavailable: '사용 불가',
        usage: '사용량', quota: '허용량', quotaUnknown: '브라우저가 알려주지 않음',
        pinnedCount: 'pin된 artifact', pinnedBytes: 'pin 용량',
        ownership: '저장소 소유권', ownershipOk: '중복 소유 없음', ownershipBad: '중복 소유 발견',
        swTitle: 'Service Worker', swActive: '활성', swWaiting: '대기 중', swNone: '미등록', swUnsupported: '미지원',
        swRegister: '등록', swUnregister: '해제', swClearShell: 'app shell cache 삭제',
        swNote: 'HTML은 항상 네트워크를 먼저 시도하고, 실패할 때만 cache를 씁니다. artifact 요청은 Service Worker가 건드리지 않습니다.',
        confirm: '한 번 더 누르면 실행합니다',
        colArtifact: 'Artifact', colRevision: 'revision', colLicense: '라이선스', colSize: '크기', colPin: 'offline', colActions: '동작',
        pin: 'pin', unpin: 'pin 해제', verify: '확인', pinning: 'pin 중',
        statusPinned: 'pin됨', statusNotPinned: '캐시 없음', statusIncomplete: '불완전', statusError: '오류',
        statusRuntimeCached: '런타임 캐시됨 (pin 아님)',
        statusRuntimePartial: '일부만 캐시됨 ({present}/{total})',
        licenseUnknown: '메타데이터 없음',
        chooseFiles: '파일 선택',
        customNote: 'tokenizer.json은 필수, tokenizer_config.json과 special_tokens_map.json은 선택입니다. 파일은 브라우저 밖으로 나가지 않고 새로고침하면 사라집니다.',
        customAccepted: '검증 통과 · {model} · vocab {vocab} · {bytes} bytes',
        customFingerprint: '지문 SHA-256',
        customSmoke: 'encode → decode',
        customRejected: '거부: {code} ({detail})',
        customRegistered: '모델 목록에 세션 한정으로 추가했습니다.',
        customNoRevision: '로컬 파일에는 commit revision이 없습니다',
        pricingAsOf: '단가 기준일', artifactVerifiedAt: 'artifact 검증일', engine: 'engine',
        countSemantics: 'count 의미',
        refresh: '새로고침',
        failed: '작업을 완료하지 못했습니다',
    },
    en: {
        tab: 'Operate',
        storageTitle: 'Storage and app shell',
        storageNote: 'Artifact files stay in the cache the Transformers.js runtime owns; the app shell uses a separate cache. The two never hold the same file.',
        artifactsTitle: 'Artifacts and offline pins',
        customTitle: 'Custom artifact (session only)',
        freshnessTitle: 'Data freshness',
        cacheApi: 'Cache API', indexedDb: 'IndexedDB', available: 'available', unavailable: 'unavailable',
        usage: 'Usage', quota: 'Quota', quotaUnknown: 'not reported by the browser',
        pinnedCount: 'Pinned artifacts', pinnedBytes: 'Pinned bytes',
        ownership: 'Storage ownership', ownershipOk: 'no duplicate ownership', ownershipBad: 'duplicate ownership found',
        swTitle: 'Service worker', swActive: 'active', swWaiting: 'waiting', swNone: 'not registered', swUnsupported: 'unsupported',
        swRegister: 'Register', swUnregister: 'Unregister', swClearShell: 'Clear app shell cache',
        swNote: 'HTML always tries the network first and falls back to the cache only on failure. Artifact requests are never handled by the service worker.',
        confirm: 'press again to confirm',
        colArtifact: 'Artifact', colRevision: 'Revision', colLicense: 'License', colSize: 'Size', colPin: 'Offline', colActions: 'Actions',
        pin: 'Pin', unpin: 'Unpin', verify: 'Verify', pinning: 'Pinning',
        statusPinned: 'pinned', statusNotPinned: 'not cached', statusIncomplete: 'incomplete', statusError: 'error',
        statusRuntimeCached: 'runtime cached (not pinned)',
        statusRuntimePartial: 'partially cached ({present}/{total})',
        licenseUnknown: 'no metadata',
        chooseFiles: 'Choose files',
        customNote: 'tokenizer.json is required; tokenizer_config.json and special_tokens_map.json are optional. Files never leave the browser and disappear on reload.',
        customAccepted: 'Accepted · {model} · vocab {vocab} · {bytes} bytes',
        customFingerprint: 'SHA-256 fingerprint',
        customSmoke: 'encode → decode',
        customRejected: 'Rejected: {code} ({detail})',
        customRegistered: 'Added to the model list for this session only.',
        customNoRevision: 'A local file has no commit revision',
        pricingAsOf: 'Rates as of', artifactVerifiedAt: 'Artifact verified', engine: 'Engine',
        countSemantics: 'Count semantics',
        refresh: 'Refresh',
        failed: 'The action could not be completed',
    },
});

const SMOKE_TEXT = 'Hello 안녕하세요 🤗';
let manager = null;
let pendingConfirm = null;
let customStatus = null;

function copy() {
    return COPY[state.lang] || COPY.ko;
}

function format(template, values) {
    return Object.entries(values).reduce(
        (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
        template,
    );
}

function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function metric(parent, label, value, tone = 'note') {
    const box = element('div', 'operate-metric');
    box.dataset.tone = tone;
    box.append(element('span', null, label), element('strong', null, value));
    parent.append(box);
    return box;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function artifactFileUrls(model) {
    // Transformers.js v3.8.1이 실제로 요청하는 두 파일만 pin한다.
    return ['tokenizer.json', 'tokenizer_config.json'].map(
        (name) => `https://huggingface.co/${model.id}/resolve/${model.revision}/${name}`,
    );
}

export function getCacheManager() {
    if (manager) return manager;
    const manifestStore = createIndexedDbManifestStore();
    manager = new ArtifactCacheManager({
        cacheStorage: globalThis.caches ?? null,
        manifestStore,
        estimateStorage: navigator.storage?.estimate
            ? () => navigator.storage.estimate()
            : null,
    });
    return manager;
}

// ── Service Worker ──────────────────────────────────────────────────────────

function workerSupported() {
    return 'serviceWorker' in navigator && globalThis.isSecureContext === true;
}

export async function registerAppShellWorker() {
    if (!workerSupported()) return { supported: false, registered: false };
    try {
        const scope = new URL('./', window.location.href).pathname;
        const registration = await navigator.serviceWorker.register(new URL('./sw.js', window.location.href), { scope });
        return { supported: true, registered: true, registration };
    } catch (error) {
        return { supported: true, registered: false, error: String(error?.message || error) };
    }
}

async function workerStatus() {
    if (!workerSupported()) return { supported: false, state: 'unsupported' };
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return { supported: true, state: 'none' };
    if (registration.active) return { supported: true, state: 'active', registration };
    if (registration.waiting || registration.installing) return { supported: true, state: 'waiting', registration };
    return { supported: true, state: 'none', registration };
}

async function unregisterWorker() {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) await registration.unregister();
    for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_NAMES.appShellPrefix)) await caches.delete(name);
    }
}

async function clearAppShellCaches() {
    for (const name of await caches.keys()) {
        // artifact cache는 런타임 소유이므로 여기서 지우지 않는다.
        if (name.startsWith(CACHE_NAMES.appShellPrefix)) await caches.delete(name);
    }
}

/** 두 번 눌러야 실행되는 파괴적 동작. 네이티브 확인창 없이 되돌릴 기회를 준다. */
function confirmAction(button, key, run) {
    if (pendingConfirm !== key) {
        pendingConfirm = key;
        button.dataset.confirming = 'true';
        button.title = copy().confirm;
        setTimeout(() => {
            if (pendingConfirm !== key) return;
            pendingConfirm = null;
            button.dataset.confirming = 'false';
        }, 4000);
        renderOperate();
        return;
    }
    pendingConfirm = null;
    button.dataset.confirming = 'false';
    run();
}

// ── 렌더링 ──────────────────────────────────────────────────────────────────

async function renderStorage() {
    const text = copy();
    const box = clear(el('operateStorage'));
    const cacheManager = getCacheManager();
    const summary = await cacheManager.summary();

    metric(box, text.cacheApi, globalThis.caches ? text.available : text.unavailable,
        globalThis.caches ? 'ok' : 'warn');
    metric(box, text.indexedDb, globalThis.indexedDB ? text.available : text.unavailable,
        globalThis.indexedDB ? 'ok' : 'warn');
    metric(box, text.usage, summary.quotaAvailable ? formatBytes(summary.usage) : text.quotaUnknown);
    metric(box, text.quota, summary.quotaAvailable ? formatBytes(summary.quota) : text.quotaUnknown);
    metric(box, text.pinnedCount, `${summary.pinnedCount}`);
    metric(box, text.pinnedBytes, formatBytes(summary.pinnedBytes));

    const shellUrls = [];
    if (globalThis.caches) {
        for (const name of await caches.keys()) {
            if (!name.startsWith(CACHE_NAMES.appShellPrefix)) continue;
            const cache = await caches.open(name);
            for (const request of await cache.keys()) shellUrls.push(request.url);
        }
    }
    const ownership = validateCacheOwnership({
        appShellUrls: shellUrls,
        artifactUrls: await cacheManager.cachedUrls(),
        origin: window.location.origin,
    });
    metric(
        box,
        text.ownership,
        ownership.valid ? text.ownershipOk : `${text.ownershipBad}: ${ownership.problems[0].code}`,
        ownership.valid ? 'ok' : 'warn',
    );

    const status = await workerStatus();
    const stateLabel = {
        unsupported: text.swUnsupported, none: text.swNone, active: text.swActive, waiting: text.swWaiting,
    }[status.state];
    metric(box, text.swTitle, stateLabel, status.state === 'active' ? 'ok' : 'note');

    const actions = clear(el('operateStorageActions'));
    if (status.supported) {
        const register = element('button', 'view-tab', text.swRegister);
        register.type = 'button';
        register.disabled = status.state === 'active';
        register.addEventListener('click', async () => {
            await registerAppShellWorker();
            renderOperate();
        });
        const unregister = element('button', 'view-tab', text.swUnregister);
        unregister.type = 'button';
        unregister.disabled = status.state === 'none';
        unregister.addEventListener('click', () => confirmAction(unregister, 'sw-unregister', async () => {
            await unregisterWorker();
            renderOperate();
        }));
        const clearShell = element('button', 'view-tab', text.swClearShell);
        clearShell.type = 'button';
        clearShell.addEventListener('click', () => confirmAction(clearShell, 'shell-clear', async () => {
            await clearAppShellCaches();
            renderOperate();
        }));
        actions.append(register, unregister, clearShell);
    }
    actions.append(element('span', 'p1-note', text.swNote));
}

async function renderArtifacts() {
    const text = copy();
    const box = clear(el('operateArtifacts'));
    const cacheManager = getCacheManager();
    const entries = await cacheManager.list();
    const byId = new Map(entries.map((entry) => [entry.artifactId, entry]));

    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const label of [text.colArtifact, text.colRevision, text.colLicense, text.colSize, text.colPin, text.colActions]) {
        const cell = element('th', null, label);
        cell.scope = 'col';
        head.append(cell);
    }
    table.append(head);

    for (const model of MODELS) {
        const entry = byId.get(model.id) || null;
        // pin하지 않아도 런타임이 남긴 파일이 있을 수 있다. 그 차이를 숨기지 않는다.
        const runtime = entry && entry.status === 'pinned'
            ? null
            : await cacheManager.inspectRuntimeCache(artifactFileUrls(model));
        const row = document.createElement('tr');
        row.dataset.status = entry
            ? entry.status
            : (runtime && runtime.complete ? 'runtime-cached' : 'not-pinned');
        const name = element('th', null, model.label);
        name.scope = 'row';
        row.append(name);
        row.append(element('td', 'operate-mono', model.revision.slice(0, 12)));
        row.append(element('td', null, model.license.status === 'declared'
            ? model.license.identifier
            : text.licenseUnknown));
        row.append(element('td', 'operate-num', formatBytes(model.operations.fileSize.totalBytes)));

        let statusLabel = {
            pinned: text.statusPinned, incomplete: text.statusIncomplete, error: text.statusError,
        }[entry?.status] || text.statusNotPinned;
        if (!entry && runtime && runtime.complete) statusLabel = text.statusRuntimeCached;
        else if (!entry && runtime && runtime.present > 0) {
            statusLabel = format(text.statusRuntimePartial, { present: runtime.present, total: runtime.total });
        }
        row.append(element('td', null, entry && entry.status === 'pinned'
            ? `${statusLabel} · ${formatBytes(entry.totalBytes)}`
            : statusLabel));

        const actions = element('td', 'operate-actions');
        if (cacheManager.available) {
            if (entry && entry.status === 'pinned') {
                const verify = element('button', 'view-tab', text.verify);
                verify.type = 'button';
                verify.addEventListener('click', async () => {
                    await cacheManager.verify(model.id);
                    renderOperate();
                });
                actions.append(verify);
            }
            if (!entry || entry.status !== 'pinned') {
                const pin = element('button', 'view-tab', text.pin);
                pin.type = 'button';
                pin.addEventListener('click', async () => {
                    pin.disabled = true;
                    pin.textContent = text.pinning;
                    // 다시 받기 전에 남아 있는 조각을 먼저 지운다.
                    if (entry) await cacheManager.unpin(model.id);
                    const result = await cacheManager.pin({
                        id: model.id,
                        revision: model.revision,
                        files: artifactFileUrls(model),
                        expectedBytes: model.operations.fileSize.totalBytes,
                    });
                    if (!result.ok) el('operateStatus').textContent = `${text.failed}: ${result.reason}`;
                    renderOperate();
                });
                actions.append(pin);
            }
            // pin이 깨진 항목도 남은 조각을 지울 수 있어야 한다.
            if (entry) {
                const unpin = element('button', 'view-tab', text.unpin);
                unpin.type = 'button';
                unpin.addEventListener('click', async () => {
                    await cacheManager.unpin(model.id);
                    renderOperate();
                });
                actions.append(unpin);
            }
        }
        row.append(actions);
        table.append(row);
    }
    box.append(table);
}

function renderFreshness() {
    const text = copy();
    const box = clear(el('operateFreshness'));
    const today = new Date().toISOString().slice(0, 10);
    const freshness = resolvePricingFreshness({ verifiedAt: PRICING_AS_OF, at: today });

    metric(box, text.pricingAsOf, `${PRICING_AS_OF} · ${freshness.status} (${freshness.ageDays}d)`,
        freshness.status === 'fresh' ? 'ok' : 'warn');
    metric(box, text.artifactVerifiedAt, ARTIFACTS_VERIFIED_AT);
    metric(box, text.engine, `${TOKENIZER_ENGINE_COMPATIBILITY.package}@${TOKENIZER_ENGINE_COMPATIBILITY.version}`);
    metric(box, text.countSemantics, PRICING_CATALOG.countSemantics);
}

function renderCustom() {
    const text = copy();
    const box = clear(el('operateCustomResult'));
    if (!customStatus) return;
    if (!customStatus.ok) {
        const node = element('div', 'operate-reject', format(text.customRejected, {
            code: customStatus.code,
            detail: String(customStatus.detail ?? '').slice(0, 160),
        }));
        box.append(node);
        return;
    }
    const { descriptor } = customStatus;
    metric(box, text.customAccepted.split('·')[0].trim(), format(text.customAccepted, {
        model: descriptor.summary.modelType,
        vocab: formatInt(descriptor.summary.vocabSize),
        bytes: formatInt(descriptor.totalBytes),
    }), 'ok');
    metric(box, text.customFingerprint, descriptor.fingerprint.available
        ? descriptor.fingerprint.sha256.slice(0, 24)
        : text.unavailable);
    metric(box, text.colRevision, text.customNoRevision, 'warn');
    metric(box, text.customSmoke, `${descriptor.smoke.tokens} tokens · ${descriptor.smoke.roundTrip}`,
        descriptor.smoke.roundTrip === 'lossless' ? 'ok' : 'warn');
    metric(box, text.colLicense, text.licenseUnknown, 'warn');
    box.append(element('div', 'p1-note', text.customRegistered));
}

export async function renderOperate() {
    try {
        await renderStorage();
        await renderArtifacts();
    } catch (error) {
        el('operateStatus').textContent = `${copy().failed}: ${String(error?.message || error).slice(0, 160)}`;
    }
    renderFreshness();
    renderCustom();
}

async function onCustomFiles(fileList) {
    const text = copy();
    customStatus = null;
    try {
        const files = [];
        for (const file of fileList) files.push({ name: file.name, text: await file.text() });

        const parsed = parseCustomArtifact(files);
        if (!parsed.ok) {
            customStatus = parsed;
            renderCustom();
            return;
        }
        const fingerprint = await fingerprintCustomArtifact(files);
        const id = `local/custom-${fingerprint.sha256 ? fingerprint.sha256.slice(0, 8) : 'session'}`;
        const { tok } = registerSessionTokenizer({
            id,
            label: `Custom · ${parsed.summary.modelType}`,
            tokenizerJson: parsed.tokenizerJson,
            tokenizerConfig: parsed.tokenizerConfig,
            descriptor: { fingerprint, summary: parsed.summary },
        });

        const encoded = tok(SMOKE_TEXT, { add_special_tokens: true, return_tensor: false });
        const ids = Array.isArray(encoded.input_ids[0]) ? encoded.input_ids[0] : encoded.input_ids;
        const smoke = evaluateSmokeTest({
            text: SMOKE_TEXT,
            ids: Array.from(ids, Number),
            decoded: tok.decode(Array.from(ids, Number), { skip_special_tokens: true }),
        });

        const descriptor = createCustomArtifactDescriptor({
            parsed,
            fingerprint,
            smoke,
            engineCompatibility: TOKENIZER_ENGINE_COMPATIBILITY,
        });
        customStatus = { ok: true, descriptor };
        buildModelSelect();
    } catch (error) {
        customStatus = { ok: false, code: 'load-failed', detail: String(error?.message || error) };
    }
    renderCustom();
}

export function applyOperateLanguage() {
    const text = copy();
    el('tabOperate').textContent = text.tab;
    el('operateStorageTitle').textContent = text.storageTitle;
    el('operateStorageNote').textContent = text.storageNote;
    el('operateArtifactsTitle').textContent = text.artifactsTitle;
    el('operateCustomTitle').textContent = text.customTitle;
    el('operateCustomNote').textContent = text.customNote;
    el('operateFreshnessTitle').textContent = text.freshnessTitle;
    el('labelOperateCustomFiles').textContent = text.chooseFiles;
    el('operateRefreshBtn').textContent = text.refresh;
    el('operateCustomFiles').setAttribute(
        'aria-label',
        `${text.chooseFiles}: ${[...CUSTOM_ARTIFACT_FILES.required, ...CUSTOM_ARTIFACT_FILES.optional].join(', ')}`,
    );
}

export function initOperate() {
    el('operateRefreshBtn').addEventListener('click', renderOperate);
    el('operateCustomFiles').addEventListener('change', (event) => {
        onCustomFiles([...event.target.files]);
        event.target.value = '';
    });
}
