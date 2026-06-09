# LLM Tokenizer Structure

> **LLM 토크나이저의 4단계 작동 과정을 실제 엔진으로 즉석 시연·브리핑하는 웹 시뮬레이터**

[![Live Pade](https://img.shields.io/badge/Live_Demo-jtech--co.github.io-217346?style=flat-square&logo=github)](https://jtech-co.github.io/Tokenizer-Structure)
[![License: MIT](https://img.shields.io/badge/License-MIT_(code)-blue?style=flat-square)](LICENSE)

### 🌐 바로 사용하기 → **<https://jtech-co.github.io/Tokenizer-Structure/>**

<img src="https://i.imgur.com/EUoPlXq.png" width="100%">

## 1. 소개 (Introduction)

이 프로젝트는 LLM 토크나이저가 텍스트를 토큰으로 변환하는 과정을 교육·발표용으로 시각화하기 위해 개발된 웹 애플리케이션입니다.
실제 토크나이저 엔진(Transformers.js)을 브라우저에서 직접 구동해 **정규화 → 사전토큰화 → 서브워드 → 후처리** 4단계와 Token ID를 단계별로 보여주고, 모델·언어별 토큰 효율과 API 비용까지 정량 비교합니다.

**주요 기능**
- **4단계 파이프라인 시각화**: 정규화·사전토큰화·서브워드(BPE/WordPiece)·후처리를 토큰 배지로 표시, 단계 순차 애니메이션 지원
- **실제 6개 토크나이저**: GPT-4o(o200k)·Qwen3·Llama 3.2·Gemma 3·DeepSeek-V3·BERT — byte-level 토큰을 실제 글자로 디코딩, 로드 실패 시 휴리스틱 폴백
- **분석 지표**: 토큰 효율(압축률·바이트당), 컨텍스트 윈도우 게이지, 토큰당 글자수 히트맵
- **모델 2열 비교 · 언어 효율 매트릭스 · 전 모델 API 비용 일괄표**(3사 22개 모델, 제공사 색·정렬)
- **token↔원문 hover 매핑**, 입력 프리셋, 한/영 다국어 토글

## 2. 기술 스택 (Tech Stack)

- **Frontend**: Vanilla JavaScript (ES Modules), HTML5
- **Styling**: Tailwind CSS (CDN) + 커스텀 CSS (역할별 분할)
- **Tokenizer Engine**: Transformers.js v3.8.1 (`@huggingface/transformers`, 브라우저 WASM)
- **Data**: 정적 JS 모듈 — 토크나이저 모델 카탈로그 / LLM API 가격(기준 2026-06-08)
- **Deployment**: GitHub Pages (정적 호스팅, 빌드 불필요)

## 3. 설치 및 실행 (Quick Start)

**요구 사항**: 로컬 정적 서버 (Python 3 또는 Node.js 등).
ES Modules·CDN을 사용하므로 `file://`로 직접 열 수 없고, http(s) 서버가 필요합니다.

1. **클론 (Clone)**
   ```bash
   git clone [레포지토리 URL]
   cd tokenizer-structure
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
│   ├── tokenizer.js    # 엔진: Transformers.js 로드 · 4단계 추출 · 휴리스틱 폴백
│   ├── pricing.js      # LLM API 가격 데이터 · 비용 계산
│   ├── i18n.js         # 다국어(ko/en) UI 텍스트
│   ├── state.js        # 모듈 간 공유 상태
│   ├── dom.js          # DOM 유틸 · 토큰 배지/색상
│   ├── pipeline.js     # 파이프라인 뷰 렌더 · 분석 지표
│   ├── compare.js      # 모델 2열 비교 뷰
│   ├── matrix.js       # 언어 효율 매트릭스 뷰
│   ├── costModal.js    # 전 모델 비용 일괄표 모달
│   ├── presets.js      # 입력 프리셋 버튼
│   ├── hover.js        # token↔원문 양방향 하이라이트
│   └── main.js         # 진입점 · 뷰 전환 · 이벤트 바인딩
├── serve.bat                     # Windows 로컬 서버 실행 스크립트
└── .nojekyll                     # GitHub Pages Jekyll 처리 우회
```

## 5. 정보 (Info)

- **License**: MIT
- **Contact**: GitHub Issues
