# ADR 0002 — embeddable core, CLI, adapter SDK 검토

- 상태: Accepted (검토 결과: 지금은 패키징하지 않음)
- 결정일: 2026-08-25
- 범위: P4 Platform & Extensibility 세 번째 묶음

## 맥락

로드맵 Phase 4는 "embeddable analysis core, CLI, provider/engine adapter SDK **검토**"를
요구합니다. 구현이 아니라 판단이 산출물입니다.

P0~P3을 거치며 이 저장소에는 이미 DOM과 네트워크에 의존하지 않는 순수 모듈이
쌓였습니다. 이 모듈들이 사실상 core 후보입니다.

| 계층 | 모듈 | 의존성 |
|---|---|---|
| 계약 | `analysisContract`, `analysisOptions`, `requestContract`, `cacheManifest` | 없음 |
| 도메인 | `unicodeMetrics`, `inspectorDomain`, `corpus`, `benchmarkDomain`, `contextBudget`, `costScenario`, `presentation`, `customArtifact`, `lessons` | 계약 모듈만 |
| 데이터 | `artifacts`, `pricing` | 없음 |
| 실행 | `chatTemplate`, `benchmarkRun`, `workerProtocol`, `artifactCache` | 주입된 런타임 |
| 어댑터 | `tokenizer` | vendored Transformers.js |
| 화면 | `*View`, `pipeline`, `compare`, `matrix`, `main` | DOM |

`tests/benchmarkStatic.test.js`는 순수 모듈이 `document`·`window`·`fetch`를 참조하지
않는지 이미 검사합니다. 즉 core 경계는 이름이 없을 뿐 실재하며 테스트로 지켜지고
있습니다.

## 검토한 선택지

### A. 지금 npm 패키지로 분리한다

- 장점: 외부에서 `@jtech/tokenizer-core`로 재사용 가능
- 단점:
  - 이 앱이 유일한 소비자다. 소비자가 하나인 API를 공개 계약으로 고정하면
    P5(Builder)에서 계약을 바꿀 때 major 릴리스 비용이 생긴다.
  - 저장소는 지금 **의존성 0**이다. 패키징하려면 빌드·번들·타입·릴리스 파이프라인이
    필요하고, 이는 "로컬 자산·공급망 검증" 원칙과 정면으로 상충한다.
  - 정적 GitHub Pages 배포에 빌드 단계가 들어가면 지금 검증한 자산과 배포 자산이
    같은 파일이라는 보장이 사라진다.

### B. Node CLI를 추가한다

- 장점: 터미널에서 말뭉치 비교와 비용 시나리오를 돌릴 수 있다
- 단점:
  - CLI에서 실제 토큰 수를 내려면 Transformers.js가 Node에서 artifact를 받아야 한다.
    현재 vendored 번들은 브라우저 전용 경로를 전제로 하고, Node에서는
    `onnxruntime-node` 네이티브 설치가 따라온다. 의존성 0이 깨진다.
  - 실제 엔진 없이 순수 모듈만 노출하는 CLI는 **토큰 수를 낼 수 없다.**
    통계·비용·계약 검증만 가능한 CLI는 지금 수요가 확인되지 않았다.

### C. 경계만 유지하고 패키징은 미룬다 (채택)

- core 경계를 문서와 테스트로 유지한다.
- 소비자가 둘 이상 생기거나(예: CLI, 다른 앱), 외부 요청이 실제로 들어올 때
  A 또는 B를 다시 연다.

## 결정

1. 지금은 npm 패키지도 CLI도 만들지 않는다. **경계만 유지한다.**
2. 순수 모듈은 계속 DOM·네트워크·전역 상태를 참조하지 않는다. 이 규칙은
   `tests/benchmarkStatic.test.js`와 `tests/requestLabStatic.test.js`가 강제한다.
3. 런타임 의존은 항상 주입으로 받는다. 현재 이 패턴을 쓰는 곳:
   `BenchmarkRunner({ loadTokenizer, analyze })`,
   `ArtifactCacheManager({ cacheStorage, manifestStore, fetchImpl })`,
   `TokenizerWorkerClient({ workerFactory })`.
   새 실행 계층도 같은 방식을 따른다.
4. provider/engine adapter는 **인터페이스로 먼저 정의하고 구현은 나중에** 붙인다.
   현재 정의된 경계는 두 개다.
   - engine adapter: `(tok, text, options) -> AnalysisResult`
   - provider count adapter: `RequestAnalysisResult.providerCounts.{preflight,actual}`
     자리. 지금은 `gateway-not-configured`로 비어 있다.
5. 패키징을 다시 여는 조건을 명시한다.
   - 이 저장소 밖에 소비자가 최소 하나 생긴다
   - 또는 Node에서 실제 토큰 수를 낼 수 있는 tokenizer-only 런타임이 확인된다
   - 또는 provider gateway(P2 잔여)가 서버 컴포넌트를 요구해 core 공유가 불가피해진다

## 결과

- 지금 얻는 것: 의존성 0과 "검증한 파일이 배포되는 파일"이라는 성질을 그대로 유지한다.
- 지금 포기하는 것: 외부 재사용. 대신 경계가 이미 지켜지고 있어 나중에 분리할 때
  구조를 바꿀 필요는 없다.
- 위험: core 경계가 문서로만 남으면 시간이 지나며 흐려진다. 그래서 경계 위반을
  테스트로 잠갔다. 새 순수 모듈을 추가할 때 같은 테스트 목록에 넣어야 한다.

## 근거

- [Transformers.js 4.2.0 release](https://github.com/huggingface/transformers.js/releases/tag/4.2.0) — Node 사용 시 런타임 패키지 구성
- [`docs/P0-VALIDATION.md`](../P0-VALIDATION.md) — 로컬 자산·공급망 검증 결정
- [`ADR 0001`](0001-p0-contract-runtime-and-offsets.md) — vendored 번들과 CSP 결정
