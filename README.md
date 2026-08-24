# LLM Tokenizer Structure

> **Hugging Face Tokenizers의 파이프라인 컴포넌트를 실제 공개 tokenizer artifact로 시연하는 웹 시뮬레이터**

[![Live Page](https://img.shields.io/badge/Live_Demo-jtech--co.github.io-217346?style=flat-square&logo=github)](https://jtech-co.github.io/Tokenizer-Structure)

### 🌐 바로 사용하기 → **<https://jtech-co.github.io/Tokenizer-Structure/>**

<img src="https://i.imgur.com/EUoPlXq.png" width="100%">

## 1. 소개 (Introduction)

이 프로젝트는 LLM 토크나이저가 텍스트를 토큰으로 변환하는 과정을 교육·발표용으로 시각화하기 위해 개발된 웹 애플리케이션입니다.
Transformers.js를 브라우저에서 직접 구동해 **정규화 → 사전토큰화 → 토큰 모델 → 후처리** 컴포넌트와 Token ID를 보여줍니다. 각 컴포넌트는 모델 설정에 따라 생략되거나 다른 규칙을 사용할 수 있습니다.

**주요 기능**
- **파이프라인 시각화**: 정규화·사전토큰화·BPE/WordPiece/Unigram 모델·후처리를 토큰 배지로 표시
- **검증된 6개 공개 artifact**: GPT-4o(o200k)·Qwen3.5 0.8B·Llama 4 Scout tokenizer·Gemma 3 1B·DeepSeek-V3·BERT multilingual
- **분석 지표**: 코드 포인트/토큰·바이트/토큰, 구체 모델별 컨텍스트 게이지, 토큰 히트맵
- **모델 2열 비교 · 입력 샘플 매트릭스 · 수록 3사 모델 단가 환산**(제공사 색·정렬)
- **토큰 조각 연동 보기**, 입력 프리셋, 한/영 전환, 반응형·키보드 접근성

## 2. 기술 스택 (Tech Stack)

- **Frontend**: Vanilla JavaScript (ES Modules), HTML5
- **Styling**: Tailwind CSS (CDN) + 커스텀 CSS (역할별 분할)
- **Tokenizer Engine**: Transformers.js v3.8.1 (`@huggingface/transformers`, 내부 파이프라인 컴포넌트 접근 호환성 때문에 고정)
- **Data**: 정적 JS 모듈 — 공개 토크나이저 artifact / LLM API 표준 단가(기준 2026-08-24)
- **Deployment**: GitHub Pages (정적 호스팅, 빌드 불필요)

### 정확도와 데이터 기준

- 토크나이저 목록은 2026-08-24에 익명 브라우저 로드가 확인된 공개 Hugging Face artifact만 포함합니다. 각 artifact는 확인 당시 commit SHA로 고정되어 재현 가능하며, 최신 모델명만으로 vocab·merge·특수 토큰 공유를 추정하지 않습니다.
- 현재 레이아웃은 Tailwind Play CDN에 의존합니다. CDN 차단·장애와 공급망 위험을 줄이는 로컬 생성 CSS·CSP 전환은 ROADMAP의 공통 기술 부채로 명시했습니다.
- 가격은 [OpenAI 모델 문서](https://developers.openai.com/api/docs/models), [Gemini API 가격](https://ai.google.dev/gemini-api/docs/pricing), [Claude API 가격](https://platform.claude.com/docs/en/about-claude/pricing)의 표준 비캐시 텍스트 단가를 기준으로 합니다.
- 비용 화면은 **선택 artifact가 단독 입력을 인코딩한 최종 Token ID 수(특수 토큰 포함 가능) × 선택 API의 표준 비캐시 입력 단가**인 참고값입니다.
- 컨텍스트 게이지도 같은 단독 인코딩만 반영하며 시스템·히스토리·도구와 출력/추론 토큰 여유는 포함하지 않습니다. 실제 청구와 모델별 계산은 각 API의 토큰 계산기·사용량·청구 내역으로 확인하세요.
- 원격 로드 실패 시 표시되는 휴리스틱 폴백의 Token ID와 분할은 교육용 가상 결과이며 모델 비교·청구 검증값이 아닙니다.
- 후속 기능은 [ROADMAP.md](ROADMAP.md)에 기획만 정리되어 있습니다.


## 3. 설치 및 실행 (Quick Start)

**요구 사항**: 로컬 정적 서버 (Python 3 또는 Node.js 등).
ES Modules·CDN을 사용하므로 `file://`로 직접 열 수 없고, http(s) 서버가 필요합니다.

1. **클론 (Clone)**
   ```bash
   git clone https://github.com/JTech-CO/Tokenizer-Structure.git
   cd Tokenizer-Structure
   ```

2. **환경 변수 (Environment)**
   별도 설정이 필요 없습니다. API 키 불필요 — 토크나이저 파일은 사용자 브라우저가 HuggingFace Hub에서 직접(공개) 내려받습니다.

3. **실행 (Run)**
   ```bash
   # Python 3
   python -m http.server 8000
   ```
   - Windows는 `serve.bat` 더블클릭으로도 실행됩니다.
   - 브라우저에서 `http://localhost:8000/` 접속 (루트 → 메인 화면으로 자동 이동).

4. **회귀 테스트 (Test)**
   ```bash
   npm test
   ```
   외부 패키지 설치 없이 Node.js 기본 테스트 러너로 실행됩니다.

> **배포 (GitHub Pages)**: 저장소에 그대로 push → Settings → Pages → Source를 `main` / `(root)`로 지정하면 `https://<user>.github.io/<repo>/`에서 동작합니다. 빌드 단계가 없습니다.

## 4. 폴더 구조 (Structure)

```text
tokenizer-structure/
├── index.html                    # 루트 진입점 → 메인으로 redirect (GitHub Pages용)
├── llm_tokenizer_simulator.html  # 메인 UI 마크업
├── css/
│   ├── base.css        # 레이아웃 · 스크롤바 · 토큰 배지 · 스텝 카드
│   ├── controls.css    # 드롭다운 · 엔진 상태 · 토글 · 뷰 탭 · 버튼
│   ├── analysis.css    # 효율 · 비용 · 컨텍스트 게이지 패널
│   └── views.css       # 매트릭스 · 모달 · 단계 애니메이션 · 매핑
├── js/
│   ├── tokenizer.js    # 엔진: Transformers.js 로드 · 컴포넌트 추출 · 휴리스틱 폴백
│   ├── byteDisplay.js  # byte-level 토큰 스트리밍 디코드 · 화면 표시
│   ├── pricing.js      # LLM API 가격 데이터 · 비용 계산
│   ├── i18n.js         # 다국어(ko/en) UI 텍스트
│   ├── state.js        # 모듈 간 공유 상태
│   ├── dom.js          # DOM 유틸 · 토큰 배지/색상
│   ├── pipeline.js     # 파이프라인 뷰 렌더 · 분석 지표
│   ├── compare.js      # 모델 2열 비교 뷰
│   ├── matrix.js        # 입력 샘플별 토큰 매트릭스
│   ├── costModal.js     # 수록 모델 단가 환산 모달
│   ├── latestRequest.js # 비동기 최신 요청 가드
│   ├── presets.js       # 입력 프리셋 버튼
│   ├── hover.js         # 같은 토큰 조각 간 하이라이트
│   └── main.js          # 진입점 · 뷰 전환 · 이벤트 바인딩
├── tests/
│   ├── core.test.js              # 가격 티어 · 최신 요청 · UTF-8 회귀 테스트
│   └── static.test.js            # JS 문법 · HTML 자산/ID 정합성 검사
├── package.json                  # Node.js 테스트 명령
├── ROADMAP.md                    # 기능 다양화 기획(구현 전)
├── serve.bat                     # Windows 로컬 서버 실행 스크립트
└── .nojekyll                     # GitHub Pages Jekyll 처리 우회
```

## 5. 정보 (Info)

- **Contact**: GitHub Issues
