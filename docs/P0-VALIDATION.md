# P0 검증 기록 — Contract & Reliability

- 상태: 완료
- 검증일: 2026-08-24
- 기준 브랜치: `main`
- 대상: 정적 GitHub Pages 배포물과 브라우저 내 tokenizer-only 실행 경로

## 1. 완료 범위

### 결과 계약과 renderer 경계

- `AnalysisRequest`/`AnalysisResult` schema version 1을 도입했습니다.
- real 결과는 adapter·runtime·artifact revision provenance를 필수로 보존합니다.
- heuristic 결과는 요청 모델을 실제 artifact 결과처럼 가장하지 않으며 구조화된 fallback 사유가 필수입니다.
- token 문자열, ID, 표시 문자열, normalization, original/normalized offset에 capability와 evidence를 붙입니다.
- 현재 JS runtime이 공개 계약으로 제공하지 않는 original/normalized offset은 값을 합성하지 않고 `runtime-not-exposed`로 표시합니다.
- 입력 길이는 UTF-16 code unit, Unicode code point, grapheme, UTF-8 byte를 서로 다른 필드로 기록합니다. `Intl.Segmenter`가 없으면 grapheme은 이유와 함께 unavailable입니다.
- pipeline과 compare view는 engine 원시 객체가 아니라 canonical `AnalysisResult`만 소비합니다.

### Catalog와 provenance

- 6개 tokenizer artifact를 `js/artifacts.js`로 분리했습니다.
- 저장소, 불변 revision, 검증일, 라이선스 선언 상태, 파일 크기, 공개/gated 상태, v3.8.1 호환성, capability를 데이터로 선언합니다.
- API 모델·가격은 `js/pricing.js`의 별도 catalog와 source registry에서 관리해 tokenizer artifact와 독립 갱신할 수 있습니다.

### 공급망과 CSP

- Tailwind Play CDN을 제거하고 필요한 utility를 `css/utilities.css`로 저장소에 고정했습니다.
- `@huggingface/transformers@3.8.1` 공식 npm bundle과 라이선스를 `vendor/`에 보관합니다.
- npm package integrity와 vendored file SHA-256을 `vendor/manifest.json`에 기록하고 테스트합니다.
- 원격 script/style은 허용하지 않습니다. main CSP의 script 정책은 `script-src 'self'`이며 `unsafe-eval`과 `wasm-unsafe-eval`을 허용하지 않습니다.
- artifact fetch는 Hugging Face 도메인만 `connect-src`로 허용합니다.
- GitHub Pages의 응답 헤더 제약 때문에 CSP는 meta 정책입니다. 동적 heatmap/gauge의 inline style 때문에 `style-src 'unsafe-inline'`은 남아 있습니다.

### Unicode와 offset 결정

- NFC/NFD 한글, 결합 문자, ZWJ emoji와 skin tone, flag, RTL, CRLF, 반복 문자열, tokenizer marker 유사 문자를 golden fixture로 고정했습니다.
- v3.8.1에서 exact original offset을 제공한다고 표시하지 않습니다.
- v4/standalone Tokenizers.js는 공개 offset 계약과 6개 artifact parity gate가 충족될 때 다시 평가합니다. 세부 결정은 `docs/adr/0001-p0-contract-runtime-and-offsets.md`에 있습니다.

## 2. 검증 결과

### 결정론적 테스트

```text
npm test
tests 40
pass 40
fail 0
```

검증 범위는 계약 불변식, JSON 안전성, provenance, artifact catalog, 가격 catalog 분리, SHA-256, CSP, 로컬 자산, JS 문법, HTML ID/자산, Unicode golden, UTF-8 byte continuation, 비동기 stale-result 방어를 포함합니다.

### 실제 브라우저 smoke

로컬 정적 서버와 설치된 Chrome headless/DevTools를 사용했습니다. 브라우저 플러그인의 Node runtime은 이 Windows workspace의 ACL 적용 오류로 시작되지 않아 외부 headless Chrome으로 대체했습니다.

검증 결과:

- 실제 엔진: `gpt-4o`, 초기 예시 24 Token IDs
- 입력을 `A🤗 한글`로 변경한 뒤 실제 엔진 5 Token IDs
- 6개 artifact option 생성
- 언어 전환, 비용 모달 열기/닫기 정상
- local scripts 18개, local stylesheets 5개; remote script/style 0개
- runtime exception, console error, failed request, 4xx/5xx 응답 0개
- 명시적 data favicon으로 기본 `/favicon.ico` 404 제거
- 320px viewport에서 `scrollWidth = 320`, 입력·global controls 표시
- 최소 권한 CSP에서도 실제 tokenizer load와 24 Token IDs 확인

## 3. 후속 Phase의 품질 게이트

| 게이트 | PR/결정론적 | scheduled canary | 릴리스 전 브라우저 |
|---|---|---|---|
| Contract·golden·catalog·hash | 필수 | — | — |
| 고정 artifact 원격 load/CORS | fixture만 | 주기 실행 | 대표 artifact smoke |
| Chromium·Firefox·WebKit | 정적 계약 | — | desktop + 320px |
| GitHub Pages subpath | 상대 asset 검사 | 배포 URL smoke | 대표 URL 직접 확인 |
| 키보드·focus·reduced motion | DOM/ARIA 검사 | — | 전 핵심 작업 |
| axe 접근성 | runner 도입 후 필수 | — | 수동 보완 |
| 긴 입력·빠른 전환·부분 fetch 실패 | 단위/fixture | 원격 실패 canary | 수동 네트워크 throttling |

P1은 이 문서의 브라우저·접근성 항목을 기능별 완료 조건으로 상속합니다. 실제 네트워크 canary는 필수 PR 테스트와 분리해 upstream 장애가 결정론적 회귀 테스트를 흔들지 않게 합니다.

## 4. 재검증 명령

```bash
npm test
python -m http.server 8000
```

브라우저에서 `http://127.0.0.1:8000/`에 접속한 뒤 real engine 배지, 입력 변경, 언어 전환, 비용 모달, 320px viewport, console/network 오류를 확인합니다.
