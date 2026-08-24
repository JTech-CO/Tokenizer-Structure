# P1 검증 기록 — Inspector, Learn, Worker Foundation

- 상태: 기능 구현 완료 / 외부 사용성·cross-browser gate 진행 전
- 검증일: 2026-08-24
- 기준 브랜치: `main`
- 대상: 정적 GitHub Pages UI, canonical analysis 계약, 브라우저 tokenizer Worker 경로

## 1. 완료 범위

### AnalysisResult v2와 옵션 일관성

- `AnalysisRequest`/`AnalysisResult`를 schema version 2로 올리고 `createdAt`, canonical P1 옵션, encoding, roundtrip을 추가했습니다.
- `addSpecialTokens`, `textPair`, `padding`, `paddingSide`, `truncation`, `maxLength`, `stride`는 UI·adapter·JSON/CSV export·URL 복원이 같은 정규화 함수를 사용합니다.
- Transformers.js v3.8.1 공개 tokenizer 호출의 `text_pair`, `padding`, `add_special_tokens`, `truncation`, `max_length`, `return_token_type_ids`를 실제 adapter에 연결했습니다.
- attention/type/special mask와 padding 방향은 runtime이 값을 제공할 때만 기록합니다. sequence ID, word ID, original/normalized offset은 runtime이 제공하지 않으면 값 대신 `unavailableReason`을 보존합니다.
- overflow stride는 현재 v3.8.1 공개 호출 계약에서 지원한다고 보지 않으며 canonical 값 `0`만 허용합니다.

공개 API 판단 근거: [Transformers.js v3.8.1 Tokenizers API](https://huggingface.co/docs/transformers.js/v3.8.1/api/tokenizers)

### Inspector

- 줄 번호와 `code point`·UTF-8 byte 계수를 제공하는 다중행 편집기를 추가했습니다.
- 기본 입력 상한은 100,000 code points 또는 1,000,000 UTF-8 bytes이며 10,000 code points 또는 100,000 bytes부터 큰 입력 경고를 표시합니다.
- Token ID, raw/display token, display UTF-8 bytes, mask, source, offset capability를 한 행에서 확인할 수 있습니다.
- encode → decode 결과는 lossless, normalization, unknown token, special-token removal, truncation, other, unavailable로 분류합니다.
- 공백, NFC, NFD, 대소문자, emoji, 코드 들여쓰기의 6개 Unicode A/B 렌즈를 제공합니다.
- version 1 Inspector JSON/CSV export와 클립보드 복사를 제공합니다. CSV는 spreadsheet formula injection을 방어합니다.
- version 1 URL share는 입력 원문을 기본 제외합니다. 사용자가 체크한 경우에만 원문을 포함하며 옵션·lens·언어·view를 함께 복원합니다.

### Learn

- 다음 세 개의 5분 경로를 추가했습니다: “토큰은 단어가 아니다”, “한글·emoji와 UTF-8 byte”, “같은 뜻도 tokenizer마다 다르다”.
- 각 경로는 학습 목표 → 예측 → 직접 조작 → 규칙 설명 → 오개념 확인 → 한 줄 요약의 6단계를 가집니다.
- 각 경로에 4문항과 3/4 통과 기준, ko/en 번역, 초급/기술 설명, 근거 URL·검토일, 실제/폴백 허용 정책을 기록합니다.
- 용어집과 현재 분석 수치를 이용한 서술형 요약을 제공합니다.
- Unicode 설명 근거는 [Unicode 17.0 Core Specification](https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-3/)과 lesson 데이터에 기록된 공식 문서입니다.

### Worker 기반

- version 1 `load`/`analyze`/`dispose`/`cancel` 요청과 `progress`/`result`/`error`/`cancelled` 응답 계약을 구현했습니다.
- scope별 최신 request ID만 유효하게 처리하고 이전 결과는 stale로 종료합니다.
- retryable 구조화 오류, soft cancel, cache 손실을 명시하는 hard cancel을 지원합니다.
- 기본 최대 2개 tokenizer를 보유하는 비동기 LRU와 deterministic dispose 순서를 구현했습니다.
- 실제 module Worker entry가 고정 Transformers.js adapter를 load/analyze/dispose할 수 있음을 Chrome에서 검증했습니다.

현재 화면의 기존 pipeline 경로는 직접 adapter 호출을 유지합니다. Worker protocol/client/runtime은 후속 비동기 controller 전환을 위한 실행 가능한 기반이며, UI 전체를 Worker로 이전했다고 주장하지 않습니다.

## 2. 명시적 지원 경계

| 항목 | 현재 상태 | 표시 원칙 |
|---|---|---|
| text pair, special token, truncation, max length | real runtime 지원 | canonical 옵션과 실제 결과를 export/share에 보존 |
| padding | artifact runtime 조건부 | 유효한 pad token이 없으면 UI에서 비활성화 |
| padding side | runtime property | 호출 동안만 변경하고 원래 값을 복원 |
| attention/type/special mask | runtime 조건부 | 제공되지 않으면 unavailable 이유 표시 |
| sequence ID, word ID | 미노출 | 추정하지 않음 |
| original/normalized offset | 미노출 | `runtime-not-exposed` 표시, substring 합성 금지 |
| overflow stride | 미지원 | `0`만 허용하고 UI에 이유 표시 |
| heuristic 옵션 parity | 미보장 | pair/padding/truncation은 실제 artifact가 필요하다고 경고 |

## 3. 검증 결과

### 결정론적 테스트

```text
npm test
tests 80
pass 80
fail 0
```

검증 범위는 v2 계약과 migration, canonical 옵션, 실제 adapter 옵션 전달, 입력 제한, Unicode lens/diff, roundtrip 분류, export/share 스키마와 개인정보 기본값, CSV formula injection 방어, lesson 데이터·진행·채점, Worker protocol/client/runtime/LRU/cancel/retry/stale 결과, P0 catalog·CSP·vendor hash·Unicode golden 회귀를 포함합니다.

### 실제 Chrome smoke

로컬 정적 서버와 설치된 Chrome/DevTools를 사용해 고정 `Xenova/gpt-4o` artifact를 실제로 로드했습니다. 앱 내 브라우저 연결은 이 Windows workspace의 ACL 적용 오류로 시작되지 않아 실제 Chrome CDP 검증으로 대체했습니다.

검증 결과:

- 5개 view tab과 실제 `gpt-4o` 엔진 로드, 초기 예시 24 Token IDs
- `A🤗\n한글` 입력에서 2줄·5 code points·12 UTF-8 bytes, 실제 결과 6 Token IDs
- exact offset을 `미지원 (runtime-not-exposed)`으로 표시
- `addSpecialTokens=false`, `truncation=true`, `maxLength=4` 적용 후 UI·JSON export 4 Token IDs 일치
- text pair 적용 뒤에도 real engine 유지
- 입력 제외 share에 원문이 없고, 명시적 입력 포함 share를 다시 연 뒤 원문·text pair·옵션·4 Token IDs가 동일하게 복원
- Learn 경로 3개, 활성 경로 6단계·4문항, 용어 4개 이상 표시
- 실제 module Worker analyze 결과 5 Token IDs, AnalysisResult v2, dispose 성공
- view tab 키보드 탐색과 초급/기술 전환 성공
- 320px viewport에서 문서 `scrollWidth=320`; token 상세 표는 자체 가로 스크롤 제공
- `prefers-reduced-motion: reduce` 반영
- runtime exception, console error, failed request, 4xx/5xx 응답 0개

## 4. 남은 릴리스 게이트

- 목표 사용자 대상 5분 경로 사용성 검증: 80% 완료, 4문항 중 3문항 정답 80% 기준은 아직 실제 사용자 표본으로 측정하지 않았습니다.
- Firefox/WebKit desktop·320px, axe 자동 접근성 검증은 아직 남아 있습니다.
- GitHub Pages 배포 URL은 push 후 새 정적 자산과 module Worker 경로를 다시 smoke 검증해야 합니다.
- 긴 입력을 포함한 UI 전체의 Worker controller 이전, 실제 progress/retry UX, 브라우저별 메모리 budget은 후속 성능 gate입니다.

기능 구현 완료와 사용자 검증 완료를 구분합니다. 위 외부 gate가 끝나기 전에는 “목표 사용자 80% 달성”이나 “전 브라우저 완료”로 표시하지 않습니다.

## 5. 재검증 명령

```bash
npm test
python -m http.server 8000
```

브라우저에서 `http://127.0.0.1:8000/`을 열고 Inspector 옵션·export/share 재로딩, Learn 세 경로, module Worker, 320px, 키보드, reduced motion, console/network 오류를 확인합니다.
