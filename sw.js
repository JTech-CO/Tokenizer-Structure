// sw.js — app shell 전용 Service Worker.
//
// 정책
//  1. app shell(HTML/CSS/JS/vendor)만 담는다. artifact 파일은 담지 않는다.
//     artifact는 Transformers.js가 소유한 'transformers-cache'가 관리하므로
//     이 worker가 건드리면 같은 파일을 두 벌 갖게 된다.
//  2. HTML과 자산 모두 network-first다. 온라인이면 항상 최신 배포가 이긴다.
//     자산을 stale-while-revalidate로 두면 새 HTML과 이전 모듈이 한 번 섞여
//     새 화면이 빈 채로 뜬다(실제로 배포 직후 관찰됨). cache는 offline 대비다.
//  3. 교차 출처 요청(huggingface.co 포함)은 respondWith 자체를 하지 않는다.
//  4. 200이 아니거나 HTML로 돌아온 자산 응답은 cache에 기록하지 않는다.
//
// APP_SHELL 목록은 tests/serviceWorker.test.js가 실제 파일 목록과 대조한다.

const SHELL_CACHE = 'tokenizer-app-shell-v1';
const SHELL_PREFIX = 'tokenizer-app-shell-';
// 런타임이 소유하는 artifact cache. 이 worker는 절대 지우거나 쓰지 않는다.
const RUNTIME_ARTIFACT_CACHE = 'transformers-cache';

const APP_SHELL = [
    './',
    'index.html',
    'llm_tokenizer_simulator.html',
    'css/analysis.css',
    'css/base.css',
    'css/controls.css',
    'css/p1.css',
    'css/p2.css',
    'css/p3.css',
    'css/p4.css',
    'css/p5.css',
    'css/utilities.css',
    'css/views.css',
    'js/analysisContract.js',
    'js/analysisOptions.js',
    'js/artifactCache.js',
    'js/artifacts.js',
    'js/benchmarkDomain.js',
    'js/benchmarkRun.js',
    'js/benchmarkView.js',
    'js/bpeTrainer.js',
    'js/builderView.js',
    'js/byteDisplay.js',
    'js/cacheManifest.js',
    'js/chatTemplate.js',
    'js/compare.js',
    'js/contextBudget.js',
    'js/corpus.js',
    'js/costModal.js',
    'js/costScenario.js',
    'js/customArtifact.js',
    'js/dom.js',
    'js/hover.js',
    'js/i18n.js',
    'js/inputEditor.js',
    'js/inspectorDomain.js',
    'js/inspectorView.js',
    'js/latestRequest.js',
    'js/learnView.js',
    'js/lessons.js',
    'js/main.js',
    'js/matrix.js',
    'js/operateView.js',
    'js/pipeline.js',
    'js/presentation.js',
    'js/presentationView.js',
    'js/presets.js',
    'js/pricing.js',
    'js/requestContract.js',
    'js/requestLabView.js',
    'js/state.js',
    'js/tokenizer.js',
    'js/tokenizerWorker.js',
    'js/tokenizerWorkerClient.js',
    'js/tokenizerWorkerEntry.js',
    'js/unicodeMetrics.js',
    'js/workerProtocol.js',
    'vendor/huggingface-transformers-3.8.1.min.js',
];

const ASSET_PATTERN = /\.(?:js|css|json)$/;
const HTML_CONTENT_TYPE = /^text\/html\b/i;

function isCacheableAssetResponse(response) {
    if (!response || response.status !== 200 || response.type === 'opaque') return false;
    const contentType = response.headers.get('content-type') || '';
    // GitHub Pages가 없는 파일에 HTML 404 페이지를 돌려주는 경우를 막는다.
    return !HTML_CONTENT_TYPE.test(contentType.trim());
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        // 하나라도 실패하면 설치를 포기한다. 반쪽짜리 shell을 offline 가능으로 두지 않는다.
        await cache.addAll(APP_SHELL.map((path) => new URL(path, self.location.href).toString()));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) {
            if (name === RUNTIME_ARTIFACT_CACHE) continue;
            if (name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE) await caches.delete(name);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const response = await fetch(request);
        if (response.status === 200 && response.type !== 'opaque') {
            await cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const fallback = new URL('llm_tokenizer_simulator.html', self.location.href).toString();
        const cached = (await cache.match(request)) || (await cache.match(fallback));
        if (cached) return cached;
        throw error;
    }
}

async function assetNetworkFirst(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const response = await fetch(request);
        if (isCacheableAssetResponse(response)) await cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    // 교차 출처(artifact 포함)는 이 worker의 소유가 아니다.
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request));
        return;
    }
    if (ASSET_PATTERN.test(url.pathname)) {
        event.respondWith(assetNetworkFirst(request));
    }
});
