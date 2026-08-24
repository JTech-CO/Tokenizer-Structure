# 확장 가이드 — lesson, artifact, engine·provider adapter

- 대상: 이 저장소에 lesson·artifact·adapter를 추가하려는 사람
- 기준일: 2026-08-25
- 전제: [`ROADMAP.md`](../ROADMAP.md) 4절 기획 원칙과 [`ADR 0002`](adr/0002-embeddable-core-cli-and-adapter-sdk.md)의 경계

## 0. 무엇을 추가하든 지켜야 하는 것

1. **의존성 0.** 이 저장소는 런타임·빌드 의존성이 없습니다. `package.json`의 `dependencies`는 비어 있어야 하고 테스트는 `node --test`만 씁니다. 검증한 파일이 그대로 배포되는 성질을 지키기 위한 것입니다.
2. **순수 모듈은 순수하게.** 계약·도메인 모듈은 `document`·`window`·`fetch`·`eval`을 참조하지 않습니다. `tests/benchmarkStatic.test.js`, `tests/operateStatic.test.js`, `tests/builderStatic.test.js`가 이를 강제합니다. 새 순수 모듈을 만들면 같은 목록에 추가하세요.
3. **런타임 의존은 주입으로.** 실행 계층은 생성자로 받습니다. 기존 예: `BenchmarkRunner({ loadTokenizer, analyze })`, `ArtifactCacheManager({ cacheStorage, manifestStore, fetchImpl })`, `TokenizerWorkerClient({ workerFactory })`.
4. **모르는 값은 0이 아니라 사유로.** 값을 만들 수 없으면 `unavailableReason`을 남깁니다. 빈칸이나 0으로 채우면 계약이 거부합니다.
5. **능력은 추정하지 말고 판정.** 모델 이름으로 기능을 가정하지 않습니다. `chatTemplate.js`의 `probeChatTemplate()`처럼 실제로 실행해 보고 판정합니다.
6. **테스트 없이 병합하지 않습니다.** 추가하는 모든 계약에는 "잘못된 입력을 거부하는" 테스트가 함께 있어야 합니다.

## 1. lesson 추가

lesson 데이터는 [`js/lessons.js`](../js/lessons.js)에 있고 `validateLessonCatalog()`가 형식을 검사합니다.

### 필수 필드

```js
{
  schemaVersion: '1.0.0',
  id: 'kebab-case-id',
  lessonVersion: '1.0.0',      // 내용이 바뀌면 올린다
  durationMinutes: 5,
  reviewedAt: 'YYYY-MM-DD',    // 근거를 실제로 확인한 날
  sourceUrl: 'https://…',      // 공식 문서. 블로그·요약본이 아니라 1차 출처
  title: { ko, en },
  sample: { interactionKind, input, suggestedAction },
  enginePolicy: {
    realAllowed, realRequired, fallbackAllowed,
    fallbackDisclosureRequired, fallbackUse,
  },
  steps: [ /* 정확히 6단계 */ ],
  quiz:  [ /* 정확히 4문항 */ ],
  glossaryTermIds: [...],
  narrativeTemplate: { ko, en },
}
```

### 6단계 구조

`goal → predict → interact → explain → misconception → summary` 순서가 고정입니다. 각 단계는 `heading: {ko,en}`과 `copy: { beginner: {ko,en}, technical: {ko,en} }`를 가집니다. 초급/기술 두 수준을 모두 채워야 합니다. 한쪽만 있으면 설명 수준 전환이 깨집니다.

### 4문항 규칙

- 통과 기준은 4문항 중 3문항입니다. 채점은 `scoreLessonQuiz()`가 합니다.
- 각 문항은 `correctOptionId`와 `explanation: { beginner, technical }`를 가집니다.
- **오답 선택지도 그럴듯해야 합니다.** 명백히 틀린 보기만 넣으면 오개념을 측정하지 못합니다.

### 발표자 메모

발표 모드는 lesson 데이터의 `technical` 설명과 오답 해설을 그대로 씁니다([`js/presentation.js`](../js/presentation.js)의 `learnPresenterNotes`). 발표용 문구를 따로 만들지 않습니다. 즉 `technical` 문구를 잘 쓰면 발표 메모가 함께 좋아집니다.

### 추가 후 할 일

1. `tests/lessons.test.js`에 새 lesson id를 포함시킵니다.
2. `js/main.js`의 `LESSON_NAMES`에 id를 추가합니다(공유 링크 복원에 쓰입니다).
3. 사용성 측정 대상이 바뀌므로 [`P1-USABILITY-PROTOCOL.md`](P1-USABILITY-PROTOCOL.md) 5.2절의 문항표를 갱신합니다.

## 2. artifact 추가

artifact 카탈로그는 [`js/artifacts.js`](../js/artifacts.js)입니다.

```js
artifact({
  id: 'owner/repo',
  revision: '<40자리 commit SHA>',   // 이름표(main)는 허용하지 않는다
  label: '...', family: '...', context: 128_000,
  licenseIdentifier: 'mit' | null,   // 확인 못 했으면 null (unknown으로 표시된다)
  tokenizerAssetBytes: 12_345,
})
```

### 검증 절차

1. **익명 브라우저 로드가 되는지.** gated·private repo는 401을 돌려줍니다. 401 HTML 페이지를 정상 파일로 캐시하지 않도록 [`js/cacheManifest.js`](../js/cacheManifest.js)가 막지만, 애초에 로드되지 않는 artifact는 카탈로그에 넣지 않습니다.
2. **라이선스를 확인했는지.** `cardData.license`가 없으면 `licenseIdentifier: null`로 두고 화면에 "메타데이터 없음"으로 표시되게 합니다. 임의로 추정하지 않습니다.
3. **Transformers.js v3.8.1에서 4단계가 실제로 분해되는지.** 큰 `tokenizer.json`은 브라우저 폴링 검증이 불안정하므로 Node로 확인하는 편이 빠릅니다.
4. **`tests/artifacts.test.js`** 가 revision 형식·라이선스·파일 크기·capability를 검사합니다.

### 요청되는 파일

Transformers.js v3.8.1은 artifact당 `tokenizer.json`과 `tokenizer_config.json` **두 개만** 요청합니다(실측). offline pin 목록([`js/operateView.js`](../js/operateView.js)의 `artifactFileUrls`)이 이 사실에 기대고 있으므로, 런타임을 올릴 때 요청 파일이 바뀌면 pin 목록도 함께 고쳐야 합니다. 그렇지 않으면 "offline 가능" 표시가 실제와 어긋납니다.

## 3. engine adapter 추가

현재 engine adapter는 하나입니다: [`js/tokenizer.js`](../js/tokenizer.js)의 `tokenizeReal()`.

### 계약

```
(tok, text, options) -> AnalysisResult v2
```

새 adapter는 [`js/analysisContract.js`](../js/analysisContract.js)의 `createAnalysisResult()`를 통과해야 합니다. 이 함수가 다음을 강제합니다.

- 모든 수치에 evidence 등급 또는 `unavailableReason`
- `provenance`에 adapter 이름·버전, runtime 이름·버전, artifact id·revision
- 제공하지 못하는 encoding 항목(offset, sequence id, word id 등)은 값 대신 사유

### 하면 안 되는 것

- **실패를 폴백으로 덮지 마세요.** `tokenizeWith()`는 실패 시 조용히 휴리스틱으로 대체합니다. 보고서·벤치마크 경로에서는 절대 쓰지 않습니다(`tests/benchmarkStatic.test.js`가 막습니다). 실패는 실패로 기록합니다.
- **substring 검색으로 offset을 만들지 마세요.** [`ADR 0001`](adr/0001-p0-contract-runtime-and-offsets.md)의 결정입니다.

### Worker에서 쓰려면

[`js/tokenizerWorker.js`](../js/tokenizerWorker.js)의 런타임은 adapter를 주입받습니다. 프로토콜은 [`js/workerProtocol.js`](../js/workerProtocol.js)의 v1 `load`/`analyze`/`dispose`/`cancel`입니다.

## 4. provider adapter 추가

제공사 토큰 계수는 아직 구현되지 않았고 **자리만** 있습니다.

```js
result.providerCounts = {
  preflight: { status: 'not-configured', tokenCount: null,
               unavailableReason: 'gateway-not-configured', … },
  actual:    { status: 'not-configured', … },
}
```

### 반드시 지킬 것

1. **브라우저 번들·localStorage·URL에 API 키를 넣지 않습니다.** `tests/requestLabStatic.test.js`가 자격증명 패턴과 제공사 엔드포인트를 검사합니다.
2. 공식 계수는 **선택적 서버 프록시나 로컬 self-host adapter**에서만 호출합니다. 정적 배포물이 직접 제공사 API를 부르지 않습니다.
3. 전송 전에 명시적 확인을 받습니다. 원문이 브라우저를 떠나는 것은 사용자가 선택한 경우뿐입니다.
4. `preflight`와 `actual`을 섞지 않습니다. 근거 등급이 다릅니다([`ROADMAP.md`](../ROADMAP.md) 5.3절).
5. gateway가 없어도 로컬 분석은 완전하게 동작해야 합니다. 이것이 P2 완료 조건입니다.

### 가격 데이터

[`js/pricing.js`](../js/pricing.js)의 항목에 `modifiers`나 `toolCharges`를 넣으면 [`js/costScenario.js`](../js/costScenario.js)가 **코드 변경 없이** 계산에 반영합니다. 다만 공식 문서로 확인하지 않은 배수는 넣지 마세요. 없으면 `catalog-has-no-rate`로 제외 항목에 표시되는 편이 정확합니다.

## 5. 순수 모듈 추가

새 도메인 모듈을 만들 때의 체크리스트입니다.

- [ ] `document`·`window`·`fetch`·`eval`·`new Function`을 쓰지 않는다
- [ ] 입력 상한(개수·길이·깊이)을 상수로 선언하고 넘으면 **거부**한다(자르지 않는다)
- [ ] 알 수 없는 필드를 거부한다(`assertKnownKeys`)
- [ ] `__proto__` 등 위험한 키를 거부한다
- [ ] 동점·순서 의존을 제거해 같은 입력이 같은 결과를 낸다
- [ ] 정적 테스트 목록(`tests/*Static.test.js`)에 모듈 이름을 추가한다

마지막 항목을 빠뜨리면 경계가 문서로만 남고 시간이 지나며 흐려집니다.

## 6. 새 화면 추가

1. `llm_tokenizer_simulator.html`의 `<main id="viewContainer">` **안에** tabpanel을 넣습니다. 밖에 두면 axe `region` 위반이 납니다.
2. tab 버튼에 `role="tab"`, `aria-controls`, `tabindex`를 붙입니다.
3. `js/main.js`의 `VIEW_NAMES`에 이름을 추가하고 `switchView`에서 렌더를 연결합니다.
4. 스크롤 영역에 포커스 가능한 자식이 없으면 영역 자체에 `tabindex="0"`을 줍니다. 없으면 `scrollable-region-focusable`(serious) 위반이 납니다.
5. `aria-label`을 쓰는 `div`에는 `role`을 함께 주세요. 없으면 `aria-prohibited-attr` 위반입니다.
6. 표의 빈 머리글을 만들지 마세요(`empty-table-header`).
7. `sw.js`의 `APP_SHELL`에 새 파일을 추가합니다. `tests/serviceWorker.test.js`가 실제 파일 목록과 대조합니다.
8. 320px에서 가로 넘침이 없는지 확인합니다. 긴 문자열은 `overflow-wrap: anywhere`로 흘려보내고, 표는 자체 가로 스크롤 컨테이너에 넣습니다.

## 7. 검증 명령

```bash
npm test
```

접근성은 axe-core를 저장소 의존성에 넣지 않고 임시로 주입해 확인합니다. 절차는 [`P1-VALIDATION.md`](P1-VALIDATION.md) 3절에 있습니다.
