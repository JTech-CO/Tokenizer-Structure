# ADR 0001 — P0 결과 계약, 브라우저 런타임, exact offset

- 상태: Accepted
- 결정일: 2026-08-24
- 범위: P0 Contract & Reliability

## 맥락

현재 화면은 Transformers.js v3.8.1의 내부 컴포넌트와 자체 조합 결과를 직접
사용합니다. 후속 Inspector, Request Token Lab, export, Benchmark가 각자 다른
결과 의미를 만들지 않으려면 먼저 버전된 결과 계약과 capability가 필요합니다.

원문 offset은 특히 위험합니다. 정규화, 반복 문자열, prefix space, byte
fallback, special token 때문에 표시 token을 원문에서 다시 검색하는 방식은
정확한 정렬이 아닙니다.

## 결정

1. 화면·export·비교의 경계로 `AnalysisResult v1`을 사용합니다.
2. 모든 값은 evidence 등급 또는 `unavailableReason`을 가집니다.
3. artifact 기능은 모델명으로 추정하지 않고 Capability Registry에서 선언합니다.
4. 현재 Transformers.js v3.8.1의 original offset capability는 `none`입니다.
5. substring 검색이나 decode 누적으로 offset을 합성하지 않습니다.
6. v4/standalone Tokenizers.js로 즉시 이전하지 않고 별도 parity gate를 둡니다.
7. 런타임 JavaScript는 공식 npm 3.8.1 번들을 저장소에 vendor하고 SHA-256을 검사합니다.
8. tokenizer-only 제품이므로 ONNX/WASM은 포함하지 않습니다. 추론 기능을 추가할
   때는 자산과 CSP 결정을 새 ADR로 다시 엽니다.

## 조사 결과

- Transformers.js v3.8.1의 문서화된 BatchEncoding은 input IDs, attention mask,
  optional token type IDs를 제공하며 offset mapping을 공개 계약으로 보장하지 않습니다.
- v4는 tokenization을 별도 `@huggingface/tokenizers` 패키지로 분리했지만,
  공개 encode 예시는 IDs, tokens, attention mask 수준입니다.
- 2026-08-24 현재 Tokenizers.js의 character offset 지원 요청은 열린 상태이며,
  Transformers.js의 return_offset_mapping 변경도 안정 릴리스 계약으로 채택되지 않았습니다.
- Rust/Python Tokenizers의 Encoding alignment 기능은 브라우저 JS 런타임과 별개의
  capability이므로 그대로 있다고 간주하지 않습니다.

근거:

- https://huggingface.co/docs/transformers.js/v3.8.1/api/tokenizers
- https://huggingface.co/docs/transformers.js/api/tokenizers
- https://github.com/huggingface/tokenizers.js/
- https://github.com/huggingface/tokenizers.js/issues/16
- https://github.com/huggingface/transformers.js/pulls
- https://huggingface.co/docs/tokenizers/main/api/encoding

## v4 재평가 통과 조건

- 고정된 6개 artifact 모두에서 v3/v4 Token ID, token surface, special token,
  normalization, chat template parity fixture가 통과
- 브라우저 공개 API가 original/normalized offset의 단위와 의미를 문서로 보장
- NFC/NFD, 결합 문자, ZWJ emoji, RTL, CRLF, 반복 문자열, byte split golden 통과
- special/generated token은 원문 span 없음으로 표현 가능
- 번들 크기, CSP, cache, 로드 실패가 현재 기준보다 악화되지 않음

조건을 만족하지 못하면 v3 adapter를 유지하거나, exact offset이 필요한 별도
reference backend/Rust-WASM을 opt-in 기능으로 검토합니다.

## CSP와 호스팅 한계

GitHub Pages에서는 응답 헤더를 직접 설정할 수 없으므로 메인 문서는 meta CSP를
사용합니다. meta CSP는 `frame-ancestors` 같은 응답 헤더 전용 보호를 제공하지
못합니다. 동적 heatmap·gauge가 style 속성을 사용하므로 현재 `style-src`에는
`unsafe-inline`이 남습니다. 스크립트에는 `unsafe-eval`과 `wasm-unsafe-eval`을 허용하지 않습니다.

강한 보안 헤더가 필요해지면 헤더 설정이 가능한 호스팅으로 이전하고, 동적 스타일을
class/stylesheet 기반으로 옮긴 뒤 이 결정을 갱신합니다.
