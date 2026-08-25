# 교차 브라우저 검증 기록 — Chromium · Firefox · WebKit

- 상태: ✅ 3개 엔진 통과
- 검증일: 2026-08-25
- 대상 커밋: `74da179`
- 대상: 정적 앱 전체(9개 view), 실제 tokenizer 엔진, Service Worker, offline pin, 접근성, 320px reflow

이 기록은 P1부터 남아 있던 "Firefox/WebKit desktop·320px 검증" 게이트를 닫습니다.

## 1. 검증 방법과 그 한계

Playwright 1.62.1로 세 엔진을 같은 절차로 구동했습니다.

| 엔진 | 버전 |
|---|---|
| Chromium | 151.0.7922.34 |
| Firefox | 153.0 |
| WebKit | 26.5 |

**Playwright는 저장소에 설치하지 않았습니다.** 스크래치패드에만 두고 실행했으므로 `package.json`의 의존성은 여전히 0이며, 검증한 파일이 그대로 배포되는 성질을 유지합니다. axe-core를 다룬 방식과 같습니다.

### 명시할 한계

- **WebKit ≠ Safari.** Playwright의 WebKit은 WebKit 엔진 빌드이며 Apple이 배포하는 Safari 그 자체가 아닙니다. 렌더링·JS 엔진은 같은 계열이지만 Safari 고유의 정책(ITP, 저장소 만료, 확장)은 이 검증에 포함되지 않습니다.
- **실기기 Safari(iOS/macOS)와 Firefox Android는 검증하지 않았습니다.** 데스크톱 엔진 수준의 검증입니다.
- 각 실행은 **빈 프로필**에서 시작합니다. 즉 artifact를 매번 새로 내려받으므로, 여기 나온 동작은 "캐시가 있는 상태"가 아니라 "처음 방문"에 해당합니다.

## 2. 결과 요약

| 항목 | Chromium 151 | Firefox 153 | WebKit 26.5 |
|---|---|---|---|
| 실제 엔진 로드 | ✅ `gpt-4o` | ✅ `gpt-4o` | ✅ `gpt-4o` |
| 파이프라인 토큰 수 | 24 | 24 | 24 |
| Unicode (cp/byte/grapheme) | 5 / 12 / 5 | 5 / 12 / 5 | 5 / 12 / 5 |
| Inspector Token ID 행 | 24 | 24 | 24 |
| Builder 학습 | 15/15 단계 | 15/15 단계 | 15/15 단계 |
| 말뭉치 비교 | 16/16 셀 성공 | 16/16 셀 성공 | 16/16 셀 성공 |
| 모델 비교 | 24 ↔ 19 | 24 ↔ 19 | 24 ↔ 19 |
| 입력 샘플 매트릭스 | 7×7, 미지원 셀 0 | 7×7, 미지원 셀 0 | 7×7, 미지원 셀 0 |
| Service Worker | ✅ active | ✅ active | ✅ active |
| cache 개수 / 중복 소유 | 2 / 0 | 2 / 0 | 2 / 0 |
| offline pin 로드 | ✅ 6 tokens | ✅ 6 tokens | ✅ 6 tokens |
| axe violations (desktop/320px/en) | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| page error · console error · 4xx/5xx | 0 · 0 · 0 | 0 · 0 · 0 | 0 · 0 · 0 |

**세 엔진이 같은 입력에서 같은 토큰 수를 냅니다.** 파이프라인 24, Inspector 24행, 비교 24↔19, 벤치마크 16/16, offline 6 — 모두 일치합니다. 토큰화 결과가 브라우저에 의존하지 않는다는 뜻입니다.

## 3. 플랫폼 기능 지원 현황

| 기능 | Chromium | Firefox | WebKit | 앱에서 쓰는 곳 |
|---|:--:|:--:|:--:|---|
| `Intl.Segmenter` | ✅ | ✅ | ✅ | grapheme 계수 |
| `Object.hasOwn` | ✅ | ✅ | ✅ | lesson 채점, Worker 프로토콜 |
| `Array.prototype.at` | ✅ | ✅ | ✅ | Inspector diff |
| Cache API | ✅ | ✅ | ✅ | app shell, artifact |
| IndexedDB | ✅ | ✅ | ✅ | pin manifest |
| Service Worker | ✅ | ✅ | ✅ | app shell offline |
| module Worker | ✅ | ✅ | ✅ | tokenizer Worker entry |
| `crypto.subtle` | ✅ | ✅ | ✅ | custom artifact 지문 |
| `navigator.storage.estimate` | ✅ | ✅ | ❌ | 운영 화면 용량 표시 |

### 유일한 차이: WebKit의 storage estimate

WebKit은 `navigator.storage.estimate()`를 노출하지 않습니다. 운영 화면은 이를 **0으로 채우지 않고** 있는 그대로 표시합니다.

```text
Chromium  사용량 10.8 MiB   허용량 10250.8 MiB
Firefox   사용량  5.3 MiB   허용량 10240.0 MiB
WebKit    사용량 브라우저가 알려주지 않음   허용량 브라우저가 알려주지 않음
```

"모르는 값은 0이 아니라 사유로"라는 P0 원칙이 실제로 값을 하는 지점입니다. quota를 모르는 브라우저에서도 pin은 정상 동작하며(`quotaAvailable: false`이면 quota 검사를 건너뛰고 앱 자체 예산만 적용), WebKit에서 BERT를 pin해 `pin됨 · 2.8 MiB`가 나오는 것을 확인했습니다.

## 4. 저장소 소유권

세 엔진 모두 동일했습니다.

```text
app shell cache   58 files (전부 동일 출처)
artifact cache     4 files (전부 huggingface.co)
겹치는 URL         0
```

Service Worker는 세 엔진 모두 `active`이고 cache 목록은 `["transformers-cache", "tokenizer-app-shell-v1"]`입니다. 런타임이 소유한 artifact cache와 app shell cache가 분리된 상태가 브라우저와 무관하게 유지됩니다.

## 5. offline 동작

pin한 artifact가 네트워크 없이 동작하는지 세 엔진에서 각각 확인했습니다. `huggingface.co`로 가는 모든 fetch를 거부하도록 바꾸고 메모리 캐시를 비운 뒤 다시 로드했습니다.

```text
Chromium / Firefox / WebKit  →  pin: ok(pinned) · 차단된 호출 0 · '안녕 hello' → 6 tokens
```

차단된 호출이 **0**이라는 것은 네트워크를 시도조차 하지 않고 cache에서 바로 읽었다는 뜻입니다.

## 6. 접근성과 320px

axe-core 4.10.3 (`wcag2a`/`2aa`/`21a`/`21aa`/`best-practice`) 기준으로 9개 view를 데스크톱(1280×800)·320px·영어에서 각각 훑었습니다. **세 엔진 모두 violations 0건**입니다.

`incomplete` 항목은 Chromium에서 이미 검토한 것과 같은 범주(`aria-valid-attr-value` 1건 — `aria-haspopup`에 대한 axe 한계, `color-contrast` — `␣`·`✕` 기호와 가로 스크롤 밖 셀)이며 세 엔진에서 동일하게 나타납니다.

### 320px reflow

| 엔진 | `document.scrollWidth` |
|---|---|
| Chromium | 320 |
| Firefox | 320 |
| WebKit | 310, 320 |

WebKit의 310은 **넘침이 아니라 스크롤바 폭**입니다. 뷰포트 320px에서 세로 스크롤바가 10px를 차지해 문서 폭이 310으로 잡힙니다. 320을 초과하는 값이 없으므로 가로 넘침은 세 엔진 모두 없습니다.

## 7. 검증 중 고친 것 (검증 스크립트 쪽)

앱 결함은 나오지 않았고, 검증 스크립트에서 두 가지를 고쳤습니다. 기록해 둡니다.

1. **`page.waitForFunction`의 인자 순서.** Playwright 시그니처는 `(fn, arg, options)`인데 `{timeout}`을 두 번째로 넘겨 기본 30초가 적용됐습니다. 첫 실행에서 벤치마크가 30초에 끊긴 원인입니다.
2. **체크박스 클릭 시 DOM 재구성.** 말뭉치 비교의 열 선택은 `change`마다 목록을 다시 그립니다. 미리 모아 둔 노드 목록으로 반복 클릭하면 두 번째부터 분리된 노드를 눌러 아무 일도 일어나지 않습니다. 클릭할 때마다 다시 찾도록 바꿨습니다. (앱 동작은 의도된 것이라 바꾸지 않았습니다.)

또한 **입력 샘플 매트릭스 view가 artifact 6개를 동시에 내려받기 시작하면** 뒤이은 벤치마크가 대역폭에 굶습니다. 검증 순서를 "기능 확인 → 벤치마크 → 전체 view 훑기"로 바꿔 해결했습니다. 실사용에서는 문제가 아니지만, 첫 방문에 매트릭스 탭을 열면 약 90MB를 받는다는 사실은 기록해 둡니다.

## 8. 재검증 방법

검증 스크립트는 [`tools/cross-browser/`](../tools/cross-browser/)에 있습니다. Playwright는 저장소 의존성이 아니므로 별도로 설치해야 합니다.

```bash
python -m http.server 8020
```

```bash
npm --prefix <임시경로> install playwright && npx --prefix <임시경로> playwright install chromium firefox webkit
```

자세한 절차는 [`tools/cross-browser/README.md`](../tools/cross-browser/README.md)에 있습니다.

## 9. 남은 게이트

- 실기기 Safari(macOS/iOS)와 모바일 Firefox
- 목표 사용자 80% 사용성 측정 ([측정 프로토콜](P1-USABILITY-PROTOCOL.md))
- P2 선택적 공식 계수 gateway
- P4 public exact-SHA artifact 추가 경로
- P5 Unigram replay와 BPE를 다루는 5분 Learn 경로
