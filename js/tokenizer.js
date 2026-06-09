// tokenizer.js — 실제 토크나이저 엔진 (Transformers.js v3) + 휴리스틱 폴백
// v3 고정 필수: v4는 토크나이저를 WASM으로 봉인해 4단계(normalizer/pre_tokenizer/model/post) 개별 접근 불가
import { AutoTokenizer, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

// 원격 전용(브라우저): 로컬 모델 경로 탐색 비활성화 + 브라우저 캐시 사용
env.allowLocalModels = false;
env.useBrowserCache = true;

// 모델 카탈로그 — 드롭다운에 노출
// in-browser 로드 검증(HF Hub file-list 확인, ungated, tokenizer.json 보유, 2026-06 기준).
// 공식 meta-llama/* · google/gemma* 는 gated라 익명 브라우저 fetch 시 401 → onnx-community/* 미러 사용.
// 토크나이저는 모델보다 느리게 바뀜: o200k_base 는 GPT-4o/o1/o3/GPT-5 가 공유.
// context: 해당 토크나이저가 속한 모델 계열의 대표 컨텍스트 윈도우(토큰). 게이지 표시용 근사값.
export const MODELS = [
    { id: 'Xenova/gpt-4o',                        label: 'GPT-4o · GPT-5 (o200k)', family: 'BPE · byte-level', context: 128000 },
    { id: 'onnx-community/Qwen3-0.6B-ONNX',        label: 'Qwen3',                  family: 'BPE · byte-level', context: 32768 },
    { id: 'onnx-community/Llama-3.2-1B-Instruct',  label: 'Llama 3.2',              family: 'BPE · byte-level', context: 131072 },
    { id: 'onnx-community/gemma-3-1b-it-ONNX',     label: 'Gemma 3',                family: 'SentencePiece',    context: 131072 },
    { id: 'deepseek-ai/DeepSeek-V3',              label: 'DeepSeek-V3',            family: 'BPE · byte-level', context: 131072 },
    { id: 'Xenova/bert-base-multilingual-cased',  label: 'BERT multilingual',      family: 'WordPiece',        context: 512 },
];

const _cache = new Map();

// 토크나이저 로드(캐시). onProgress(frac0to1, raw) 콜백 옵션
export async function loadTokenizer(modelId, onProgress) {
    if (_cache.has(modelId)) return _cache.get(modelId);
    const tok = await AutoTokenizer.from_pretrained(modelId, {
        progress_callback: onProgress
            ? (p) => {
                  const frac = p && typeof p.progress === 'number' ? p.progress / 100 : null;
                  onProgress(frac, p);
              }
            : undefined,
    });
    tok.__modelId = modelId;
    _cache.set(modelId, tok);
    return tok;
}

// byte-level / sentencepiece 마커를 가독성 기호로 치환 (표시용)
export function prettyToken(t) {
    if (t == null) return '';
    return String(t)
        .replace(/Ġ/g, '␣') // 'Ġ' byte-level space
        .replace(/Ċ/g, '⏎') // 'Ċ' byte-level newline
        .replace(/▁/g, '␣'); // '▁' sentencepiece space
}

// ── byte-level(GPT/Llama 등) 토큰을 실제 텍스트로 복원 ──
// byte-level BPE는 UTF-8 바이트를 인쇄 가능한 유니코드로 매핑한다(GPT-2 방식).
// 그 역매핑으로 원래 바이트를 복원한 뒤 UTF-8로 디코드해야 한글/이모지가 제대로 보인다.
let _byteDecoder = null;
function getByteDecoder() {
    if (_byteDecoder) return _byteDecoder;
    const bs = [];
    for (let i = 33; i <= 126; i++) bs.push(i);   // '!'..'~'
    for (let i = 161; i <= 172; i++) bs.push(i);  // '¡'..'¬'
    for (let i = 174; i <= 255; i++) bs.push(i);  // '®'..'ÿ'
    const cs = bs.slice();
    let n = 0;
    for (let b = 0; b < 256; b++) {
        if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
    }
    const dec = {};
    for (let i = 0; i < bs.length; i++) dec[String.fromCharCode(cs[i])] = bs[i];
    _byteDecoder = dec;
    return dec;
}

const _utf8Decoder = new TextDecoder('utf-8', { fatal: false });
const _utf8Encoder = new TextEncoder();

// byte-level 인코딩 문자열 → 원본 텍스트 (불완전 바이트는 U+FFFD '�')
export function byteLevelToText(str) {
    const dec = getByteDecoder();
    const bytes = [];
    for (const ch of String(str)) {
        if (dec[ch] !== undefined) bytes.push(dec[ch]);
        else for (const b of _utf8Encoder.encode(ch)) bytes.push(b); // 미매핑 문자는 그대로 인코드
    }
    return _utf8Decoder.decode(new Uint8Array(bytes));
}

// 현재 토크나이저가 byte-level 계열인지 (카탈로그 family 기준)
export function isByteLevel(tok) {
    const m = MODELS.find((x) => x.id === (tok && tok.__modelId));
    return !!(m && /byte-level/i.test(m.family));
}

// 토큰 raw → 화면 표시 문자열 (byte-level이면 디코드, 공백/개행/탭 가시화)
export function displaySurface(raw, byteLevel) {
    let s = byteLevel ? byteLevelToText(raw) : String(raw);
    s = s
        .replace(/Ġ/g, '␣')
        .replace(/Ċ/g, '⏎')
        .replace(/▁/g, '␣')
        .replace(/ /g, '␣')
        .replace(/\n/g, '⏎')
        .replace(/\t/g, '⇥');
    return s;
}

// 특수 토큰 판별 (표시용 점선 테두리 / id 밑줄)
export function isSpecialToken(t) {
    if (t == null) return false;
    const s = String(t);
    return /^(<\|.*\|>|\[(CLS|SEP|PAD|MASK|UNK|BOS|EOS)\]|<\/?s>|<unk>|<pad>|<\|endoftext\|>)$/.test(s);
}

// 실제 토크나이저로 4단계 추출
export function tokenizeReal(tok, text) {
    // 1. Normalization (string -> string, normalizer 가 null 일 수 있음)
    let normalized;
    try {
        normalized = tok.normalizer ? tok.normalizer.normalize(text) : text;
    } catch {
        normalized = text;
    }
    if (normalized == null) normalized = text;

    // 2. Pre-tokenization (string -> string[]; byte-level 은 공백을 'Ġ' 로 매핑)
    let preTokens;
    try {
        preTokens = tok.pre_tokenizer ? tok.pre_tokenizer.pre_tokenize_text(normalized, {}) : [normalized];
    } catch {
        preTokens = [normalized];
    }

    // 3. Subword model (string[] -> string[] 서브워드 문자열). 주의: ids 가 아닌 문자열 반환
    let subwords;
    try {
        subwords = tok.model(preTokens);
    } catch {
        subwords = preTokens.slice();
    }

    // 4. Post-processing: 특수 토큰 포함 최종 ids 와 토큰 문자열
    let ids;
    try {
        ids = tok.encode(text);
    } catch {
        ids = [];
    }
    let finalTokens;
    try {
        finalTokens = tok.model.convert_ids_to_tokens(ids);
    } catch {
        finalTokens = ids.map((id) => (tok.model && tok.model.vocab ? tok.model.vocab[id] : String(id)));
    }

    const bl = isByteLevel(tok);
    const preDisplay = preTokens.map((t) => displaySurface(t, bl));
    const finDisplay = finalTokens.map((t) => displaySurface(t, bl));
    const pieces = subwords.map((sw) => {
        const s = displaySurface(sw, bl);
        return { token: sw, surface: s, len: [...s].length };
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
        return { token: sw, surface: s, len: [...s].length };
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
