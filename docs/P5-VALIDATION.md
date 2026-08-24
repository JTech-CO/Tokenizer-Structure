# P5 검증 기록 — Tokenizer Builder & Research

- 상태: 소형 BPE Builder·merge replay·기여 가이드 구현 완료 / Unigram은 후속 연구로 남김
- 검증일: 2026-08-25
- 기준 브랜치: `main`
- 대상: 정적 GitHub Pages UI, BPE training v1 계약

## 1. 무엇을 만들었는가

완성된 tokenizer를 관찰하는 것을 넘어, **작은 말뭉치에서 merge 규칙이 쌓이는 과정**을 단계별로 되짚어 보는 도구입니다.

로드맵의 제약을 그대로 설계에 넣었습니다.

| 제약 | 구현 |
|---|---|
| 대형 모델 학습 도구를 목표로 하지 않음 | 상한을 상수로 선언하고 넘으면 **거부**. 화면 문구에도 명시 |
| 성능·재현성이 검증되기 전에는 "실시간 학습"으로 약속하지 않음 | 실행 전 규모 미리보기, 실행 후 실제 소요 시간과 함께 "실시간 학습 성능이 아님"을 표시 |
| 처음에는 검증된 사전 계산 replay를 우선 | 학습을 **한 번** 계산해 모든 단계를 기록하고, 화면은 그 기록을 되짚는 replay만 함 |

## 2. 결정론

같은 입력은 항상 같은 merge 순서를 냅니다. 이것이 replay와 교육 자료의 전제입니다.

- 단어 빈도는 **정렬해서** 사용합니다(빈도 내림차순 → 사전순). 삽입 순서에 결과가 의존하지 않습니다.
- 후보 쌍이 동점이면 **사전순**으로 확정합니다.
- 테스트로 고정했습니다: 말뭉치 단어 순서를 뒤집어도 merge 목록이 동일해야 합니다.

```text
trainBpe(CORPUS)            .merges
trainBpe(reverse(CORPUS))   .merges   → deepEqual
```

## 3. 알려진 말뭉치에서 나오는 결과

Sennrich 예제와 같은 구조의 말뭉치(`low`×5, `lower`×2, `newest`×6, `widest`×3)로 검증했습니다.

| 단계 | 선택한 쌍 | 빈도 | 새 토큰 |
|---:|---|---:|---|
| 1 | `e` + `s` | 9 | `es` |
| 2 | `es` + `t` | 9 | `est` |
| 3 | `est` + `</w>` | 9 | `est</w>` |

브라우저 실측(기본 말뭉치, merge 20 요청):

```text
merge 15회 · vocab 26개 · 1ms · 종료 사유: 2회 이상 반복되는 쌍이 없음
```

단계별 상태 변화도 그대로 관찰됩니다.

| 단계 | vocab | 전체 심볼 수 | `newest`의 조각 |
|---:|---:|---:|---|
| 0 | 11 | 95 | `n e w e s t </w>` |
| 3 | 14 | 68 | `n e w est</w>` |

## 4. merge replay와 encode의 연결

`replayState(training, step)`는 학습을 다시 돌리지 않고 그 시점 상태를 되살립니다. 그리고 `encodeWithMerges()`로 학습 말뭉치에 없던 단어를 같은 규칙으로 인코딩합니다.

브라우저 실측(3단계 시점, 시험 단어 `lowest`):

```text
l | o | w | est</w>       4조각 · 적용한 merge 3회
```

**replay 상태와 encode 결과가 일치**해야 한다는 성질을 테스트로 고정했습니다. 학습 말뭉치의 모든 단어에 대해 `encodeWithMerges(word, merges)`가 replay가 보여 주는 분해와 정확히 같아야 합니다.

### vocab 크기에 따른 조각 수

| merge | vocab | 조각 수 | 조각 |
|---:|---:|---:|---|
| 0 | 11 | 7 | `l o w e s t </w>` |
| 5 | 16 | 2 | `low` `est</w>` |
| 10 | 21 | 2 | `low` `est</w>` |
| 15 | 26 | 2 | `low` `est</w>` |

merge를 늘려도 조각 수는 **줄어들기만 하고 늘지 않으며**, 어느 지점부터는 더 줄지 않습니다. 이 성질도 테스트로 고정했습니다("more merges never produce more tokens").

## 5. 상한과 성능

상한을 넘는 입력은 자르지 않고 사유와 함께 거부합니다.

| 상한 | 값 | 거부 코드 |
|---|---:|---|
| 말뭉치 | 5,000 code points | `corpus-too-large` |
| 고유 단어 | 400종 | `too-many-words` |
| merge | 200회 | `too-many-merges` |
| 단어 길이 | 64 심볼 | `word-too-long` |
| vocab | 2,000 | (학습이 `vocab-limit`으로 정지) |
| 빈 말뭉치 | — | `empty-corpus` |

브라우저에서 거부 코드가 실제로 나오는 것을 확인했습니다.

### 최악 규모 실측

상한에 최대한 가까운 말뭉치를 실제로 학습시켰습니다.

```text
4,995 code points · 고유 단어 400종 · 전체 단어 1,285개 · merge 200회
→ vocab 237 · 38ms (재실행 33ms) · 종료 사유: 요청한 횟수 도달
→ 두 번 실행한 merge 목록이 동일 (deterministic)
```

38ms는 **이 상한 안에서만** 나오는 수치입니다. 화면은 실행 전 규모를, 실행 후 실제 소요 시간과 함께 "큰 말뭉치의 실시간 학습 성능을 뜻하지 않습니다"를 표시합니다.

## 6. 화면

`Builder` 탭(9번째 view)의 구성입니다.

- **말뭉치 입력**과 옵션(merge 횟수, 소문자 통일, 특수 토큰, 시험 단어)
- **규모 미리보기**: 고유 단어 수, 초기 심볼 수, 단계당 최대 비교 횟수, 그리고 상한 전체
- **단계 되짚기**: 처음/이전/다음/끝 + 슬라이더. 각 단계에서 선택한 쌍, 새 토큰, 빈도, 영향받은 단어 수, vocab 크기, 전체 심볼 수
- **후보 빈도 막대**: "무엇 중에 골랐는지"를 보여 줍니다. 선택된 후보는 색과 굵기로 구분합니다
- **단어 분해 상태 표**와 **인코딩 결과**, **merge 횟수별 조각 수 비교**

특수 토큰은 vocab에 들어가되 말뭉치에 없으므로 어떤 merge에도 등장하지 않습니다. 이 성질도 테스트로 확인합니다.

## 7. 기여 가이드

로드맵의 "lesson/engine/provider adapter 생태계와 기여 가이드"는 [`docs/EXTENDING.md`](EXTENDING.md)로 답했습니다. 실제 코드에 근거한 절차만 담았습니다.

- lesson 추가: 6단계·4문항 구조, `lessonVersion`·`reviewedAt`·`sourceUrl` 규칙, 발표자 메모가 `technical` 문구를 그대로 쓴다는 사실, 추가 후 갱신할 파일 목록
- artifact 추가: 40자리 commit SHA 강제, 라이선스 미확인 시 `null`, 런타임이 실제로 요청하는 파일이 두 개뿐이라는 사실과 그것이 offline pin 목록과 묶여 있다는 점
- engine adapter: `(tok, text, options) -> AnalysisResult v2` 계약, 실패를 폴백으로 덮지 말 것, substring offset 금지
- provider adapter: 키 금지, 서버 프록시/로컬 adapter로만, preflight와 actual을 섞지 말 것, gateway 없이도 로컬 기능이 완전할 것
- 순수 모듈·새 화면 체크리스트: 상한 선언과 거부, 알 수 없는 필드 거부, 정적 테스트 목록 등록, landmark·스크롤 포커스·표 머리글 규칙, `sw.js` 갱신

## 8. 검증 결과

### 결정론적 테스트

```text
npm test
tests 250
pass 250
fail 0
```

P5에서 추가한 범위:

- 단어 빈도의 정렬 결정성, 알려진 말뭉치의 첫 merge 3개, 말뭉치 순서 무관성, 동점의 사전순 확정
- 정지 사유(요청 횟수 도달 / 반복 쌍 없음)와 단계별 후보 기록의 정합성
- replay가 임의 단계 상태를 재현하고 심볼 수가 단조 감소하는 성질
- 학습 말뭉치 전 단어에 대해 replay 분해 == encode 결과
- merge를 늘려도 조각 수가 늘지 않는 성질
- 특수 토큰이 vocab에 들어가되 merge에 등장하지 않음
- 소문자 통일이 학습 **전에** 적용됨
- 6개 상한의 거부 코드와 옵션 검증
- 정적: Builder 마크업, main landmark 포함, landmark 이름 중복 금지, 순수 모듈의 DOM·네트워크·`eval` 부재, 상한 상수 존재, "실시간 학습" 문구 부재 확인, 기본 말뭉치가 상한 안이고 실제로 merge를 만든다는 것, `sw.js` precache 등록

### 접근성

axe-core 4.10.3 기준 **violations 0건**입니다.

| 조건 | 대상 | violations |
|---|---|---:|
| 1280×800 / ko | 9개 view | 0 |
| 1280×800 / en | 9개 view | 0 |
| 320×720 / ko | 9개 view | 0 |

수정한 위반: `landmark-unique` — Builder의 두 패널이 같은 `aria-labelledby`를 가리켜 region 이름이 겹쳤습니다. 두 번째 패널에 고유한 제목을 부여했고, 이름 중복을 정적 테스트로 잠갔습니다. 320px에서 `document.scrollWidth = 320`이고 `#builderView` 하위에 뷰포트를 넘는 요소가 없습니다(자체 가로 스크롤 표 내부 제외). console 오류 0건.

## 9. 하지 않은 것과 이유

**Unigram 후보 제거·확률 설명**은 구현하지 않았습니다. 로드맵도 "별도 후속 연구"로 두고 있습니다. BPE는 merge가 이산적이고 순서가 있어 단계별 관찰이 자연스럽지만, Unigram은 EM 반복과 확률 가지치기라 "한 단계"의 의미가 다릅니다. 같은 replay UI에 억지로 얹으면 두 알고리즘을 같은 것처럼 보이게 만듭니다.

**바이트 수준(byte-level) 사전 토큰화**도 넣지 않았습니다. 학습기의 관찰 대상은 merge이지 사전 토큰화가 아니며, 바이트 표시를 섞으면 화면에서 무엇이 규칙이고 무엇이 표현인지 흐려집니다. 사전 토큰화 자체는 파이프라인 view가 이미 다룹니다.

**Learn 경로 추가**(BPE 학습을 다루는 4번째 5분 경로)는 하지 않았습니다. lesson 데이터는 `sourceUrl`과 `reviewedAt`을 요구하고 4문항 오답 선택지까지 설계해야 합니다. Builder 자체가 단계별 설명을 담고 있으므로, 정식 lesson 추가는 근거 문헌을 정리한 뒤로 미룹니다.

## 10. 배포 중 발견해 고친 것

P5를 배포한 직후 GitHub Pages에서 **9개 탭은 보이는데 Builder 화면이 비어 있는** 상태를 관찰했습니다.

원인은 Service Worker의 캐시 전략이었습니다. HTML은 network-first라 새 배포가 즉시 반영되지만, 자산은 stale-while-revalidate여서 첫 로드에 **이전 `main.js`** 가 응답했습니다. 새 HTML(9개 탭)과 이전 모듈(Builder를 import하지 않음)이 한 번 섞인 것입니다. 두 번째 새로고침에서는 정상이었지만, 배포 직후 방문자는 깨진 중간 상태를 한 번 보게 됩니다.

자산도 network-first로 바꿨습니다. cache는 offline 대비로만 쓰고, 온라인이면 HTML과 모듈이 항상 같은 배포에서 옵니다. offline 능력은 그대로입니다(네트워크 실패 시 cache로 폴백). 이 앱의 지배적 비용은 app shell이 아니라 artifact 다운로드이므로 잃는 속도는 크지 않습니다.

회귀를 막기 위해 Service Worker 테스트를 바꿨습니다. "캐시가 먼저 답하고 뒤에서 갱신한다"를 검증하던 테스트를 "새 배포가 올라오면 첫 요청부터 새 모듈을 받는다 + offline이면 cache가 답한다"로 교체했습니다.

## 11. 남은 게이트

- Unigram replay(별도 연구)
- BPE 학습을 다루는 5분 Learn 경로
- P1부터 이어지는 Firefox/WebKit 검증과 목표 사용자 사용성 측정
- P2의 선택적 공식 계수 gateway
- P4의 public exact-SHA artifact 추가 경로

## 12. 재검증 명령

```bash
npm test
```

브라우저에서 `Builder` 탭을 열고 규모 미리보기 → 학습 실행 → 처음/다음으로 단계 이동 → 후보 빈도와 단어 분해 변화 → 인코딩 결과와 merge 횟수별 비교를 확인합니다. 상한을 넘는 말뭉치를 넣어 거부 코드가 나오는지도 확인합니다.
