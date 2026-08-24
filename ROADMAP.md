# Tokenizer Structure 확장 기획 및 우선순위

> 이 문서는 2026-08-25 기준 **P0~P5 구현 상태와 남은 게이트**를 함께 관리합니다. 검증 근거는 `docs/P0-VALIDATION.md`부터 `docs/P5-VALIDATION.md`까지의 단계별 기록과 `docs/P1-USABILITY-PROTOCOL.md`, `docs/EXTENDING.md`에 있습니다.

## 1. 한 줄 제품 방향

현재의 “문장이 토큰으로 변하는 과정” 시각화를 다음 세 질문에 답하는 도구로 확장합니다.

1. **학습:** 왜 이 문자와 문장이 이런 토큰 경계를 만드는가?
2. **검증:** 이 artifact와 설정에서 정확히 어떤 입력 구조와 Token ID가 만들어지는가?
3. **의사결정:** 실제 API 요청에서는 숨은 구조·컨텍스트·비용이 얼마나 추가되며, 다른 토크나이저와 어떤 차이가 나는가?

가장 큰 차별화 후보는 **요청 단위 Token Lab**입니다. 다만 이 기능을 먼저 화면에 붙이면 로컬 artifact 결과, 제공사 사전 계수, 실제 응답 usage가 섞일 수 있으므로 **버전된 결과 계약과 근거 등급을 P0 선행 조건**으로 둡니다.

## 2. 현재 기준선과 남은 공백

현재 제공되는 기준선:

- 6개 공개 tokenizer artifact를 고정 revision으로 로드
- Normalizer → Pre-tokenizer → Model → Post-processor 파이프라인 설명
- Token ID·표시 문자열, UTF-8 byte 기반 지표, 컨텍스트·입력비 요약
- 두 모델 비교와 고정 샘플 매트릭스
- 한국어·영어, 반응형 화면, 키보드 접근성, 실제 엔진과 폴백 구분
- 빠른 전환·UTF-8 분할·부분 실패·가격 티어에 대한 회귀 방어
- AnalysisRequest/AnalysisResult v1, provenance, capability, evidence, 구조화 fallback
- tokenizer artifact catalog와 API 모델·가격 catalog의 독립 관리
- local utility CSS, vendored Transformers.js v3.8.1, file hash 검증, 최소 권한 CSP
- Unicode 단위 분리와 golden fixture
- AnalysisRequest/AnalysisResult v2, canonical P1 옵션, encoding/roundtrip 계약
- Inspector 다중행 입력·상세·A/B·export/share와 세 개의 5분 Learn 경로
- Worker protocol/client/runtime, stale-result 억제, cancel/retry, 비동기 LRU
- 85개 결정론적 회귀 테스트, actual Chrome P1 통합 smoke, Chromium axe 접근성 0 violations
- RequestSpec/RequestAnalysisResult v1, chat template 능력 런타임 판정, 정확 합산 세그먼트
- 컨텍스트 예산·고정 prefix 분리·turn 재입력, 조건 기반 비용 시나리오와 수명주기 경고
- Corpus v1·BenchmarkResult v1, 부분 실패 격리, 역순 응답 보호, 발표 모드와 수업 링크
- cache manifest v1과 런타임 artifact cache 채택, app-shell Service Worker, 명시적 offline pin
- 세션 한정 custom artifact 업로드와 remote-code 차단, 운영 화면
- 결정론적 소형 BPE 학습·merge replay와 확장 기여 가이드
- 250개 결정론적 회귀 테스트

핵심 공백:

- v3 공개 JS 계약에서 exact original/normalized offset, sequence ID, word ID가 unavailable이며 Inspector는 이를 추정하지 않고 표시함
- 세 개의 Learn 경로는 구현됐지만 목표 사용자 80% 사용성 기준을 실제 표본으로 검증하지 않음 (프로토콜만 확정)
- Worker 기반은 실행 가능하지만 기존 pipeline UI 전체의 비동기 controller 이전과 성능 budget은 남음
- Firefox/WebKit 검증이 남음 (axe 자동 검증은 Chromium 기준 완료)
- 공식 계수 gateway가 없어 provider preflight·actual usage 자리는 값 없이 표시만 되고, cached/batch/priority 단가와 tool 과금 데이터가 카탈로그에 없음

## 3. 대상 사용자와 제품 모드

| 모드 | 주 사용자 | 해결할 일 | 핵심 결과 |
|---|---|---|---|
| Learn | 입문자, 학생, 교사 | 토큰·문자·byte·special token의 차이를 이해 | 5분 학습 경로, 예측 문제, 한 줄 설명 |
| Inspect | 프롬프트/API 실무자, NLP 학습자 | 특정 입력과 설정이 만드는 토큰을 재현·디버깅 | token/encoding 상세, Unicode diff, export |
| Benchmark | 모델·토크나이저 평가자 | 여러 artifact와 말뭉치를 같은 조건에서 비교 | 분포·실패율·재현 가능한 보고서 |
| Operate | 배포·운영 담당자 | artifact, cache, 출처, 가격 데이터의 상태를 확인 | revision·용량·신선도·오류 패널 |

초급/기술 설명 전환은 별도 제품이 아니라 모든 모드에 적용하는 공통 UX 레이어로 봅니다.

## 4. 기획 원칙과 금지선

- **정확성 우선:** 지원하지 않는 값은 0이나 추정값으로 채우지 않고 unavailable 사유를 표시합니다.
- **출처 분리:** 로컬 artifact 토큰화, 제공사 사전 계수, 실제 응답 usage, 휴리스틱을 같은 숫자로 취급하지 않습니다.
- **재현 가능성:** 모델 이름만이 아니라 artifact revision, engine version, 입력 옵션, 데이터 기준일을 결과에 포함합니다.
- **로컬 우선:** 원문은 기본적으로 브라우저 밖으로 전송하지 않습니다.
- **키 보안:** 정적 브라우저에 API 키나 HF token을 저장하지 않습니다. 공식 계수 연동은 선택적 서버 프록시 또는 로컬 self-host adapter로만 엽니다.
- **능력 기반 UI:** artifact가 실제로 지원하는 기능만 노출하고, 모델명으로 기능을 추정하지 않습니다.
- **부분 성공:** 다중 모델 중 일부가 실패해도 성공 결과는 유지하되 실패 항목은 순위·평균에서 제외합니다.
- **접근성 기본값:** 키보드, 320px 화면, 확대, reduced motion, 색상 외 설명을 각 기능의 완료 조건에 포함합니다.
- **라이선스 존중:** artifact 라이선스와 배포 조건을 검증하지 않은 모델을 기본 카탈로그에 넣지 않습니다.

하지 않을 일:

- substring 검색이나 decode 누적으로 원문 offset을 “정확함”이라고 표시
- 서로 다른 제공사의 사전 계수 의미를 임의로 평준화
- 토큰 수만으로 생성 품질, 언어 능력, 모델 우열을 판정
- v3에서 v4로 자동 업그레이드하거나 pinned artifact revision을 자동 변경
- trust_remote_code, 임의 JavaScript, 자격증명 포함 URL 허용
- 사용자가 명시하지 않은 원문·대화·파일을 외부로 전송

## 5. 먼저 고정할 공통 계약

### 5.1 AnalysisResult v1

화면, export, 비교, 공유가 모두 소비하는 버전된 결과 계약을 먼저 설계합니다.

필수 범주:

- schemaVersion, requestId, 생성 시각
- engine 이름·버전, artifact 저장소·불변 revision·파일 fingerprint
- raw input, normalized input, chat-template 직렬화 결과를 서로 분리
- 옵션: special token, text pair, padding, truncation, max length, stride, chat template
- token 항목: index, ID, raw token, 표시 문자열, byte 표현, special/source 구분
- 가능한 경우 original span, normalized span, sequence ID, word ID, type ID
- attention mask, special-token mask, overflow 결과
- UTF-16 code unit, Unicode code point, grapheme, UTF-8 byte 길이
- context·usage·cost 결과와 각 수치의 근거 등급
- 단계별 오류: load, fetch, parse, unsupported, normalize, model, postprocess, cancelled
- 미지원 값의 unavailableReason

### 5.2 Capability / Artifact Registry

artifact마다 다음을 선언하고 검증합니다.

- normalizer·pre-tokenizer·model·post-processor 단계 접근 가능 여부
- original/normalized offset 수준: exact-byte, exact-char, normalized-only, none
- chat template, tools, documents, text pair, padding/truncation 지원 여부
- byte-level 여부와 special token 정책
- 저장소, exact SHA, 라이선스, CORS/gated 여부, 파일 크기
- engine 호환 범위와 lastVerifiedAt

### 5.3 근거 등급

| 등급 | 의미 | 표시 원칙 |
|---|---|---|
| artifact-exact | 고정 artifact와 옵션으로 로컬 엔진이 산출 | “로컬 artifact 기준”과 revision 표시 |
| provider-exact-preflight | 제공사가 정확성을 명시한 공식 사전 계수 | 지원 제공사·요청 형식에만 사용 |
| provider-preflight | 제공사 공식 사전 계수이나 exact 보장은 없음 | “공식 사전 계수”로 표시 |
| provider-estimate | 공식 문서가 실제 usage와 차이 가능성을 명시 | “제공사 추정”으로 표시 |
| actual-usage | 실제 응답이 반환한 usage | 요청 ID·시점과 함께 표시 |
| educational-estimate | 설명용 휴리스틱 | 비교·비용 합계의 기본값에서 제외 |
| unsupported | 신뢰할 수 있는 값을 만들 수 없음 | 빈칸이 아니라 이유와 다음 행동 표시 |

등급은 제공사 이름에 영구 고정하지 않고 공식 문서가 바뀌면 데이터로 갱신합니다.

## 6. 목표 구조

의존관계는 다음 순서로 설계합니다.

1. **Catalog:** tokenizer artifact와 API 모델·가격 데이터를 분리
2. **Domain:** AnalysisRequest/Result, capability, span, usage, diff 계약
3. **Engine adapters:** 현재 Transformers.js와 향후 런타임을 같은 계약으로 감쌈
4. **Worker/load manager:** 로드·분석·취소·progress·부분 실패·메모리 LRU 소유
5. **Controller/store:** latest-request와 화면 상태 관리
6. **Views:** 계약만 받아 렌더링
7. **Persistence:** URL, export, IndexedDB, Cache API, Service Worker
8. **Optional verification gateway:** 제공사 계수 API를 호출하는 서버 또는 로컬 adapter

Cache 소유권은 중복 저장을 피하도록 분리합니다.

- 메모리 LRU: 현재 활성 tokenizer
- Cache API/custom cache: artifact 파일
- IndexedDB: manifest, revision, 용량, schema version
- Service Worker: 우선 app shell만
- artifact offline: 사용자가 명시적으로 pin한 항목만

2026-08-25 구현 결과: artifact 파일은 Transformers.js가 이미 소유한 `transformers-cache`를 그대로 씁니다. 별도 cache를 만들면 같은 파일을 두 벌 갖게 되기 때문입니다. 이 앱은 manifest(무엇을 언제 왜 고정했는지)만 IndexedDB에 따로 관리합니다.

## 7. 우선순위 결정 방식

정밀한 숫자 점수보다 다음 네 축과 의존관계를 사용합니다.

- **사용자 가치:** 자주 발생하는 실제 질문을 해결하는가
- **기반 재사용성:** 뒤 기능 여러 개의 정확성과 속도를 높이는가
- **구현 부담:** UI·데이터·테스트·운영을 합친 규모
- **정확성/운영 위험:** 거짓 정밀도, 보안, 호환성, 비용 갱신 위험

P0는 점수와 무관한 필수 게이트입니다. P1 이후는 사용자 가치가 높더라도 선행 계약과 검증이 끝나지 않으면 착수하지 않습니다.

## 8. 최종 우선순위

| 우선순위 | 묶음 | 가치 | 부담 | 위험 | 판단 |
|---|---|---:|---:|---:|---|
| P0 | 결과 계약·capability·근거 등급 | 매우 높음 | 중 | 중 | ✅ 완료 — 확장 기능의 공통 경계 확정 |
| P0 | 로컬 자산·CSP·golden/contract/E2E | 높음 | 중 | 중 | ✅ 완료 — 공급망·회귀·브라우저 gate 확정 |
| P0 | exact-offset 및 v4 호환성 feasibility spike | 높음 | 조사 완료 | 매우 높음 | ✅ 완료 — offset unavailable, v4 parity gate로 보류 |
| P1 | Inspector·입력 준비·Unicode A/B·export/share | 매우 높음 | 큼 | 중 | ✅ 기능 구현·Chrome 검증 완료; 외부 사용성 gate 남음 |
| P1 | Learn 경로·용어집·초급/기술 설명 | 높음 | 중 | 낮음 | ✅ 기능 구현 완료; 목표 사용자 검증 남음 |
| P1 | Worker 기본 프로토콜·latest-result·memory LRU | 높음 | 큼 | 높음 | ✅ protocol/runtime/client/LRU 및 실제 Worker canary 완료 |
| P2 | Request Token Lab·chat-template overhead | 매우 높음 | 매우 큼 | 높음 | ✅ 완료 — 6개 artifact에서 능력 판정과 정확 합산 세그먼트 검증 |
| P2 | 컨텍스트·cache·조건 기반 비용 시나리오 | 매우 높음 | 큼 | 높음 | ✅ 완료 — 단가 없는 과금 요소는 0이 아니라 제외 항목으로 표시 |
| P2 | 선택적 공식 계수 gateway | 높음 | 큼 | 매우 높음 | ⏳ 미착수 — 계약·화면 자리만 확보, 서버 프록시 또는 로컬 adapter 선행 필요 |
| P3 | 2~4 artifact 말뭉치 Benchmark | 높음 | 큼 | 중상 | ✅ 완료 — 부분 실패 격리와 비교 가능 부분집합 분리 검증 |
| P3 | 발표 모드·재현 가능한 수업 링크 | 중 | 중 | 낮음 | ✅ 완료 — 단계별 reveal·발표자 메모·원문 미포함 링크 |
| P4 | cache 관리·app-shell offline·선택 pin | 중상 | 큼 | 높음 | ✅ 완료 — 런타임 cache 채택으로 중복 소유 제거, offline 실증 |
| P4 | 로컬 custom artifact → public exact-SHA | 높음 | 매우 큼 | 매우 높음 | ✅ 로컬 업로드 완료 — public exact-SHA 추가 경로는 남음 |
| P4 | embeddable core·CLI·adapter SDK | 중상 | 매우 큼 | 높음 | ✅ 검토 완료 — [ADR 0002](docs/adr/0002-embeddable-core-cli-and-adapter-sdk.md), 지금은 경계만 유지 |
| P5 | 소형 BPE/Unigram Builder·학습 애니메이션 | 중 | 매우 큼 | 중상 | ✅ BPE 완료 — Unigram은 별도 후속 연구로 남김 |

핵심 순서는 **P0 신뢰 기반 → P1 Inspector/Learn → P2 Request Token Lab → P3 Benchmark → P4 Platform → P5 Builder**입니다. 2026-08-25 기준 P0~P5의 구현 범위를 모두 마쳤고, 남은 것은 각 단계의 외부 게이트입니다(13절).

## 9. 단계별 기획

### Phase 0 — Contract & Reliability

**상태: ✅ 완료 (2026-08-24)**

구현과 검증 근거: [`docs/P0-VALIDATION.md`](docs/P0-VALIDATION.md), [`ADR 0001`](docs/adr/0001-p0-contract-runtime-and-offsets.md)

완료 결과:

- renderer가 소비하는 AnalysisResult v1과 real/heuristic provenance 경계 확정
- 6개 artifact capability registry와 독립 pricing/source catalog 적용
- Tailwind CDN 제거, Transformers.js v3.8.1 local vendor/hash, 최소 권한 CSP 적용
- UTF-16/code point/grapheme/UTF-8 분리와 Unicode golden fixture 적용
- exact offset은 `runtime-not-exposed`, v4는 공개 계약·parity gate 충족 전 보류
- Node 결정론적 테스트 40/40 통과
- actual Chrome real-engine·상호작용·320px smoke 통과, cross-browser/axe 후속 gate 문서화

목표: 새 기능보다 먼저 “무엇을 정확하다고 부를 수 있는지”를 고정합니다.

범위:

- AnalysisRequest/AnalysisResult v1과 migration 원칙
- Capability/Artifact Registry와 근거 등급
- tokenizer artifact catalog와 제공사 모델·가격 catalog 분리
- 현재 v3.8.1 engine adapter와 v4/standalone tokenizer 호환성 조사
- exact original offset 제공 가능성 spike
- Tailwind Play CDN 제거, Transformers.js bundle self-host, CSP 정책
- Unicode golden fixture와 contract test
- Chromium·Firefox·WebKit, GitHub Pages subpath, keyboard·axe E2E 계획
- scheduled upstream canary와 결정론적 CI 분리

필수 fixture:

- NFC/NFD와 한글 자모
- 결합 문자, ZWJ emoji, skin tone, flag
- RTL, CRLF, 반복 문자열
- byte split, prefix-space, 특수 토큰
- 긴 입력, 빠른 모델 전환, 부분 다운로드·실패

완료 조건:

- [x] 현재 지원 artifact가 동일한 결과 계약을 통과
- [x] renderer가 engine 원시 객체를 직접 소비하지 않음
- [x] 모든 수치에 근거 등급 또는 unavailableReason이 있음
- [x] original/normalized span을 구분하고 exact가 아닌 매핑을 exact로 표시하지 않음
- [x] 가격·모델 데이터가 artifact catalog와 독립 갱신 가능
- [x] 공급망·브라우저·접근성 테스트 계획이 각 후속 Phase의 통과 게이트로 연결됨

### Phase 1 — Inspector & Learn

**상태: ✅ 기능 구현 완료 (2026-08-24) / ⏳ 외부 사용성·cross-browser gate 남음**

구현과 검증 근거: [`docs/P1-VALIDATION.md`](docs/P1-VALIDATION.md)

목표: 현재 시각화를 재현 가능한 분석기이자 5분 안에 이해 가능한 학습 도구로 확장합니다.

Inspector 범위:

- 줄 번호, 글자·UTF-8 byte 제한, 대형 입력 경고가 있는 다중행 편집기
- Token ID, raw/display token, bytes, special/source 상세
- capability가 보장하는 encoding mask·sequence/word ID·offset만 표시
- special token, text pair, padding 방향, truncation, max length, stride 옵션
- encode → decode roundtrip diff와 원인 분류
- 원문/정규화 문자열의 시각적 diff
- 같은 tokenizer에서 공백, NFC/NFD, 대소문자, emoji, 코드 들여쓰기 A/B 렌즈
- JSON·CSV·클립보드 export와 버전된 스키마
- 입력을 기본 제외한 URL 상태 공유; 명시적 선택 때만 원문 포함

Learn 범위:

- 5분 경로 1: 토큰은 단어가 아니다
- 5분 경로 2: 한글·emoji와 UTF-8 byte
- 5분 경로 3: 같은 뜻도 tokenizer마다 다르다
- 학습 목표 → 결과 예측 → 직접 조작 → 규칙 설명 → 오개념 확인 → 한 줄 요약
- 초급/기술 설명 전환, 용어집, 수치의 서술형 요약
- 버전된 lesson 데이터: 근거 URL, 검토일, ko/en 번역, 실제/폴백 허용 여부

기술 기반:

- Worker의 load/analyze/dispose 프로토콜
- requestId 기반 stale-result 억제
- 로드 progress, 구조화 오류, 재시도
- 활성 tokenizer 개수·메모리 기준 LRU
- hard cancel과 cache 손실의 UX 명시

완료 조건:

- [x] 화면·export·공유 복원의 token count와 옵션이 일치
- [x] A/B 각 결과가 단일 분석 결과와 일치하고 변경 delta만 명확히 구분
- [x] roundtrip 차이를 무조건 오류로 표시하지 않고 정규화·UNK·special 제거 등을 분류
- [x] offset 미지원 artifact는 추정 위치 대신 미지원으로 표시
- [ ] 외부 설명 없이 목표 사용자 80%가 5분 경로와 4문항 중 3문항을 완료하는 사용성 검증 — 측정 프로토콜은 [`docs/P1-USABILITY-PROTOCOL.md`](docs/P1-USABILITY-PROTOCOL.md)로 확정, 실제 표본 측정 미실시
- [x] 320px, 키보드만 사용, reduced motion에서 동일 핵심 작업을 완료
- [x] Chromium axe 자동 검증에서 5개 view · ko/en · 320px · 모달 모두 violations 0

### Phase 2 — Request & Context Token Lab

**상태: ✅ 로컬 범위 구현 완료 (2026-08-25) / ⏳ 선택적 공식 계수 gateway 미착수**

구현과 검증 근거: [`docs/P2-VALIDATION.md`](docs/P2-VALIDATION.md)

목표: “텍스트 한 덩어리의 토큰 수”를 “실제 API 요청의 구조·컨텍스트·비용”으로 확장합니다.

Request Composer 범위:

- instructions/system, 역할별 messages, 대화 history
- tools/function schema와 지원되는 documents·image/file metadata
- raw content → chat-template 직렬화 → control/special token → Token ID의 단계 보기
- add_generation_prompt on/off
- raw text 대비 template overhead와 BOS/EOS 중복 경고
- local artifact, provider preflight, actual response usage 병렬 비교
- provider별 미지원 필드와 count semantics 표시

Context 범위:

- system/history/tool/output/reasoning reserve의 누적 timeline
- 입력 한도, 출력 여유, truncation 예상 지점
- cache 가능한 고정 prefix와 동적 suffix
- 대화 turn별 재입력·재과금 범위
- 텍스트와 지원되는 비텍스트 modality의 별도 usage

Cost 범위:

- baseRate
- modifiers: cached read/write, batch, priority/flex, region, long-context
- toolCharges: search, grounding, file search, storage 등
- rateSchedule: 적용 시작·종료, 프로모션, 임계 구간
- 호출당·일간·월간 시나리오와 포함/제외 항목
- 통화·환율 기준 시각과 stale/expired 상태

연동 원칙:

- 공식 계수는 선택적 서버 프록시 또는 로컬 self-host adapter에서만 실행
- 브라우저 bundle·localStorage·URL에 API 키를 넣지 않음
- 요청 전 명시적 전송 확인과 민감 데이터 경고
- offline/local 결과와 provider 전송 결과를 시각적으로 분리
- actual usage를 preflight와 별도로 보존

완료 조건:

- [x] raw, template, provider overhead가 독립 수치로 재현됨
- [x] 제공사별 exact/preflight/estimate/actual 의미를 화면과 export에 보존 (preflight·actual은 gateway 미연동으로 값 없음)
- [x] 지원하지 않는 역할·도구·modality·과금 요소가 0으로 보이지 않음
- [x] 티어·날짜 경계는 N-1/N/N+1과 D-1/D/D+1 fixture를 통과
- [x] 브라우저 배포물과 저장소에 비밀 키가 없음
- [x] gateway 미설치 상태에서도 로컬 학습·분석 기능이 완전하게 동작

### Phase 3 — Corpus Benchmark & Teaching

**상태: ✅ 완료 (2026-08-25)**

구현과 검증 근거: [`docs/P3-VALIDATION.md`](docs/P3-VALIDATION.md)

목표: 단일 예시를 재현 가능한 말뭉치 비교와 수업 시나리오로 확장합니다.

범위:

- 2~4개 tokenizer 열의 추가·제거
- 사용자 정의 문장 묶음, 언어·도메인 태그, 로컬 프로젝트
- token count, code point/token, byte/token, context 점유율
- 평균만이 아니라 중앙값, p50/p95, 범위, 실패율
- 샘플·모델 필터와 CSV/JSON 보고서
- 같은 입력의 모델 비교와 같은 모델의 입력 A/B 비교를 별도 모드로 유지
- 큰 글씨, 단계별 reveal, 초기화, 발표자 메모가 있는 발표 모드
- 입력을 제외하거나 명시적으로 포함하는 재현 가능한 수업 링크

완료 조건:

- [x] 부분 실패가 순위·평균·색상에 섞이지 않음
- [x] 다중 모델 결과가 각각의 단일 pipeline 결과와 일치
- [x] 모델 전환과 역순 응답에서도 열과 결과가 뒤섞이지 않음
- [x] 작은 샘플 결과를 언어 전체 우열로 일반화하지 않는 안내가 보고서에 포함
- [x] 1280×720 발표 화면과 320px 학습 화면에서 핵심 흐름을 완료

### Phase 4 — Platform & Extensibility

**상태: ✅ 완료 (2026-08-25) — public exact-SHA 추가 경로만 남음**

구현과 검증 근거: [`docs/P4-VALIDATION.md`](docs/P4-VALIDATION.md), [`ADR 0002`](docs/adr/0002-embeddable-core-cli-and-adapter-sdk.md)

목표: 안정된 분석 계약을 offline, custom artifact, 다른 실행 환경으로 확장합니다.

범위:

- cache manifest, 용량·revision·손상·삭제 UI
- app-shell Service Worker와 명시적 artifact offline pin
- quota, migration, partial download 복구
- 로컬 tokenizer.json/config 업로드와 세션 한정 분석
- 파일 크기·개수·JSON 깊이·schema·component 검증
- encode/decode smoke test와 fingerprint
- public HF artifact는 정확한 commit SHA와 허용 host만 지원
- embeddable analysis core, CLI, provider/engine adapter SDK 검토
- 선택적 verification gateway의 배포·감사·rate limit 운영

완료 조건:

- [x] app shell과 artifact cache가 같은 파일을 중복 소유하지 않음
- [x] offline 표시가 실제 사용 가능한 artifact와 일치
- [x] 401/404, HTML fallback, opaque response, 부분 파일을 정상 cache로 기록하지 않음
- [x] custom artifact가 remote code를 실행하지 않고 리소스 상한을 지킴
- [x] 라이선스·revision·engine compatibility가 export에 남음

### Phase 5 — Tokenizer Builder & Research

**상태: ✅ BPE 범위 완료 (2026-08-25) / Unigram은 별도 후속 연구**

구현과 검증 근거: [`docs/P5-VALIDATION.md`](docs/P5-VALIDATION.md), 기여 가이드는 [`docs/EXTENDING.md`](docs/EXTENDING.md)

목표: 완성된 tokenizer를 관찰하는 것을 넘어 작은 tokenizer가 만들어지는 과정을 학습합니다.

후보:

- 작은 말뭉치에서 pre-tokenization과 BPE merge 후보·빈도 변화 애니메이션
- vocab 크기와 special token 설정에 따른 결과 비교
- merge replay와 encode 결과 연결
- 사전 계산 lesson에서 시작해 브라우저 내 소형 BPE trainer로 확장
- Unigram 후보 제거·확률 설명은 별도 후속 연구
- lesson/engine/provider adapter 생태계와 기여 가이드

제약:

- [x] 대형 모델 학습 도구를 목표로 하지 않음 — 상한을 넘으면 사유와 함께 거부
- [x] 브라우저 성능·재현성이 검증되기 전에는 "실시간 학습"으로 약속하지 않음 — 실행 전 규모, 실행 후 실측 시간과 한계 표시
- [x] 처음에는 검증된 사전 계산 replay를 우선 — 한 번 계산한 기록을 되짚는 replay가 기본 동작

## 10. 데이터 갱신·운영 정책

공통 provenance 필드:

- sourceUrl, verifiedAt, effectiveFrom, effectiveUntil
- status, guaranteedThrough, earliestShutdown, replacement
- artifact SHA, engine version, license, fingerprint
- contextInput, maxOutput, modality, countSemantics
- pricingMode, threshold, modifiers, toolCharges, region, currency

운영 규칙:

- 가격·모델 수명주기: 공식 페이지를 주 1회 확인하고 만료 30/7/1일 전 경고
- artifact: upstream HEAD를 감시하되 pinned revision은 자동 변경하지 않음
- revision 변경 전 golden corpus, special/chat template, offset, 라이선스, CORS/gated, 파일 크기, v3/v4 회귀
- 변경 승인은 출처·diff·검증 결과를 남긴 후 수동 수행
- 화면·export에 모델 ID, artifact SHA, engine version, count source, 가격 기준일 표시
- CI의 실제 네트워크 호출은 scheduled canary로 분리하고 필수 테스트는 고정 fixture로 결정론적 실행

## 11. 성공 지표

신뢰:

- 사용자에게 노출되는 수치 100%에 근거 등급 또는 미지원 이유가 있음
- 실패·미지원 값이 0 또는 추정 성공으로 표시되는 사례 0건
- 같은 schema version, artifact revision, 옵션, 입력의 export 결과가 재현됨

학습:

- 목표 초심자 80%가 5분 경로를 완료
- 핵심 4문항 중 3문항 이상 정답 비율 80%
- 색상 없이도 차이 원인을 서술형 요약으로 이해 가능

사용성:

- 모바일·키보드에서 분석, 상세 탐색, export, 공유의 핵심 흐름 완료
- 긴 입력·다중 모델의 성능 budget은 Phase 0 측정 후 수치 확정
- 부분 실패 후 전체 새로고침 없이 해당 항목만 복구

운영:

- 모든 가격·수명주기 데이터에 검토일과 만료 상태 존재
- 모든 기본 artifact에 exact revision, 라이선스, 파일 크기, 호환성 검증일 존재
- 공식 계수 gateway 없이도 로컬 핵심 제품은 정상 동작

## 12. 최초 수직 슬라이스

2026-08-25 기준 1~8을 완료했으며 9는 공식 계수 gateway가 선행되어야 합니다. 이 슬라이스를 통과해 P3까지 진행했습니다.

Phase 전체를 한 번에 만들지 않고 다음 한 줄 흐름으로 위험을 먼저 줄입니다.

1. AnalysisResult v1, capability, 근거 등급 사양 확정
2. 현재 artifact 1개와 Unicode golden fixture로 adapter contract 검증
3. 다중행 입력 → token 상세 → 시각적 normalization diff
4. 미지원 exact offset을 명시적으로 표시
5. 같은 결과를 JSON으로 export하고 URL에서 옵션만 복원
6. 하나의 5분 Learn lesson을 같은 결과 계약으로 구동
7. 하나의 chat-template 지원 artifact에서 raw/template overhead를 표시
8. gateway 없이 local 결과와 provider 결과 자리의 의미만 검증
9. 이후에만 공식 계수 adapter와 비용 시나리오를 연결

이 수직 슬라이스가 통과하면 P1의 나머지를 완성하고 P2로 이동합니다.

## 13. 착수 의사결정 요약

1. **완료:** P0 계약·capability·provenance·offset/v4 결정과 공급망 기반
2. **기능 구현 완료, 외부 gate 진행 전:** P1 Inspector + Unicode A/B + export/share + 5분 Learn + Worker 기반
3. **로컬 범위 완료:** P2 Request Token Lab + chat template overhead + context/cost. 공식 계수 gateway만 남음
4. **완료:** P3 corpus Benchmark와 발표 모드·수업 링크
5. **완료:** P4 offline/cache, 세션 한정 custom artifact. core/CLI/SDK는 검토 결과 경계만 유지
6. **완료:** P5 소형 BPE Builder와 merge replay. Unigram은 별도 후속 연구

남은 것은 구현이 아니라 외부 게이트입니다.

- 목표 사용자 80% 사용성 측정 ([측정 프로토콜](docs/P1-USABILITY-PROTOCOL.md), 실제 표본 필요)
- Firefox/WebKit desktop·320px 검증 (axe는 Chromium 기준 완료)
- P2 선택적 공식 계수 gateway (서버 프록시 또는 로컬 self-host adapter 선행)
- P4 public exact-SHA artifact 추가 경로
- P5 Unigram replay와 BPE를 다루는 5분 Learn 경로

모델 개수 추가나 정교한 비용 UI부터 시작하지 않습니다. 공통 계약 없이 추가하면 동일한 정확성·부분 실패·출처 문제를 각 화면에서 다시 풀어야 하기 때문입니다.

## 14. 공식 근거

- [Hugging Face Tokenizers 구성 요소와 alignment](https://huggingface.co/docs/tokenizers/components)
- [Hugging Face Encoding API](https://huggingface.co/docs/tokenizers/main/api/encoding)
- [Transformers.js v3.8.1 tokenizer API](https://huggingface.co/docs/transformers.js/v3.8.1/api/tokenizers)
- [Hugging Face chat templates](https://huggingface.co/docs/transformers/chat_templating)
- [Transformers.js 4.2.0 release](https://github.com/huggingface/transformers.js/releases/tag/4.2.0)
- [OpenAI input token counting](https://developers.openai.com/api/docs/guides/token-counting)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Gemini token counting](https://ai.google.dev/gemini-api/docs/tokens)
- [Anthropic token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [Web Worker의 IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/indexedDB)
- [CacheStorage API](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage)
