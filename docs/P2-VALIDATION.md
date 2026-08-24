# P2 검증 기록 — Request & Context Token Lab

- 상태: Request Composer·chat template overhead·컨텍스트·비용 시나리오 구현 완료 / 선택적 공식 계수 gateway 미구현
- 검증일: 2026-08-25
- 기준 브랜치: `main`
- 대상: 정적 GitHub Pages UI, `RequestSpec`/`RequestAnalysisResult` v1, Transformers.js v3.8.1 chat template 경로

## 1. 완료 범위

### RequestSpec / RequestAnalysisResult v1

`js/requestContract.js`에 요청 구조의 버전된 계약을 추가했습니다.

- `messages`(system/user/assistant/tool), `tools`, `documents`, `addGenerationPrompt`를 canonical 형태로 정규화합니다.
- tool schema는 이름 형식, 직렬화 바이트(20,000), 중첩 깊이(8), 위험 키(`__proto__` 등)를 모두 제한합니다. 사용자가 붙여넣는 임의 JSON이 그대로 흘러가지 않습니다.
- 결과는 `raw`(본문만), `template`(직렬화 후), `overhead`를 **독립 수치**로 보존하며, `overhead.tokens !== template - raw`이면 계약이 거부합니다.
- 능력은 `detectedBy: 'runtime-probe'`가 아니면 `available: true`가 될 수 없습니다. 모델 이름으로 기능을 추정하는 경로 자체를 계약에서 막았습니다.
- `providerCounts.preflight`/`.actual` 자리는 존재하되 `status: 'not-configured'`이며, 값이 null이 아니면 계약이 거부합니다.

### chat template 능력의 런타임 판정

`js/chatTemplate.js`는 고정된 probe 대화를 실제로 렌더링해 능력을 판정합니다.

- 렌더 결과에 probe 표식이 나타나는지로 `tools`·`documents`·각 role 지원을 구분합니다.
- 렌더가 **성공했지만 필드가 사라진 경우**(`template-ignores-field`)와 **렌더 자체가 거부된 경우**(`template-rejects-input`)를 다른 사유로 분리합니다.
- system 표식과 user 표식 사이가 공백뿐이면 전용 system turn이 없는 것으로 보고 `system-merged-into-first-turn`을 기록합니다.
- probe 표식에는 역할 이름을 넣지 않습니다. `zzprobesystemzz` 같은 표식은 "system" 문자열 검사와 충돌해 병합 판정을 망가뜨렸습니다.

### 정확히 합산되는 세그먼트

요청을 고정된 순서로 한 요소씩 더해가며 각 단계의 토큰 차이를 세그먼트로 만듭니다.

```
메시지 1..n  →  tools  →  documents  →  generation prompt
```

각 세그먼트는 실제 토큰 수 두 개의 차이이므로 합이 전체와 정확히 같습니다. 6개 artifact 전부에서 `Σ segments === template.tokenCount`를 확인했습니다.

일부 템플릿은 중간 prefix를 거부합니다. Qwen3.5는 user turn이 없는 `[system]` 단독 prefix에 `No user query found in messages.`를 던집니다. 이 경우 렌더 가능한 지점까지 메시지를 **묶어서** 하나의 세그먼트로 보고하고(`system #1 + user #2`), 세그먼트는 덮은 역할 목록 `roles`를 함께 보존합니다. 끝까지 렌더되지 않는 꼬리 그룹은 추정하지 않고 `template-rejects-input`으로 남깁니다.

### 특수 토큰 중복 경고

Transformers.js v3.8.1의 `apply_chat_template`은 `tokenize: true`일 때 내부적으로 `add_special_tokens: false`로 토큰화합니다. 따라서 직렬화 결과 문자열을 사용자가 다시 `add_special_tokens: true`로 토큰화하면 BOS/EOS가 중복됩니다. 이 앱은 두 경로를 모두 계수해 차이를 중복 토큰 수로 보고합니다.

### 컨텍스트 예산

`js/contextBudget.js`는 순수 함수로 다음을 계산합니다.

- 세그먼트 누적 timeline, 입력 예산(`컨텍스트 − 출력 여유 − 추론 여유`), 남은 예산
- 예산을 처음 넘는 세그먼트를 truncation 예상 지점으로 표시하되, `local-budget-prediction-not-provider-policy`를 결과에 남깁니다
- 마지막 user 메시지 이전 구간을 고정 prefix 후보로, 이후를 가변 suffix로 분리합니다. 제공사 캐시 적격성(최소 길이·TTL·과금)은 데이터가 없으므로 `catalog-has-no-rate`로 표시합니다
- turn마다 새 요청을 보낼 때의 누적 재입력 토큰을 계산하고 `one-request-per-user-turn-no-cache` 가정을 명시합니다

세그먼트 하나라도 측정 불가면 그 지점부터의 누적값을 추정하지 않습니다.

### 비용 시나리오

`js/costScenario.js`는 카탈로그 데이터만으로 계산하고 없는 것은 만들지 않습니다.

- `baseRate`, 적용 구간(tier), 호출당·일간·월간 시나리오
- `longContext` modifier는 카탈로그의 `tiered` 데이터로 실제 판정합니다
- `cachedRead`, `cachedWrite`, `batch`, `priority`, `flex`, `region`과 5개 tool 과금은 카탈로그에 단가가 없으므로 **0이 아니라** `catalog-has-no-rate` 사유와 함께 제외 항목으로 표시합니다
- `effectiveFrom`/`effectiveUntil`/`guaranteedThrough`/`sunsetEarliest`/`replacement`를 수명주기로 해석하고 30/7/1일 경고 구간을 적용합니다
- 만료·미개시 단가는 비용을 숫자로 내지 않고 `unavailable`로 반환합니다
- 통화는 USD 단일이며 환율 소스는 `not-provided`로 선언합니다

## 2. 실제 artifact 측정 결과

기본 요청(system 1 + user 2 + assistant 1, tool 1개, documents 0개, generation prompt on)을 6개 artifact에 동일하게 적용했습니다.

| artifact | 본문만 | 템플릿 적용 | overhead | 배율 | tools 세그먼트 | 특수토큰 중복 | Σ세그먼트 일치 |
|---|---:|---:|---:|---:|---:|---:|:--:|
| Xenova/gpt-4o | 46 | 미지원 | 미지원 | — | — | — | — |
| onnx-community/Qwen3.5-0.8B-ONNX | 48 | 334 | +286 | ×6.96 | 262 | 0 | ✅ |
| Xenova/llama4-tokenizer | 42 | 214 | +172 | ×5.10 | 147 | 1 | ✅ |
| onnx-community/gemma-3-1b-it-ONNX | 47 | 64 | +17 | ×1.36 | 0 | 1 | ✅ |
| deepseek-ai/DeepSeek-V3 | 54 | 60 | +6 | ×1.11 | 0 | 0 | ✅ |
| Xenova/bert-base-multilingual-cased | 52 | 미지원 | 미지원 | — | — | — | — |

`warnings`는 6개 모두 0건입니다.

능력 판정 결과:

| artifact | chat template | generation prompt | tools | documents | system | assistant | tool role |
|---|---|---|---|---|---|---|---|
| GPT-4o | ❌ 없음 | — | — | — | — | — | — |
| Qwen3.5 | ✅ | ✅ | ✅ | ❌ 무시 | ✅ | ✅ | ✅ |
| Llama 4 | ✅ | ✅ | ✅ | ❌ 무시 | ✅ | ✅ | ✅ |
| Gemma 3 | ✅ | ✅ | ❌ 무시 | ❌ 무시 | ✅ (첫 turn 병합) | ✅ | ❌ 거부 |
| DeepSeek-V3 | ✅ | ✅ | ❌ 무시 | ❌ 무시 | ✅ | ✅ | ✅ |
| BERT | ❌ 없음 | — | — | — | — | — | — |

읽는 법: 같은 tool schema 하나가 Qwen3.5에서는 262 토큰을 더하고 Gemma 3·DeepSeek-V3에서는 템플릿이 무시하므로 0 토큰입니다. 이 0은 "비용이 없다"가 아니라 "이 템플릿은 tool schema를 요청에 넣지 않는다"는 뜻이며, 화면에서도 `template-ignores-field`로 표시합니다.

### 계약 동등성 확인

`renderTemplate(tokenize:false)` 후 별도로 토큰화한 결과가 `apply_chat_template(tokenize:true)`의 길이와 같은지 Qwen3.5·Gemma 3에서 실제로 확인했습니다(둘 다 일치). 이 동등성이 성립해야 직렬화 문자열 표시와 토큰 수가 같은 대상을 가리킵니다.

## 3. 명시적 지원 경계

| 항목 | 현재 상태 | 표시 원칙 |
|---|---|---|
| chat template 직렬화 | artifact별 실제 판정 | 없으면 `artifact-no-chat-template`, 본문 계수만 실제 값으로 유지 |
| tools / documents | 템플릿별 조건부 | 무시/거부를 구분해 사유 표시, 0 토큰을 "무료"로 읽지 않게 함 |
| role 지원 | 템플릿별 조건부 | 병합·삭제·거부를 각각 다른 사유로 기록 |
| 비텍스트 modality | 미지원 | 항상 제외 항목으로 노출, 0으로 표시하지 않음 |
| provider preflight 계수 | 미연동 | `gateway-not-configured`, 값 없음 |
| provider actual usage | 미연동 | `gateway-not-configured`, 값 없음 |
| cached read/write, batch, priority, flex, region | 카탈로그에 단가 없음 | `catalog-has-no-rate` 제외 항목 |
| tool 과금(검색·파일·스토리지 등) | 카탈로그에 단가 없음 | `catalog-has-no-rate` 제외 항목 |
| 환율 | 미설정 | USD 단일, `not-provided` |
| truncation 지점 | 로컬 예산 예측 | 제공사 정책이 아님을 결과와 화면에 명시 |

**로컬 토큰 수 ≠ 제공사 토큰 수.** 비용 패널은 제공사 API 단가와 로컬 artifact 토큰 수를 곱하므로, 두 토크나이저가 같다고 주장하지 않는다는 `countSemantics`를 화면에 항상 함께 표시합니다.

## 4. 검증 결과

### 결정론적 테스트

```text
npm test
tests 140
pass 140
fail 0
```

P2에서 추가한 범위:

- 요청 계약: 역할·빈 내용·알 수 없는 필드 거부, tool schema 이름/깊이/바이트/`__proto__` 차단, 중복 tool 이름
- overhead ↔ template − raw 불일치 거부, 값 없는 수치의 `unavailableReason` 강제
- 능력이 probe 없이 `available: true`가 되는 것 차단
- 세그먼트 id 중복·알 수 없는 kind 거부, `role`과 `roles` 일치 강제
- 템플릿 능력 probe: 전체 지원 / 필드 무시 / 입력 거부 / system 병합
- 세그먼트 정확 합산, 중간 prefix 거부 시 그룹화, 꼬리 그룹 unavailable
- `render → count`와 `apply_chat_template(tokenize:true)` 동등성
- 특수 토큰 중복 계수
- 컨텍스트: 누적·예산·truncation 경계(예산과 정확히 같으면 truncation 아님)·미측정 시 누적 중단·캐시 prefix 분리·turn 재입력(그룹 세그먼트 포함)
- 비용: 티어 경계 N-1/N/N+1, 날짜 경계 D-1/D/D+1, 30/7/1일 경고, 미개시 단가, 만료 시 null 반환, 미지원 modifier가 0이 아님, 신선도 구간, 잘못된 달력 날짜(2026-02-30) 거부, 전체 카탈로그 스모크
- 정적: Request Lab 마크업·main landmark 포함·자격증명 패턴 부재·제공사 엔드포인트 부재·`fetch` 부재

`Date.parse('2026-02-30T00:00:00Z')`가 2026-03-02로 굴러가는 것을 테스트로 발견해 왕복 비교로 막았습니다. 날짜 경계 기능에서 조용한 날짜 롤오버는 잘못된 만료 판정으로 이어집니다.

### 접근성

axe-core 4.10.3 (`wcag2a`/`2aa`/`21a`/`21aa`/`best-practice`) 기준 Request Lab에서 **violations 0건**입니다.

| 조건 | violations |
|---|---:|
| 1280×800 / ko | 0 |
| 1280×800 / en | 0 |
| 1280×800 / 직렬화 결과 펼침 | 0 |
| 320×720 / ko | 0 |

320px에서 `document.scrollWidth = 320`이고 `#requestView` 하위에 뷰포트를 넘는 요소가 없습니다. `incomplete` 항목은 P1과 같은 범주(`✕` 기호의 `nonBmp`, 스크롤 영역 밖 요소의 `elmPartiallyObscured`, `aria-haspopup`의 axe 한계)입니다.

### 실제 Chrome 동작

- 6개 view tab 정상, Request Lab에서 실제 엔진 유지, console 오류 0건
- artifact를 GPT-4o → Qwen3.5로 바꾸면 미지원 표시가 실제 수치로 전환됨
- 잘못된 tools JSON 입력 시 textarea `aria-invalid="true"`, 오류 문구가 artifact 안내에 덮이지 않고 함께 표시됨
- 스키마 위반(`name: "1bad"`)은 계약 오류 문구로 표시됨
- 복구 입력 시 오류 상태 해제

## 5. 구현하지 않은 것과 이유

**선택적 공식 계수 gateway (P2 세 번째 묶음)** 는 구현하지 않았습니다.

- 로드맵 자체가 이를 "선택적"으로 두고, 수직 슬라이스 8·9단계에서 "gateway 없이 자리의 의미만 검증" → "이후에만 adapter 연결" 순서를 지정합니다.
- 정적 GitHub Pages 배포물에는 API 키를 둘 수 없습니다. 서버 프록시나 로컬 self-host adapter가 선행되어야 합니다.
- 대신 `providerCounts.preflight`/`.actual` 자리를 계약과 화면에 만들어 두고 `gateway-not-configured`로 표시했습니다. 완료 조건 "gateway 미설치 상태에서도 로컬 학습·분석 기능이 완전하게 동작"은 이 상태로 충족합니다.

**비용 modifier·tool 과금 데이터**는 채우지 않았습니다. 계산 엔진은 `entry.modifiers`·`entry.toolCharges`를 읽도록 되어 있으나, 공식 문서로 검증하지 않은 배수를 카탈로그에 넣는 것은 "출처 분리"·"정확성 우선" 원칙 위반입니다. 데이터가 추가되면 코드 변경 없이 활성화됩니다.

## 6. 완료 조건 대조

| 조건 | 상태 |
|---|---|
| raw, template, provider overhead가 독립 수치로 재현됨 | ✅ raw/template/overhead 분리, overhead 불일치는 계약이 거부 |
| 제공사별 exact/preflight/estimate/actual 의미를 화면과 export에 보존 | ⚠️ 계약과 화면에 자리·근거 등급 보존. actual/preflight는 gateway 미연동으로 값 없음 |
| 지원하지 않는 역할·도구·modality·과금 요소가 0으로 보이지 않음 | ✅ 모두 사유와 함께 미지원/제외로 표시 |
| 티어·날짜 경계는 N-1/N/N+1과 D-1/D/D+1 fixture를 통과 | ✅ |
| 브라우저 배포물과 저장소에 비밀 키가 없음 | ✅ 자격증명 패턴·제공사 엔드포인트·`fetch` 부재를 테스트로 고정 |
| gateway 미설치 상태에서도 로컬 학습·분석 기능이 완전하게 동작 | ✅ |

## 7. 남은 게이트

- 공식 계수 gateway(서버 프록시 또는 로컬 self-host adapter)와 actual usage 보존
- 검증된 출처가 있는 cached/batch/priority/region 단가와 tool 과금 데이터 확보
- P1에서 이어지는 Firefox/WebKit 검증과 목표 사용자 사용성 측정
- 긴 대화·다수 tool schema에서의 성능 budget (현재 세그먼트는 메시지 수만큼 렌더를 반복함)

## 8. 재검증 명령

```bash
npm test
```

브라우저에서 `Request Lab` 탭을 열고 artifact를 `Qwen3.5`로 바꾼 뒤 본문/템플릿/overhead, tools 세그먼트, 누적 세그먼트 합, 컨텍스트 예산, 비용 제외 항목, 320px, 키보드 이동, console 오류를 확인합니다.
