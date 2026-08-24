// state.js — 모듈 간 공유 상태 (객체 참조로 live 공유)
import { MODELS } from './tokenizer.js';
import { DEFAULT_ANALYSIS_OPTIONS } from './analysisOptions.js';

export const state = {
    lang: 'ko',                            // 현재 UI 언어 (ko | en)
    currentTok: null,                      // 파이프라인 뷰의 로드된 토크나이저
    currentModelId: MODELS[0].id,          // 파이프라인 뷰 모델
    loading: false,                        // 파이프라인 토크나이저 로딩 플래그
    heatmapOn: false,                      // 서브워드 히트맵 모드
    animOn: false,                         // 단계 순차 애니메이션
    costModelId: 'gpt-4o',                 // footer 비용 추정 대상 모델(기본 토크나이저와 동일 계열)
    lastResult: null,                      // 마지막 토크나이즈 결과(부분 재렌더용)
    currentView: 'pipeline',               // pipeline | compare | matrix | inspector | learn | request | benchmark
    analysisOptions: { ...DEFAULT_ANALYSIS_OPTIONS }, // P1 canonical tokenizer options
    inspectorLens: 'nfd',                  // Unicode A/B lens
    learnLessonId: 'token-not-word',       // active five-minute path
    explanationLevel: 'beginner',          // beginner | technical
    cmpModelA: 'Xenova/gpt-4o',            // 비교 뷰 좌측 모델
    cmpModelB: 'onnx-community/gemma-3-1b-it-ONNX', // 비교 뷰 우측 모델
    cmpTokA: null,
    cmpTokB: null,
    cmpLoadingA: false,
    cmpLoadingB: false,
    matrixBuilt: false,                    // 매트릭스 1회 계산 캐시
    costSortMode: 'provider',              // 비용 모달 정렬: provider | asc | desc
    lastCostTokens: 0,                     // 비용 모달 기준 토큰 수

    // P2 Request Token Lab
    requestSpec: {
        messages: [
            { role: 'system', content: 'You are a terse assistant. Answer in one sentence.' },
            { role: 'user', content: '토크나이저가 뭐야?' },
            { role: 'assistant', content: '문장을 모델이 다루는 토큰 조각으로 나누는 구성요소입니다.' },
            { role: 'user', content: '서울 날씨 알려줘.' },
        ],
        tools: [{
            type: 'function',
            function: {
                name: 'get_weather',
                description: 'Return the current weather for a city.',
                parameters: {
                    type: 'object',
                    properties: { city: { type: 'string', description: 'City name' } },
                    required: ['city'],
                },
            },
        }],
        documents: [],
        addGenerationPrompt: true,
    },
    requestCostModelId: 'gpt-4o',          // 비용 시나리오 단가 모델
    requestCallsPerDay: 100,               // 일간 호출 수 시나리오
    requestReservedOutput: 1024,           // 출력 여유(비용의 출력 토큰과 공유)
    requestReservedReasoning: 0,           // 추론 여유

    // P3 말뭉치 비교와 발표 모드
    benchmarkCorpusId: 'language-mix',     // 내장 말뭉치 id 또는 'user'
    benchmarkMetric: 'tokens',             // tokens | codePointsPerToken | bytesPerToken | contextShare
    benchmarkLanguages: null,              // null이면 전체
    benchmarkDomains: null,                // null이면 전체
    benchmarkColumns: ['Xenova/gpt-4o', 'onnx-community/gemma-3-1b-it-ONNX'],
    presentationOn: false,                 // 발표 모드
    presentationReveal: { total: 0, revealed: 0 },
};
