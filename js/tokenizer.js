// tokenizer.js — 실제 토크나이저 엔진 (Transformers.js v3) + 휴리스틱 폴백
// v3.8.1 고정: 이 시뮬레이터가 사용하는 컴포넌트 접근 API와의 호환성을 유지한다.
import { AutoTokenizer, env } from '../vendor/huggingface-transformers-3.8.1.min.js';
import { MODELS } from './artifacts.js';
import { createAnalysisRequest, createAnalysisResult } from './analysisContract.js';
import { displaySurface, displaySurfaces, labelByteContinuations } from './byteDisplay.js';
export { MODELS } from './artifacts.js';
export { byteLevelBytes, byteLevelToText, displaySurface, displaySurfaces, labelByteContinuations } from './byteDisplay.js';

// 원격 전용(브라우저): 로컬 모델 경로 탐색 비활성화 + 브라우저 캐시 사용
env.allowLocalModels = false;
env.useBrowserCache = true;

const _cache = new Map();
const _pending = new Map();
let _analysisSequence = 0;

const TOKENIZER_RUNTIME = Object.freeze({
    name: '@huggingface/transformers',
    version: '3.8.1',
});

const TOKENIZER_ADAPTER = Object.freeze({
    name: 'tokenizer-structure/transformers-v3-adapter',
    version: '1.0.0',
});

function finalizeAnalysisResult(tokenizerResult, text, requestedModelId, fallbackReason = null) {
    const request = createAnalysisRequest({
        requestId: 'analysis-' + (++_analysisSequence),
        modelId: requestedModelId,
        text,
        options: { addSpecialTokens: true },
    });
    const provenance = tokenizerResult.engine === 'real'
        ? {
              adapter: TOKENIZER_ADAPTER,
              runtime: TOKENIZER_RUNTIME,
              artifact: {
                  id: tokenizerResult.modelId,
                  revision: tokenizerResult.revision,
              },
          }
        : undefined;
    const normalizedFallback = tokenizerResult.engine === 'heuristic' && requestedModelId
        ? fallbackReason || {
              code: 'tokenizer-unavailable',
              message: 'The requested tokenizer artifact is not available.',
          }
        : fallbackReason;

    return createAnalysisResult({
        request,
        tokenizerResult,
        provenance,
        fallbackReason: normalizedFallback,
    });
}

// 토크나이저 로드(캐시). onProgress(frac0to1, raw) 콜백 옵션
export async function loadTokenizer(modelId, onProgress) {
    if (_cache.has(modelId)) return _cache.get(modelId);
    if (_pending.has(modelId)) {
        const tok = await _pending.get(modelId);
        if (onProgress) onProgress(1, { status: 'done', progress: 100 });
        return tok;
    }

    const model = MODELS.find((entry) => entry.id === modelId);
    if (!model) throw new Error('Unknown tokenizer artifact: ' + modelId);
    const request = AutoTokenizer.from_pretrained(modelId, {
        revision: model ? model.revision : 'main',
        progress_callback: onProgress
            ? (p) => {
                  const frac = p && typeof p.progress === 'number' ? p.progress / 100 : null;
                  onProgress(frac, p);
              }
            : undefined,
    }).then((tok) => {
        tok.__modelId = modelId;
        tok.__revision = model ? model.revision : 'main';
        _cache.set(modelId, tok);
        return tok;
    });

    _pending.set(modelId, request);
    try {
        return await request;
    } finally {
        _pending.delete(modelId);
    }
}

// byte-level / sentencepiece 마커를 가독성 기호로 치환 (표시용)
export function prettyToken(t) {
    if (t == null) return '';
    return String(t)
        .replace(/Ġ/g, '␣') // 'Ġ' byte-level space
        .replace(/Ċ/g, '⏎') // 'Ċ' byte-level newline
        .replace(/▁/g, '␣'); // '▁' sentencepiece space
}

// 현재 토크나이저가 byte-level 계열인지 (카탈로그 family 기준)
export function isByteLevel(tok) {
    const m = MODELS.find((x) => x.id === (tok && tok.__modelId));
    return !!(m && /byte-level/i.test(m.family));
}

// 특수 토큰 판별 (표시용 점선 테두리 / id 밑줄)
export function isSpecialToken(t) {
    if (t == null) return false;
    const s = String(t);
    return /^(<\|.*\|>|\[(CLS|SEP|PAD|MASK|UNK|BOS|EOS)\]|<\/?s>|<(unk|pad|bos|eos|mask|start_of_turn|end_of_turn)>|<\|endoftext\|>)$/.test(s);
}

// 실제 토크나이저로 4단계 추출
export function tokenizeReal(tok, text) {
    // 1. Normalization (string -> string, normalizer 가 null 일 수 있음)
    let normalized = text;
    if (tok.normalizer) {
        try {
            normalized = tok.normalizer.normalize(text);
        } catch (error) {
            throw new Error('Tokenizer normalization failed', { cause: error });
        }
    }
    if (typeof normalized !== 'string') throw new Error('Tokenizer returned invalid normalized text');

    // 2. Pre-tokenization (string -> string[]; byte-level 은 공백을 'Ġ' 로 매핑)
    let preTokens = [normalized];
    if (tok.pre_tokenizer) {
        try {
            preTokens = tok.pre_tokenizer.pre_tokenize_text(normalized, {});
        } catch (error) {
            throw new Error('Tokenizer pre-tokenization failed', { cause: error });
        }
    }
    if (!Array.isArray(preTokens) || preTokens.some((value) => typeof value !== 'string')) {
        throw new Error('Tokenizer returned invalid pre-tokenization output');
    }

    // 3. Subword model (string[] -> string[] 서브워드 문자열). 주의: ids 가 아닌 문자열 반환
    let subwords;
    try {
        subwords = tok.model(preTokens);
    } catch (error) {
        throw new Error('Tokenizer subword model failed', { cause: error });
    }
    if (!Array.isArray(subwords) || subwords.some((value) => typeof value !== 'string')) {
        throw new Error('Tokenizer returned invalid subword output');
    }

    // 4. Post-processing: 호출 옵션에 따른 최종 ids 와 토큰 문자열
    let ids;
    try {
        ids = tok.encode(text);
    } catch (error) {
        throw new Error('Tokenizer encode failed', { cause: error });
    }
    if (!ids || typeof ids.length !== 'number') throw new Error('Tokenizer returned invalid token IDs');
    const idList = Array.from(ids);
    let finalTokens;
    try {
        finalTokens = Array.from(tok.model.convert_ids_to_tokens(ids));
    } catch (error) {
        const vocab = tok.model && tok.model.vocab;
        if (!vocab) throw new Error('Tokenizer token conversion failed', { cause: error });
        const entries = vocab instanceof Map ? [...vocab.entries()] : Object.entries(vocab);
        const byId = new Map();
        entries.forEach(([key, value]) => {
            if (typeof value === 'number') byId.set(Number(value), String(key));
            else if (typeof value === 'string' && Number.isFinite(Number(key))) byId.set(Number(key), value);
        });
        finalTokens = idList.map((id) => byId.get(Number(id)));
    }
    if (finalTokens.length !== idList.length || finalTokens.some((value) => typeof value !== 'string')) {
        throw new Error('Tokenizer returned invalid final tokens');
    }

    const bl = isByteLevel(tok);
    const rawPreDisplay = displaySurfaces(preTokens, bl);
    const rawFinDisplay = displaySurfaces(finalTokens, bl);
    const rawSubDisplay = displaySurfaces(subwords, bl);
    const preDisplay = labelByteContinuations(preTokens, rawPreDisplay, bl);
    const finDisplay = labelByteContinuations(finalTokens, rawFinDisplay, bl);
    const subDisplay = labelByteContinuations(subwords, rawSubDisplay, bl);
    const pieces = subwords.map((sw, i) => {
        const surface = rawSubDisplay[i];
        const display = subDisplay[i];
        return {
            token: sw,
            surface,
            display,
            continuation: surface === '' && display !== '',
            len: [...surface].length,
        };
    });

    return finalizeAnalysisResult({
        engine: 'real',
        modelId: tok.__modelId,
        revision: tok.__revision,
        normalized,
        preTokens,
        subwords,
        finalTokens,
        ids,
        pieces,
        preDisplay,
        finDisplay,
    }, text, tok.__modelId);
}

// ---- 휴리스틱 폴백 (네트워크/로드 실패 시 앱이 죽지 않도록 유지) ----
function _heuristicId(token) {
    if (token === '<|begin_of_text|>') return 128000;
    if (token === '<|end_of_text|>') return 128001;
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
        hash = ((hash << 5) - hash) + token.charCodeAt(i);
        hash |= 0;
    }
    return (Math.abs(hash) % 99000) + 1000;
}

export function tokenizeHeuristic(text, requestedModelId = null, fallbackReason = null) {
    // 1. Normalization
    const normalized = text.normalize('NFC');

    // 2. Pre-tokenization
    const preTokens = [];
    const words = normalized.split(/(\s+|[^\w\s가-힣]+)/g).filter((v) => v);
    words.forEach((word) => {
        if (word.trim() === '') {
            for (let i = 0; i < word.length; i++) preTokens.push('␣');
        } else {
            preTokens.push(word);
        }
    });

    // 3. Subword Tokenization
    const subwords = [];
    preTokens.forEach((pt) => {
        if (pt === '␣') {
            subwords.push(pt);
            return;
        }
        const w = pt;
        if (w.length > 2 && /[가-힣]/.test(w)) {
            subwords.push(w.slice(0, 2));
            if (w.length > 4) {
                subwords.push(w.slice(2, 4));
                subwords.push(w.slice(4));
            } else {
                subwords.push(w.slice(2));
            }
        } else if (w.length > 4 && /[a-zA-Z]/.test(w)) {
            subwords.push(w.slice(0, 3));
            subwords.push(w.slice(3));
        } else {
            subwords.push(pt);
        }
    });

    // 4. Post-processing
    const finalTokens = ['<|begin_of_text|>', ...subwords, '<|end_of_text|>'];
    const ids = finalTokens.map(_heuristicId);

    const preDisplay = preTokens.map((t) => displaySurface(t, false));
    const finDisplay = finalTokens.map((t) => displaySurface(t, false));
    const pieces = subwords.map((sw) => {
        const s = displaySurface(sw, false);
        return { token: sw, surface: s, display: s, continuation: false, len: [...s].length };
    });

    return finalizeAnalysisResult({
        engine: 'heuristic',
        modelId: null,
        normalized,
        preTokens,
        subwords,
        finalTokens,
        ids,
        pieces,
        preDisplay,
        finDisplay,
    }, text, requestedModelId, fallbackReason);
}

// 토크나이저가 있으면 실제 토큰화, 없으면 휴리스틱 (앱 공용 폴백 래퍼)
export function tokenizeWith(tok, input, requestedModelId = null) {
    if (tok) {
        try {
            return tokenizeReal(tok, input);
        } catch (error) {
            return tokenizeHeuristic(input, tok.__modelId || requestedModelId, {
                code: 'tokenizer-execution-failed',
                message: error instanceof Error ? error.message : 'Tokenizer execution failed.',
            });
        }
    }
    return tokenizeHeuristic(input, requestedModelId, requestedModelId
        ? {
              code: 'tokenizer-not-loaded',
              message: 'The requested tokenizer has not been loaded.',
          }
        : null);
}
