# LLM Tokenizer Structure

> **고정된 공개 tokenizer artifact로 LLM 토큰화 파이프라인을 재현하고 시각화하는 브라우저 도구**

[![Live Page](https://img.shields.io/badge/Live_Demo-jtech--co.github.io-217346?style=flat-square&logo=github)](https://jtech-co.github.io/Tokenizer-Structure)

### 🌐 바로 사용하기 → **<https://jtech-co.github.io/Tokenizer-Structure/>**

<img src="https://i.imgur.com/EUoPlXq.png" width="100%" alt="LLM Tokenizer Structure 화면">

## 1. 소개 (Introduction)

이 프로젝트는 LLM 토크나이저가 텍스트를 토큰으로 변환하는 과정을 교육·발표·검증용으로 시각화하는 정적 웹 애플리케이션입니다. 브라우저에서 Transformers.js를 직접 실행해 **정규화 → 사전 토큰화 → 토큰 모델 → 후처리 → Token ID**를 보여줍니다. 각 단계는 선택한 artifact의 실제 설정에 따라 생략되거나 다른 규칙을 사용할 수 있습니다.

주요 기능:

- **파이프라인 시각화**: normalization, pre-tokenization, BPE/WordPiece/Unigram, post-processing을 토큰 배지로 표시
- **고정된 6개 공개 artifact**: GPT-4o(o200k), Qwen3.5 0.8B, Llama 4 Scout tokenizer, Gemma 3 1B, DeepSeek-V3, BERT multilingual
- **분석 지표**: Unicode code point/token, UTF-8 byte/token, 컨텍스트 게이지, 토큰 히트맵
- **비교 도구**: 2열 tokenizer 비교, 입력 샘플 매트릭스, 수록 API 모델의 표준 입력 단가 환산
- **상호작용**: 토큰 조각 연동, 프리셋, 한국어/영어, 반응형 화면, 키보드 탐색
- **Inspector**: text pair·padding·truncation 옵션, token/mask/source 상세, roundtrip 분류, Unicode A/B 렌즈
- **재현 가능한 결과**: versioned JSON/CSV export, 클립보드 복사, 원문을 기본 제외하는 URL 상태 공유
- **Learn**: 세 개의 5분 경로, 6단계 학습 루프, 4문항 퀴즈, 용어집, 초급/기술 설명

## 2. P0/P1 신뢰·분석 기반

2026-08-24에 Contract & Reliability P0를 완료했습니다.

- `AnalysisRequest`/`AnalysisResult` v1: JSON-safe 결과, provenance, capability, evidence, 구조화된 fallback 사유
- 실제 artifact 결과와 교육용 heuristic 결과를 계약 수준에서 분리
- UTF-16 code unit, Unicode code point, grapheme, UTF-8 byte 길이를 독립 기록
- tokenizer artifact catalog와 API 가격 catalog 분리
- Tailwind Play CDN 제거, local utility CSS 적용
- Transformers.js v3.8.1 공식 npm bundle·라이선스 self-host와 SHA-256 검증
- remote script/style과 eval을 차단하는 meta CSP 적용
- Unicode golden, contract, catalog, supply-chain, 정적 회귀 테스트 40개
- actual Chrome에서 real tokenizer, 입력 변경, 모달·언어 전환, 320px layout, console/network 오류를 smoke 검증

세부 결과는 [P0 검증 기록](docs/P0-VALIDATION.md), offset과 v4 결정은 [ADR 0001](docs/adr/0001-p0-contract-runtime-and-offsets.md), 후속 우선순위는 [ROADMAP](ROADMAP.md)을 참고하세요.

같은 날 Inspector & Learn P1 기능 구현도 완료했습니다.

- `AnalysisRequest`/`AnalysisResult` v2와 UI·adapter·export/share가 공유하는 canonical 옵션
- 줄 번호·code point·UTF-8 byte 제한이 있는 다중행 편집기와 token/encoding 상세
- add special token, text pair, artifact 조건부 padding, padding side, truncation, max length 옵션
- encode → decode 분류, 원문/정규화 diff, 6개 Unicode A/B 렌즈
- versioned JSON/CSV/clipboard export와 원문을 기본 제외하는 URL 공유·복원
- 세 개의 5분 Learn 경로, ko/en·초급/기술 설명, 4문항 퀴즈, 용어집
- versioned Worker load/analyze/dispose/cancel 프로토콜, stale 억제, retry/cancel, 2-entry LRU
- Node 결정론적 회귀 테스트 85개, actual Chrome P1 통합 smoke, Chromium axe 접근성 0 violations 통과

기능 구현 근거와 지원 경계는 [P1 검증 기록](docs/P1-VALIDATION.md)에 있습니다. axe 자동 접근성 검증은 Chromium 기준으로 완료했고, 목표 사용자 80% 사용성([측정 프로토콜](docs/P1-USABILITY-PROTOCOL.md))과 Firefox/WebKit은 기능 구현과 구분해 남은 릴리스 gate로 관리합니다.

2026-08-25에는 P2 Request & Context Token Lab의 로컬 범위를 완료했습니다.

- `RequestSpec`/`RequestAnalysisResult` v1과 크기·깊이·키를 제한하는 tool schema 검증
- 실제 렌더링으로 판정하는 chat template 능력(무시 / 거부 / system 병합을 각각 구분)
- 본문만 · 템플릿 적용 · 구조 overhead를 독립 수치로 분리하고, 합이 정확히 일치하는 누적 세그먼트
- 직렬화 결과를 다시 토큰화할 때의 BOS/EOS 중복 경고
- 컨텍스트 예산·truncation 예측·고정 prefix / 가변 suffix 분리·turn별 재입력 토큰
- 호출당·일간·월간 비용 시나리오, 티어와 수명주기 경고, 단가 없는 과금 요소의 명시적 제외
- Node 결정론적 회귀 테스트 140개, Request Lab axe 접근성 0 violations

측정값과 지원 경계는 [P2 검증 기록](docs/P2-VALIDATION.md)에 있습니다. 선택적 공식 계수 gateway는 계약과 화면 자리만 확보한 상태이며, 브라우저 배포물에는 API 키를 두지 않습니다.

이어서 P3 Corpus Benchmark & Teaching을 완료했습니다.

- 내장 말뭉치 2종과 `[언어,도메인]` 태그를 지원하는 사용자 문장 묶음
- 고정 revision artifact 2~4개 열 비교, 토큰 수·cp/토큰·byte/토큰·컨텍스트 점유율
- 평균만이 아니라 중앙값·p50·p95·최소·최대와 열별 실패 수
- 부분 실패를 평균·순위·색상에서 격리하고, 순위는 모든 성공 열이 함께 성공한 부분집합에서만 계산
- 모델 전환·역순 응답에서도 열이 섞이지 않는 run 최신성 보호
- 일반화 금지 안내를 화면·JSON·CSV 보고서에 모두 포함
- 단계별 reveal·발표자 메모·초기화가 있는 발표 모드와, 원문을 담지 않는 재현 가능한 수업 링크
- Node 결정론적 회귀 테스트 181개, 7개 view × ko/en × 1280×720·320px axe 접근성 0 violations

측정값과 경계는 [P3 검증 기록](docs/P3-VALIDATION.md)에 있습니다.

마지막으로 P4 Platform & Extensibility를 완료했습니다.

- artifact 파일은 Transformers.js가 이미 소유한 cache를 그대로 쓰고, 이 앱은 manifest만 따로 관리 (같은 파일을 두 벌 갖지 않음)
- 401·404·HTML fallback·opaque·부분 응답을 사유별로 거부하고, 실패 시 받은 조각을 삭제
- `pin됨` / `런타임 캐시됨(pin 아님)` / `일부만 캐시됨` / `캐시 없음`을 구분해 offline 표시를 실제와 일치시킴
- HTML은 network-first, 자산은 stale-while-revalidate인 app shell Service Worker (artifact 요청은 통과)
- remote code(`auto_map`·`trust_remote_code`·모듈 경로 클래스)를 차단하고 component 화이트리스트·크기·깊이 상한을 지키는 세션 한정 custom artifact 업로드
- 저장소·pin·custom artifact·데이터 신선도를 보는 운영 화면
- Node 결정론적 회귀 테스트 229개, 8개 view × ko/en × 1280×720·320px axe 접근성 0 violations

측정값과 경계는 [P4 검증 기록](docs/P4-VALIDATION.md), core/CLI/SDK 판단은 [ADR 0002](docs/adr/0002-embeddable-core-cli-and-adapter-sdk.md)에 있습니다.

## 3. 기술 스택 (Tech Stack)

- **Frontend**: Vanilla JavaScript ES Modules, HTML5
- **Styling**: checked-in utility CSS + 역할별 component CSS
- **Tokenizer Engine**: vendored `@huggingface/transformers` v3.8.1 tokenizer-only bundle
- **Artifact Data**: exact revision, license declaration, file size, compatibility, capability registry
- **Pricing Data**: tokenizer artifact와 독립된 제공사 모델·가격 catalog, 기준일 2026-08-24
- **Tests**: Node.js 기본 test runner; 외부 test dependency 없음
- **Deployment**: GitHub Pages 정적 호스팅; build 단계 없음

### 정확도와 데이터 기준

- 기본 tokenizer는 2026-08-24에 익명 브라우저 load를 확인한 공개 Hugging Face artifact이며 확인 당시 commit SHA로 고정합니다.
- real 결과에는 runtime과 artifact revision provenance가 남습니다. 원격 load/실행 실패 결과는 heuristic으로 명시하며 선택 모델의 실제 결과처럼 표시하지 않습니다.
- 현재 v3.8.1 브라우저 runtime은 exact original/normalized offset을 공개 계약으로 보장하지 않으므로 offset을 substring 검색 등으로 합성하지 않고 unavailable로 둡니다.
- 가격은 [OpenAI 모델 문서](https://developers.openai.com/api/docs/models), [Gemini API 가격](https://ai.google.dev/gemini-api/docs/pricing), [Claude API 가격](https://platform.claude.com/docs/en/about-claude/pricing)의 표준 비캐시 텍스트 단가를 기준으로 합니다.
- 비용 화면은 **선택 artifact가 단독 입력을 인코딩한 최종 Token ID 수 × 선택 API의 표준 비캐시 입력 단가**인 참고값입니다. tokenizer와 API 모델의 실제 계수 의미가 같다고 보장하지 않습니다.
- 컨텍스트 게이지는 system, history, tool schema, 출력·추론 reserve를 포함하지 않습니다. 실제 청구는 제공사의 tokenizer/count API, response usage, 청구 내역으로 확인하세요.

## 4. 설치 및 실행 (Quick Start)

요구 사항은 Python 3 또는 다른 로컬 정적 서버입니다. ES Modules와 원격 artifact fetch 때문에 `file://`로 직접 열 수 없습니다.

1. 저장소를 clone합니다.

   ```bash
   git clone https://github.com/JTech-CO/Tokenizer-Structure.git
   cd Tokenizer-Structure
   ```

2. 정적 서버를 실행합니다. API key와 별도 환경 변수는 필요하지 않습니다.

   ```bash
   python -m http.server 8000
   ```

   Windows에서는 `serve.bat`을 실행할 수도 있습니다. 브라우저에서 `http://localhost:8000/`에 접속하면 메인 화면으로 이동합니다.

3. 회귀 테스트를 실행합니다.

   ```bash
   npm test
   ```

   외부 패키지 설치 없이 Node.js 기본 test runner로 229개 테스트를 실행합니다.

GitHub Pages는 저장소를 `main` / `(root)`로 지정하면 `https://<user>.github.io/<repo>/`에서 build 없이 동작합니다.

## 5. 폴더 구조 (Structure)

```text
tokenizer-structure/
├── index.html                    # GitHub Pages용 root redirect + strict CSP
├── llm_tokenizer_simulator.html  # main UI + CSP
├── sw.js                         # app shell service worker (artifacts excluded)
├── css/
│   ├── utilities.css             # local reset/utility CSS
│   ├── base.css
│   ├── controls.css
│   ├── analysis.css
│   ├── views.css
│   ├── p1.css                   # Inspector/Learn/editor 반응형 UI
│   ├── p2.css                   # Request Lab 반응형 UI
│   ├── p3.css                   # 말뭉치 비교와 발표 모드
│   └── p4.css                   # 운영 화면
├── js/
│   ├── analysisContract.js       # AnalysisRequest/Result v2, encoding, roundtrip, provenance
│   ├── analysisOptions.js        # UI/adapter/export/share canonical tokenizer options
│   ├── artifacts.js              # pinned tokenizer artifact registry
│   ├── unicodeMetrics.js         # UTF-16/code point/grapheme/UTF-8 metrics
│   ├── tokenizer.js              # Transformers.js adapter + explicit heuristic fallback
│   ├── inspectorDomain.js        # input/lens/diff/export/share pure domain
│   ├── inspectorView.js          # Inspector UI
│   ├── inputEditor.js            # line numbers, limits, input metrics
│   ├── lessons.js                # versioned Learn content and scoring
│   ├── learnView.js              # Learn UI
│   ├── requestContract.js        # RequestSpec/RequestAnalysisResult v1
│   ├── chatTemplate.js           # runtime capability probe + overhead segments
│   ├── contextBudget.js          # cumulative timeline, truncation, cache prefix
│   ├── costScenario.js           # tier/lifecycle/scenario cost model
│   ├── requestLabView.js         # Request Lab UI
│   ├── corpus.js                 # Corpus v1, built-in and user sample sets
│   ├── benchmarkDomain.js        # BenchmarkResult v1, distribution, failure isolation
│   ├── benchmarkRun.js           # run ordering guard over the real adapter
│   ├── benchmarkView.js          # corpus benchmark UI
│   ├── presentation.js           # reveal reducer and presenter notes
│   ├── presentationView.js       # presentation mode UI
│   ├── cacheManifest.js          # storage ownership and cache-write policy
│   ├── artifactCache.js          # artifact pin manifest over the runtime cache
│   ├── customArtifact.js         # local tokenizer validation, no remote code
│   ├── operateView.js            # storage, pins, custom artifact, freshness
│   ├── workerProtocol.js         # versioned Worker messages + tokenizer LRU
│   ├── tokenizerWorker.js        # Worker runtime
│   ├── tokenizerWorkerClient.js  # stale/retry/cancel-aware client
│   ├── tokenizerWorkerEntry.js   # executable Transformers.js Worker entry
│   ├── byteDisplay.js
│   ├── pricing.js                # independent API pricing catalog/source registry
│   ├── pipeline.js
│   ├── compare.js
│   ├── matrix.js
│   ├── costModal.js
│   ├── latestRequest.js
│   ├── i18n.js
│   ├── state.js
│   ├── dom.js
│   ├── presets.js
│   ├── hover.js
│   └── main.js
├── vendor/
│   ├── huggingface-transformers-3.8.1.min.js
│   ├── HUGGINGFACE-TRANSFORMERS-LICENSE
│   ├── manifest.json             # package integrity + file SHA-256
│   └── README.md
├── tests/
│   ├── fixtures/unicode-golden.json
│   ├── analysisContract.test.js
│   ├── artifacts.test.js
│   ├── pricingCatalog.test.js
│   ├── security.test.js
│   ├── unicodeMetrics.test.js
│   ├── core.test.js
│   ├── static.test.js
│   ├── analysisOptions.test.js
│   ├── inspectorDomain.test.js
│   ├── lessons.test.js
│   ├── tokenizerP1.test.js
│   ├── workerProtocol.test.js
│   ├── requestContract.test.js
│   ├── chatTemplate.test.js
│   ├── contextBudget.test.js
│   ├── costScenario.test.js
│   ├── requestLabStatic.test.js
│   ├── corpus.test.js
│   ├── benchmarkDomain.test.js
│   ├── benchmarkRun.test.js
│   ├── presentation.test.js
│   ├── benchmarkStatic.test.js
│   ├── cacheManifest.test.js
│   ├── artifactCache.test.js
│   ├── customArtifact.test.js
│   ├── serviceWorker.test.js
│   └── operateStatic.test.js
├── docs/
│   ├── P0-VALIDATION.md
│   ├── P1-VALIDATION.md
│   ├── P1-USABILITY-PROTOCOL.md
│   ├── P2-VALIDATION.md
│   ├── P3-VALIDATION.md
│   ├── P4-VALIDATION.md
│   ├── adr/0001-p0-contract-runtime-and-offsets.md
│   └── adr/0002-embeddable-core-cli-and-adapter-sdk.md
├── package.json
├── ROADMAP.md
├── serve.bat
└── .nojekyll
```

## 6. 정보 (Info)

- 문의와 버그 제보: [GitHub Issues](https://github.com/JTech-CO/Tokenizer-Structure/issues)
