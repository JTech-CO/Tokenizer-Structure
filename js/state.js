// state.js — 모듈 간 공유 상태 (객체 참조로 live 공유)
import { MODELS } from './tokenizer.js';

export const state = {
    lang: 'ko',                            // 현재 UI 언어 (ko | en)
    currentTok: null,                      // 파이프라인 뷰의 로드된 토크나이저
    currentModelId: MODELS[0].id,          // 파이프라인 뷰 모델
    loading: false,                        // 파이프라인 토크나이저 로딩 플래그
    heatmapOn: false,                      // 서브워드 히트맵 모드
    animOn: false,                         // 단계 순차 애니메이션
    costModelId: 'claude-opus-4-8',        // footer 비용 환산 대상 모델
    lastResult: null,                      // 마지막 토크나이즈 결과(부분 재렌더용)
    currentView: 'pipeline',               // pipeline | compare | matrix
    cmpModelA: 'Xenova/gpt-4o',            // 비교 뷰 좌측 모델
    cmpModelB: 'onnx-community/gemma-3-1b-it-ONNX', // 비교 뷰 우측 모델
    cmpTokA: null,
    cmpTokB: null,
    matrixBuilt: false,                    // 매트릭스 1회 계산 캐시
    costSortMode: 'provider',              // 비용 모달 정렬: provider | asc | desc
    lastCostTokens: 0,                     // 비용 모달 기준 토큰 수
};
