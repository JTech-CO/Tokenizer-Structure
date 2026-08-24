# LLM은 글을 어떻게 '토큰'으로 쪼갤까 — 브라우저에서 직접 보는 토크나이저

LLM은 텍스트를 토큰으로 분해한 뒤 각 토큰을 정수 ID로 바꿔 처리합니다. 텍스트 모델 API의 컨텍스트 한도와 입력·출력 과금도 주로 토큰 수를 기준으로 하지만, 검색·도구·이미지·오디오에는 별도 과금이 있을 수 있습니다. 평소 보이지 않는 이 과정을 브라우저의 공개 토크나이저 엔진으로 보여주는 소스 공개 시뮬레이터를 만들었습니다.

토큰은 단어·서브워드·문자·바이트 조각뿐 아니라 특수·제어 토큰일 수도 있습니다. 현대 토크나이저는 제한된 어휘로 다양한 입력을 표현하면서 시퀀스 길이를 관리하도록 학습된 BPE·WordPiece·Unigram 등의 규칙을 사용합니다.

## 네 파이프라인 컴포넌트로 들여다보기

`@huggingface/transformers`(Transformers.js)로 토크나이저를 불러오면, 단 한 줄로 토큰 ID를 얻을 수 있습니다.

```js
import { AutoTokenizer } from '@huggingface/transformers';
const tok = await AutoTokenizer.from_pretrained('Xenova/gpt-4o', {
  revision: '7956d98f2a83b2751a98ea7136fdf7fe6cf54e69',
});
tok.encode('안녕하세요'); // → [14307, 171731]
```

Hugging Face Tokenizers는 토큰화를 네 컴포넌트로 설명합니다. Transformers.js v3.8.1에서는 이 컴포넌트에 접근할 수 있어 중간 결과를 펼쳐 볼 수 있습니다. 다만 normalizer와 post-processor 등은 선택 사항이며 모델마다 구현과 규칙이 다릅니다.

```js
const norm = tok.normalizer ? tok.normalizer.normalize(text) : text; // 1. 정규화
const pre = tok.pre_tokenizer
  ? tok.pre_tokenizer.pre_tokenize_text(norm, {})
  : [norm];                                                          // 2. 사전 토큰화
const pieces = tok.model(pre);                                       // 3. 토큰 모델
const ids = tok.encode(text);                                        // 4. 최종 인코딩
```

**정규화**는 설정된 경우 유니코드나 대소문자 등을 처리합니다. **사전 토큰화**는 ByteLevel·Metaspace·정규식 등 모델별 규칙으로 후보 구간을 나눕니다. **토큰 모델**은 학습된 어휘와 병합·분할 규칙으로 문자열 또는 바이트 조각을 토큰에 매핑합니다. **후처리**는 모델과 호출 옵션에 따라 특수 토큰이나 템플릿을 적용할 수 있습니다.

## BPE는 어떻게 단어를 쪼개나

BPE(Byte Pair Encoding)는 학습 과정에서 자주 등장하는 쌍을 반복해 병합하고, 추론 시 학습된 병합 순위와 규칙을 적용합니다. WordPiece는 다른 점수 기준과 longest-match 절차를 사용하며, Unigram은 후보 분할의 확률을 비교합니다. SentencePiece는 BPE나 Unigram을 적용할 수 있는 프레임워크이므로 하나의 알고리즘 이름과 동일시하면 안 됩니다. 어휘 크기·학습 데이터·정규화·사전 토큰화 규칙이 모두 최종 토큰 수에 영향을 줍니다.

## "안"이 왜 `ìķĪ`로 보일까

Byte-level 계열은 UTF-8 **바이트**에서 시작하고 각 바이트를 인쇄 가능한 유니코드에 매핑할 수 있습니다. 그래서 원시 조각의 '안'(바이트 `EC 95 88`)이 `ìķĪ`처럼 보일 수 있지만, 역매핑 후 순서대로 UTF-8 디코드하면 원문이 됩니다. 자주 등장하는 여러 바이트는 하나의 토큰으로 병합될 수 있으므로 멀티바이트 문자라고 해서 토큰 수가 바이트 수만큼 늘어나는 것은 아닙니다.

```js
const decoder = new TextDecoder('utf-8');
const surfaces = rawTokens.map((token) => {
  const bytes = [...token].map((ch) => byteDecoder[ch]);
  return decoder.decode(new Uint8Array(bytes), { stream: true });
});
surfaces[surfaces.length - 1] += decoder.decode();
```

한 UTF-8 문자의 바이트가 여러 토큰에 걸치면 토큰별 독립 디코드는 `�`를 만듭니다. 현재 구현은 토큰 순서를 유지한 스트리밍 디코더를 사용해 완성된 문자를 마지막 바이트 조각에서 표시합니다.

## 같은 뜻인데 토큰 수가 다르다

같은 뜻이라도 언어·문장·토크나이저에 따라 토큰 수가 달라질 수 있습니다. 어느 언어나 모델이 항상 더 효율적이라고 일반화할 수는 없습니다. 매트릭스의 색은 언어 간 절대 등급이 아니라 각 입력 샘플 행 안에서 모델별 토큰 수를 상대 비교한 것입니다.

토큰 수는 비용과 컨텍스트 점유율에 영향을 줍니다. 다만 비용 화면은 선택 artifact가 단독 입력을 인코딩한 최종 Token ID 수(특수 토큰 포함 가능)에 선택 API의 표준 비캐시 입력 단가를 곱한 근사입니다. 컨텍스트 게이지도 같은 단독 인코딩만 반영하며, 시스템 메시지·대화 템플릿·히스토리·도구와 출력/추론 토큰 여유, 캐시·멀티모달 과금, 모델별 토큰화 차이는 실제 API의 토큰 계산기나 사용량·청구 내역으로 확인해야 합니다.

## 직접 해보기

- 공개 토크나이저 artifact 6종(GPT-4o·Qwen3.5 0.8B·Llama 4 Scout·Gemma 3 1B·DeepSeek-V3·BERT multilingual)을 브라우저에서 구동합니다
- 컴포넌트별 토큰 배지, 키보드·마우스 토큰 조각 연동, 효율·컨텍스트 게이지를 제공합니다
- 모델 2열 비교, 입력 샘플 매트릭스, 수록된 OpenAI·Google·Anthropic API 입력 단가 환산을 한 화면에서 봅니다
- 설치 없이 링크로 실행할 수 있고, 코드는 공개 GitHub 저장소에서 확인할 수 있습니다

🔗 데모: https://jtech-co.github.io/Tokenizer-Structure/
💻 코드: https://github.com/JTech-CO/Tokenizer-Structure
