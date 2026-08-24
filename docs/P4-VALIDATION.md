# P4 검증 기록 — Platform & Extensibility

- 상태: cache 관리·app-shell offline·custom artifact 구현 완료 / core·CLI·SDK는 검토 결과 미패키징
- 검증일: 2026-08-25
- 기준 브랜치: `main`
- 대상: 정적 GitHub Pages UI, Cache manifest v1, Custom artifact v1, app shell Service Worker

## 1. 시작하며 바로잡은 설계

원래 계획은 `tokenizer-artifacts-v1`이라는 **새 artifact cache**를 만드는 것이었습니다. 구현 전에 실제 브라우저 상태를 확인한 결과, Transformers.js v3.8.1이 `env.useBrowserCache = true` 아래에서 이미 `caches.open("transformers-cache")`로 artifact 파일을 소유하고 있었습니다.

```text
caches.keys() → ["transformers-cache"]   // 6 artifact × 2 file = 12 entries
```

새 cache를 만들었다면 같은 파일을 두 벌 갖게 되어, 완료 조건 "app shell과 artifact cache가 같은 파일을 중복 소유하지 않음"을 스스로 위반했을 것입니다. 그래서 **런타임이 소유한 cache를 그대로 artifact 저장소로 채택**하고, 이 앱은 manifest(무엇을 언제 왜 고정했는지)만 따로 관리합니다.

이름이 바뀌면 조용히 다른 저장소를 가리키게 되므로 `tests/security.test.js`가 vendored 번들에서 `caches.open("transformers-cache")` 문자열을 직접 확인합니다.

## 2. 저장 소유권

| 저장소 | 소유자 | 담는 것 |
|---|---|---|
| `tokenizer-app-shell-v1` (Cache API) | 이 앱의 Service Worker | 동일 출처 HTML·CSS·JS·vendor 55개 |
| `transformers-cache` (Cache API) | Transformers.js v3.8.1 | artifact 파일 (huggingface.co) |
| IndexedDB `artifact-manifest` | 이 앱 | revision, 파일 목록, 용량, pin 상태, 검증 시각 |
| 메모리 LRU | `tokenizer.js` | 현재 활성 tokenizer |

실제 브라우저에서 측정한 소유권:

```text
app shell    55 files · 동일 출처 아닌 항목 0 · huggingface 항목 0
artifact      4 files · 전부 huggingface
겹치는 URL    0
```

`validateCacheOwnership()`이 이 검사를 화면(운영 탭)에서도 매번 수행하고 결과를 그대로 표시합니다.

## 3. cache에 기록해도 되는 응답

`classifyResponse()`가 판정하며, 성공처럼 보이지만 실제로는 실패인 응답을 정상 파일로 남기지 않습니다.

| 사유 | 막는 상황 |
|---|---|
| `non-ok-status` | 401·404 등 |
| `opaque-response` | 상태와 본문을 확인할 수 없는 응답 |
| `html-fallback` | 200으로 돌아온 HTML 오류·로그인 페이지 |
| `empty-body` | 길이 0 |
| `incomplete-body` | `Content-Length`와 실제 수신 바이트 불일치 |
| `file-too-large` | 파일 상한 초과 |
| `host-not-allowed` | 허용 host 밖 |
| `insecure-scheme` | http |
| `credentials-in-url` | URL에 자격증명 포함 |
| `revision-not-pinned` | 40자리 commit SHA가 아니거나 경로에 없음 |

한 파일이라도 거부되면 이미 받은 파일을 지우고 `incomplete`/`error`로 남깁니다. 반쪽짜리 pin이 offline 가능으로 보이지 않습니다. 허용되지 않은 URL은 **fetch를 시도하지도 않습니다**(테스트에서 fetch 호출 수 0 확인).

## 4. offline 표시와 실제 사용 가능성

pin하지 않아도 런타임이 부수적으로 파일을 남길 수 있습니다. "미pin"을 "offline 불가"로 읽으면 표시가 실제와 어긋나므로 상태를 셋으로 나눕니다.

| 표시 | 뜻 |
|---|---|
| `pin됨` | 사용자가 명시적으로 고정했고 파일 존재·크기를 검증함 |
| `런타임 캐시됨 (pin 아님)` | 파일은 있으나 사용자가 고정한 것이 아니며 언제든 사라질 수 있음 |
| `일부만 캐시됨 (n/2)` | 일부 파일만 존재 |
| `캐시 없음` | 없음 |

실제 화면 측정:

```text
BERT multilingual        pin됨 · 2.8 MiB
GPT-4o / Qwen3.5 / Llama 4 / Gemma 3 / DeepSeek-V3   런타임 캐시됨 (pin 아님)
```

### offline 동작 실증

pin한 artifact가 네트워크 없이 실제로 동작하는지 확인했습니다. `huggingface.co`로 가는 모든 fetch를 거부하도록 바꾼 뒤 메모리 캐시를 비우고 다시 로드했습니다.

```text
pin: ok (status=pinned)
차단된 네트워크 호출: 0      ← 네트워크를 시도조차 하지 않음
offline 로드: 성공, '안녕 hello' → 6 tokens
```

### 손상 감지

cache에서 파일 하나를 지운 뒤 `확인`을 누르면 상태가 `pin됨` → `불완전`으로 내려가고 offline 목록에서 빠집니다. 불완전 항목도 남은 조각을 지울 수 있도록 `pin 해제` 버튼을 함께 제공합니다(첫 구현에서 빠져 있어 캐시에 파일이 남던 것을 수정).

## 5. app shell Service Worker

`sw.js`는 app shell만 담습니다.

- **HTML은 network-first**입니다. 온라인이면 항상 최신 배포가 이기므로 배포가 막히지 않습니다.
- 나머지 동일 출처 `.js`/`.css`/`.json`도 network-first이고 cache는 offline 대비입니다. 처음에는 stale-while-revalidate였으나, 배포 직후 새 HTML과 이전 모듈이 한 번 섞여 새 화면이 빈 채로 뜨는 것을 실제로 관찰해 바꿨습니다(P5-VALIDATION 참고).
- **교차 출처 요청은 `respondWith` 자체를 호출하지 않습니다.** artifact 요청은 worker를 그대로 통과합니다.
- `activate`는 `tokenizer-app-shell-` 접두사의 구버전만 지우고 `transformers-cache`는 건드리지 않습니다.
- `install`은 `cache.addAll`로 원자적으로 받습니다. 하나라도 실패하면 설치를 포기해 반쪽짜리 shell이 남지 않습니다.
- 200이 아니거나 HTML로 돌아온 자산 응답은 기록하지 않습니다.
- 운영 탭에서 등록·해제·app shell cache 삭제를 직접 할 수 있으며, 파괴적 동작은 두 번 눌러야 실행됩니다.

`sw.js`는 Node의 `vm`으로 가짜 `ServiceWorkerGlobalScope`에 올려 **실제로 실행**하며 테스트합니다. 소스 문자열 검사가 아니라 동작 검사입니다.

실제 브라우저 확인:

```text
scope        http://localhost:8010/
scriptURL    http://localhost:8010/sw.js
state        active
caches       ["transformers-cache", "tokenizer-app-shell-v1"]
```

배포 갱신 흐름도 실제로 확인했습니다. 초기 stale-while-revalidate에서는 `operateView.js` 수정 후 첫 새로고침에서 cache만 갱신되고 두 번째 새로고침에서 화면에 반영되었습니다. P5에서 자산도 network-first로 바꾼 뒤에는 첫 새로고침에 바로 반영됩니다.

## 6. custom artifact (세션 한정)

로컬 `tokenizer.json`(필수), `tokenizer_config.json`·`special_tokens_map.json`(선택)을 받아 검증한 뒤에만 세션 한정 artifact로 등록합니다.

검증 순서와 상한:

1. 파일 이름 화이트리스트, 최대 3개, 파일당 32 MiB, 합계 48 MiB
2. **remote code 차단** — `auto_map`, `trust_remote_code`, `custom_object`, `code_revision`을 raw 텍스트와 파싱 결과 양쪽에서 찾고, `owner/repo--Module.Class`처럼 모듈 경로를 가리키는 `*_class` 값을 거부
3. component 화이트리스트 — model / normalizer / pre_tokenizer / post_processor / decoder 타입이 huggingface/tokenizers 사양의 이름일 때만 통과. `Sequence` 하위도 재귀 검사
4. 깊이 16·노드 20,000 상한. 큰 `vocab`/`merges`는 개수만 확인하고 깊이 탐색하지 않음
5. SHA-256 지문 (업로드 순서와 무관)
6. `new PreTrainedTokenizer(json, config)` — 공개 생성자만 사용, 원격 모듈 로딩 경로 없음
7. encode → decode smoke test

실제 브라우저 확인(BERT multilingual 파일 업로드):

```text
검증 통과 · WordPiece · vocab 119,547 · 2,919,677 bytes
지문 SHA-256  dedc12587d5e60e6ea4d8d42…
revision      로컬 파일에는 commit revision이 없습니다
encode → decode  9 tokens · differs
라이선스      메타데이터 없음
→ 모델 목록에 local/custom-dedc1258 로 추가
→ 파이프라인에서 "실제 엔진 · custom-dedc1258", 26 tokens, revision local:dedc12587d5e60e6
```

`differs`는 정직한 결과입니다. smoke 문장 `Hello 안녕하세요 🤗`의 emoji가 BERT에서 `[UNK]`가 되므로 왕복이 일치하지 않습니다. lossless로 표시하지 않습니다.

거부 경로도 확인했습니다.

```text
tokenizer_config.json에 auto_map 포함 → "거부: remote-code (auto_map)"
```

세션 한정 규칙: 업로드 파일은 어디에도 저장하지 않습니다. `tokenizer.js`가 `localStorage`·`sessionStorage`·`indexedDB`를 쓰지 않는 것을 테스트로 잠갔습니다.

## 7. 검증 결과

### 결정론적 테스트

```text
npm test
tests 229
pass 229
fail 0
```

P4에서 추가한 범위:

- URL 정책: https·허용 host·자격증명·40자리 commit SHA
- 응답 정책: 404·401·opaque·HTML fallback·빈 본문·길이 불일치·크기 초과
- manifest: 합계 불일치 거부, 파일 없는 pinned 거부, 중복 URL, 오류 사유 필수
- 소유권: 중복 소유·app shell의 원격 파일·artifact cache의 미허용 host
- quota: pin 개수 상한, 앱 예산, 브라우저 quota 초과/부족, quota 미보고 시 추정 금지
- migration: 알 수 없거나 더 새로운 schema version은 읽지 않고 초기화
- pin 흐름: 완전 성공, 중간 실패 시 조각 삭제, 검증 실패 시 등급 하향, 삭제, 런타임 캐시와 pin 구분
- Service Worker 실행: install 원자성, activate가 artifact cache 보존, 교차 출처 미개입, HTML network-first와 offline fallback, HTML 오류 페이지 미기록, 자산 network-first와 offline fallback(P5에서 갱신)
- custom artifact: 파일·크기·중복, remote code(raw/parsed/클래스 경로), component 화이트리스트, 깊이·노드 상한, vocab·added_tokens 상한, 지문 안정성, smoke 실패 판정, 서술자가 revision·라이선스를 지어내지 않음
- 정적: 운영 탭 마크업, main landmark 포함, pin 파일 목록이 런타임 요청과 일치, 순수 모듈의 DOM·네트워크·`eval` 부재

### 접근성

axe-core 4.10.3 기준 **violations 0건**입니다.

| 조건 | 대상 | violations |
|---|---|---:|
| 1280×720 / ko | 8개 view | 0 |
| 1280×720 / en | 8개 view | 0 |
| 320×720 / ko | 8개 view | 0 |

수정한 위반: `empty-table-header` — artifact 표의 동작 열 머리글이 비어 있어 `동작`/`Actions` 라벨을 부여했습니다. 320px에서 `document.scrollWidth = 320`이고 `#operateView` 하위에 뷰포트를 넘는 요소가 없습니다(자체 가로 스크롤을 갖는 표 내부 제외). console 오류 0건.

## 8. 완료 조건 대조

| 조건 | 상태 |
|---|---|
| app shell과 artifact cache가 같은 파일을 중복 소유하지 않음 | ✅ 런타임 cache를 채택해 두 벌을 만들지 않음. 실측 겹침 0 |
| offline 표시가 실제 사용 가능한 artifact와 일치 | ✅ pin/런타임 캐시/일부/없음 4단계 + 네트워크 차단 상태에서 실제 로드 성공 |
| 401/404, HTML fallback, opaque response, 부분 파일을 정상 cache로 기록하지 않음 | ✅ 사유별로 거부하고 조각을 삭제 |
| custom artifact가 remote code를 실행하지 않고 리소스 상한을 지킴 | ✅ 4겹 검증 + 공개 생성자만 사용 |
| 라이선스·revision·engine compatibility가 export에 남음 | ✅ 서술자가 라이선스 `unknown`, revision `null` + 사유, engine 버전을 보존 |

## 9. core·CLI·SDK 검토 결과

로드맵의 "embeddable analysis core, CLI, provider/engine adapter SDK **검토**"는 [`ADR 0002`](adr/0002-embeddable-core-cli-and-adapter-sdk.md)로 답했습니다. 결론은 **지금 패키징하지 않고 경계만 유지**입니다.

- 이 저장소는 의존성 0이고, 검증한 파일이 그대로 배포됩니다. npm 패키징은 빌드 단계를 요구해 그 성질을 깹니다.
- Node에서 실제 토큰 수를 내려면 네이티브 런타임 의존이 따라옵니다. 토큰 수를 못 내는 CLI는 지금 수요가 확인되지 않았습니다.
- core 경계는 이미 존재하며 테스트가 지킵니다. 순수 모듈은 DOM·네트워크·`eval`을 참조하지 않습니다.
- 다시 여는 조건을 ADR에 명시했습니다.

## 10. 남은 게이트

- 실제 오프라인(비행기 모드) 왕복은 fetch 차단으로 대체 검증했습니다. 브라우저 전체를 오프라인으로 두고 첫 진입부터 확인하는 것은 남았습니다.
- public HF artifact를 사용자가 직접 `owner/repo@SHA`로 추가하는 경로는 구현하지 않았습니다. 검증 로직(`classifyArtifactUrl`, `parseCustomArtifact`)은 이미 그 경로를 받을 수 있게 되어 있습니다.
- Service Worker의 다중 탭·구버전 활성 상태 전환은 실사용 관찰이 남았습니다.
- P1에서 이어지는 Firefox/WebKit 검증과 목표 사용자 사용성 측정
- P2의 선택적 공식 계수 gateway

## 11. 재검증 명령

```bash
npm test
```

브라우저에서 `운영` 탭을 열고 저장소 소유권·Service Worker 상태를 확인하고, artifact 하나를 pin → 확인 → cache에서 파일 삭제 후 다시 확인(불완전으로 하향) → pin 해제 순서를 따라갑니다. custom artifact는 정상 파일과 `auto_map`이 든 파일을 각각 올려 통과·거부를 확인합니다.
