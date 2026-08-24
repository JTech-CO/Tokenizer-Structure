// tokenizer.js — 실제 토크나이저 엔진 (Transformers.js v3) + 휴리스틱 폴백
// v3.8.1 고정: 이 시뮬레이터가 사용하는 컴포넌트 접근 API와의 호환성을 유지한다.
import { AutoTokenizer, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
import { displaySurface, displaySurfaces, labelByteContinuations } from './byteDisplay.js';
export { byteLevelBytes, byteLevelToText, displaySurface, displaySurfaces, labelByteContinuations } from './byteDisplay.js';

// 원격 전용(브라우저): 로컬 모델 경로 탐색 비활성화 + 브라우저 캐시 사용
env.allowLocalModels = false;
env.useBrowserCache = true;

// 모델 카탈로그 — 드롭다운에 노출
// in-browser 로드 검증(HF Hub file-list 확인, ungated, tokenizer.json 보유, 2026-08-24 기준).
// 공식 meta-llama/* · google/gemma* 는 gated라 익명 브라우저 fetch 시 401 → onnx-community/*(또는 Xenova/*) 미러 사용.
// Qwen3.5: v3.8.1에서 base tokenizer 클래스로 호환 로드되는 공개 ONNX 미러 사용.
// Llama 4: gated meta-llama/* 대신 Xenova/llama4-tokenizer(토크나이저 전용, ungated) 사용.
// 최신 모델명만으로 토크나이저 공유를 추정하지 않으며, 익명 브라우저에서 검증된 artifact만 목록에 포함한다.
// context: 선택한 공개 artifact가 대표하는 구체 모델의 컨텍스트 윈도우(토큰).
export const MODELS = [
    {
        id: 'Xenova/gpt-4o',
        revision: '7956d98f2a83b2751a98ea7136fdf7fe6cf54e69',
        label: 'GPT-4o (o200k)', family: 'BPE · byte-level', context: 128_000,
    },
    {
        id: 'onnx-community/Qwen3.5-0.8B-ONNX',
        revision: 'c0d619322dad7c4441a8841a53fc59772ddddcc0',
        label: 'Qwen3.5 0.8B', family: 'BPE · byte-level', context: 262_144,
    },
    {
        id: 'Xenova/llama4-tokenizer',
        revision: '2cac0ef8980927774181b5fdc77d539b25cde31f',
        label: 'Llama 4 Scout tokenizer', family: 'BPE · byte-level', context: 10_000_000,
    },
    {
        id: 'onnx-community/gemma-3-1b-it-ONNX',
        revision: 'a58439f40017d3b99c7d378ff525e54e0ba08ebf',
        label: 'Gemma 3 1B', family: 'SentencePiece', context: 32_768,
    },
    {
        id: 'deepseek-ai/DeepSeek-V3',
        revision: 'e815299b0bcbac849fa540c768ef21845365c9eb',
        label: 'DeepSeek-V3', family: 'BPE · byte-level', context: 131_072,
    },
    {
        id: 'Xenova/bert-base-multilingual-cased',
        revision: '17016e764a76e30ed904bc251df4510f27b7f23f',
        label: 'BERT multilingual', family: 'WordPiece', context: 512,
    },
];

const _cache = new Map();
const _pending = new Map();

// 토크나이저 로드(캐시). onProgress(frac0to1, raw) 콜백 옵션
export async function loadTokenizer(modelId, onProgress) {
    if (_cache.has(modelId)) return _cache.get(modelId);
    if (_pending.has(modelId)) {
        const tok = await _pending.get(modelId);
        if (onProgress) onProgress(1, { status: 'done', progress: 100 });
        return tok;
    }

    const model = MODELS.find((entry) => entry.id === modelId);
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

    return { engine: 'real', modelId: tok.__modelId, normalized, preTokens, subwords, finalTokens, ids, pieces, preDisplay, finDisplay };
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

export function tokenizeHeuristic(text) {
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

    return { engine: 'heuristic', modelId: null, normalized, preTokens, subwords, finalTokens, ids, pieces, preDisplay, finDisplay };
}

// 토크나이저가 있으면 실제 토큰화, 없으면 휴리스틱 (앱 공용 폴백 래퍼)
export function tokenizeWith(tok, input) {
    if (tok) {
        try {
            return tokenizeReal(tok, input);
        } catch (e) {
            return tokenizeHeuristic(input);
        }
    }
    return tokenizeHeuristic(input);
}
