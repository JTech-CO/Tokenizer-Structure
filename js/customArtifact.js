// customArtifact.js — P4 로컬 tokenizer 업로드 검증(순수).
// remote code를 실행하지 않고 리소스 상한을 지키는지 확인한 뒤에만 세션 한정으로 사용한다.

export const CUSTOM_ARTIFACT_SCHEMA_VERSION = 1;

export const CUSTOM_ARTIFACT_LIMITS = Object.freeze({
    maxFiles: 3,
    maxFileBytes: 32 * 1024 * 1024,
    maxTotalBytes: 48 * 1024 * 1024,
    maxComponentDepth: 16,
    maxComponentNodes: 20_000,
    maxAddedTokens: 8_192,
    maxVocabEntries: 1_000_000,
    maxMerges: 1_000_000,
});

export const CUSTOM_ARTIFACT_FILES = Object.freeze({
    required: Object.freeze(['tokenizer.json']),
    optional: Object.freeze(['tokenizer_config.json', 'special_tokens_map.json']),
});

// huggingface/tokenizers 사양의 component 이름만 허용한다. 목록에 없는 이름은
// 이 앱이 동작을 확인하지 못한 것이므로 통과시키지 않는다.
export const ALLOWED_COMPONENTS = Object.freeze({
    model: Object.freeze(['BPE', 'WordPiece', 'Unigram', 'WordLevel']),
    normalizer: Object.freeze([
        'BertNormalizer', 'ByteLevel', 'Lowercase', 'NFC', 'NFD', 'NFKC', 'NFKD', 'Nmt',
        'Precompiled', 'Prepend', 'Replace', 'Sequence', 'Strip', 'StripAccents',
    ]),
    pre_tokenizer: Object.freeze([
        'BertPreTokenizer', 'ByteLevel', 'CharDelimiterSplit', 'Digits', 'FixedLength', 'Metaspace',
        'Punctuation', 'Sequence', 'Split', 'UnicodeScripts', 'Whitespace', 'WhitespaceSplit',
    ]),
    post_processor: Object.freeze([
        'BertProcessing', 'ByteLevel', 'RobertaProcessing', 'Sequence', 'TemplateProcessing',
    ]),
    decoder: Object.freeze([
        'BPEDecoder', 'ByteFallback', 'ByteLevel', 'CTC', 'Fuse', 'Metaspace',
        'Replace', 'Sequence', 'Strip', 'WordPiece',
    ]),
});

// 원격 모듈을 불러오게 하는 필드는 값과 무관하게 거부한다.
export const REMOTE_CODE_KEYS = Object.freeze(['auto_map', 'trust_remote_code', 'custom_object', 'code_revision']);

export const CUSTOM_ARTIFACT_REJECTIONS = Object.freeze({
    UNKNOWN_FILE: 'unknown-file',
    MISSING_REQUIRED_FILE: 'missing-required-file',
    DUPLICATE_FILE: 'duplicate-file',
    TOO_MANY_FILES: 'too-many-files',
    FILE_TOO_LARGE: 'file-too-large',
    TOTAL_TOO_LARGE: 'total-too-large',
    INVALID_JSON: 'invalid-json',
    REMOTE_CODE: 'remote-code',
    UNSUPPORTED_COMPONENT: 'unsupported-component',
    COMPONENT_TOO_DEEP: 'component-too-deep',
    COMPONENT_TOO_LARGE: 'component-too-large',
    MISSING_MODEL: 'missing-model',
    TOO_MANY_ADDED_TOKENS: 'too-many-added-tokens',
    VOCAB_TOO_LARGE: 'vocab-too-large',
    SMOKE_TEST_FAILED: 'smoke-test-failed',
});

const CLASS_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const ALL_FILE_NAMES = new Set([...CUSTOM_ARTIFACT_FILES.required, ...CUSTOM_ARTIFACT_FILES.optional]);

function reject(code, detail) {
    return { ok: false, code, detail };
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function utf8Bytes(text) {
    return new TextEncoder().encode(text).length;
}

/**
 * 파일 이름·개수·크기를 먼저 확인한다. 여기서 걸러야 큰 JSON을 파싱하지 않는다.
 */
export function validateCustomArtifactFiles(files) {
    if (!Array.isArray(files)) return reject(CUSTOM_ARTIFACT_REJECTIONS.UNKNOWN_FILE, 'expected an array of files');
    if (files.length > CUSTOM_ARTIFACT_LIMITS.maxFiles) {
        return reject(CUSTOM_ARTIFACT_REJECTIONS.TOO_MANY_FILES, `at most ${CUSTOM_ARTIFACT_LIMITS.maxFiles} files`);
    }

    const seen = new Set();
    let total = 0;
    const normalized = [];
    for (const file of files) {
        if (!isPlainObject(file) || typeof file.name !== 'string' || typeof file.text !== 'string') {
            return reject(CUSTOM_ARTIFACT_REJECTIONS.UNKNOWN_FILE, 'each file needs a name and text');
        }
        if (!ALL_FILE_NAMES.has(file.name)) {
            return reject(CUSTOM_ARTIFACT_REJECTIONS.UNKNOWN_FILE, file.name);
        }
        if (seen.has(file.name)) return reject(CUSTOM_ARTIFACT_REJECTIONS.DUPLICATE_FILE, file.name);
        seen.add(file.name);

        const bytes = utf8Bytes(file.text);
        if (bytes > CUSTOM_ARTIFACT_LIMITS.maxFileBytes) {
            return reject(CUSTOM_ARTIFACT_REJECTIONS.FILE_TOO_LARGE, file.name);
        }
        total += bytes;
        normalized.push({ name: file.name, text: file.text, bytes });
    }
    if (total > CUSTOM_ARTIFACT_LIMITS.maxTotalBytes) {
        return reject(CUSTOM_ARTIFACT_REJECTIONS.TOTAL_TOO_LARGE, String(total));
    }
    for (const name of CUSTOM_ARTIFACT_FILES.required) {
        if (!seen.has(name)) return reject(CUSTOM_ARTIFACT_REJECTIONS.MISSING_REQUIRED_FILE, name);
    }
    return { ok: true, files: normalized, totalBytes: total };
}

/**
 * 원격 코드 로딩 흔적을 raw 텍스트와 파싱 결과 양쪽에서 찾는다.
 * 큰 vocab을 전부 걷지 않고도 확인할 수 있도록 문자열 검색을 함께 쓴다.
 */
export function findRemoteCodeMarkers(rawText, parsed) {
    const markers = [];
    for (const key of REMOTE_CODE_KEYS) {
        if (typeof rawText === 'string' && rawText.includes(`"${key}"`)) markers.push(key);
    }
    if (isPlainObject(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
            if (REMOTE_CODE_KEYS.includes(key)) {
                if (!markers.includes(key)) markers.push(key);
                continue;
            }
            // `owner/repo--Module.Class` 처럼 모듈 경로를 가리키는 클래스 이름을 막는다.
            if (key.endsWith('_class') && typeof value === 'string' && !CLASS_NAME_PATTERN.test(value)) {
                markers.push(`${key}:${value.slice(0, 60)}`);
            }
        }
    }
    return markers;
}

function walkComponent(value, path, state) {
    state.nodes += 1;
    if (state.nodes > CUSTOM_ARTIFACT_LIMITS.maxComponentNodes) {
        throw Object.assign(new Error(path), { code: CUSTOM_ARTIFACT_REJECTIONS.COMPONENT_TOO_LARGE });
    }
    if (state.depth > CUSTOM_ARTIFACT_LIMITS.maxComponentDepth) {
        throw Object.assign(new Error(path), { code: CUSTOM_ARTIFACT_REJECTIONS.COMPONENT_TOO_DEEP });
    }
    if (Array.isArray(value)) {
        state.depth += 1;
        for (const [index, item] of value.entries()) walkComponent(item, `${path}[${index}]`, state);
        state.depth -= 1;
        return;
    }
    if (!isPlainObject(value)) return;

    if (typeof value.type === 'string' && state.allowed && !state.allowed.includes(value.type)) {
        throw Object.assign(new Error(`${path}.type=${value.type}`), {
            code: CUSTOM_ARTIFACT_REJECTIONS.UNSUPPORTED_COMPONENT,
        });
    }
    state.depth += 1;
    for (const [key, child] of Object.entries(value)) {
        if (REMOTE_CODE_KEYS.includes(key)) {
            throw Object.assign(new Error(`${path}.${key}`), { code: CUSTOM_ARTIFACT_REJECTIONS.REMOTE_CODE });
        }
        walkComponent(child, `${path}.${key}`, state);
    }
    state.depth -= 1;
}

/**
 * tokenizer.json을 검증한다. 큰 vocab/merges는 개수만 확인하고 깊이 탐색하지 않는다.
 */
export function validateTokenizerJson(json, rawText = null) {
    if (!isPlainObject(json)) return reject(CUSTOM_ARTIFACT_REJECTIONS.INVALID_JSON, 'tokenizer.json');

    const markers = findRemoteCodeMarkers(rawText, json);
    if (markers.length > 0) return reject(CUSTOM_ARTIFACT_REJECTIONS.REMOTE_CODE, markers.join(', '));

    if (!isPlainObject(json.model) || typeof json.model.type !== 'string') {
        return reject(CUSTOM_ARTIFACT_REJECTIONS.MISSING_MODEL, 'model.type');
    }
    if (!ALLOWED_COMPONENTS.model.includes(json.model.type)) {
        return reject(CUSTOM_ARTIFACT_REJECTIONS.UNSUPPORTED_COMPONENT, `model.type=${json.model.type}`);
    }

    const vocabSize = isPlainObject(json.model.vocab)
        ? Object.keys(json.model.vocab).length
        : (Array.isArray(json.model.vocab) ? json.model.vocab.length : 0);
    if (vocabSize > CUSTOM_ARTIFACT_LIMITS.maxVocabEntries) {
        return reject(CUSTOM_ARTIFACT_REJECTIONS.VOCAB_TOO_LARGE, `vocab=${vocabSize}`);
    }
    if (Array.isArray(json.model.merges) && json.model.merges.length > CUSTOM_ARTIFACT_LIMITS.maxMerges) {
        return reject(CUSTOM_ARTIFACT_REJECTIONS.VOCAB_TOO_LARGE, `merges=${json.model.merges.length}`);
    }
    if (Array.isArray(json.added_tokens) && json.added_tokens.length > CUSTOM_ARTIFACT_LIMITS.maxAddedTokens) {
        return reject(CUSTOM_ARTIFACT_REJECTIONS.TOO_MANY_ADDED_TOKENS, String(json.added_tokens.length));
    }

    for (const [key, allowed] of Object.entries(ALLOWED_COMPONENTS)) {
        if (key === 'model') continue;
        const component = json[key];
        if (component === null || component === undefined) continue;
        try {
            walkComponent(component, key, { depth: 0, nodes: 0, allowed });
        } catch (error) {
            return reject(error.code || CUSTOM_ARTIFACT_REJECTIONS.UNSUPPORTED_COMPONENT, error.message);
        }
    }

    return {
        ok: true,
        summary: {
            modelType: json.model.type,
            vocabSize,
            merges: Array.isArray(json.model.merges) ? json.model.merges.length : 0,
            addedTokens: Array.isArray(json.added_tokens) ? json.added_tokens.length : 0,
            components: Object.fromEntries(
                Object.keys(ALLOWED_COMPONENTS)
                    .filter((key) => key !== 'model')
                    .map((key) => [key, isPlainObject(json[key]) ? json[key].type ?? 'Sequence' : null]),
            ),
        },
    };
}

export function validateTokenizerConfig(config, rawText = null) {
    if (config === null || config === undefined) return { ok: true, summary: { tokenizerClass: null } };
    if (!isPlainObject(config)) return reject(CUSTOM_ARTIFACT_REJECTIONS.INVALID_JSON, 'tokenizer_config.json');

    const markers = findRemoteCodeMarkers(rawText, config);
    if (markers.length > 0) return reject(CUSTOM_ARTIFACT_REJECTIONS.REMOTE_CODE, markers.join(', '));

    const tokenizerClass = typeof config.tokenizer_class === 'string' ? config.tokenizer_class : null;
    if (tokenizerClass !== null && !CLASS_NAME_PATTERN.test(tokenizerClass)) {
        return reject(CUSTOM_ARTIFACT_REJECTIONS.REMOTE_CODE, `tokenizer_class=${tokenizerClass.slice(0, 60)}`);
    }
    return {
        ok: true,
        summary: {
            tokenizerClass,
            hasChatTemplate: typeof config.chat_template === 'string' && config.chat_template.length > 0,
        },
    };
}

export function parseCustomArtifact(files) {
    const fileCheck = validateCustomArtifactFiles(files);
    if (!fileCheck.ok) return fileCheck;

    const byName = Object.fromEntries(fileCheck.files.map((file) => [file.name, file]));
    let tokenizerJson;
    try {
        tokenizerJson = JSON.parse(byName['tokenizer.json'].text);
    } catch (error) {
        return reject(CUSTOM_ARTIFACT_REJECTIONS.INVALID_JSON, `tokenizer.json: ${error.message}`);
    }
    const jsonCheck = validateTokenizerJson(tokenizerJson, byName['tokenizer.json'].text);
    if (!jsonCheck.ok) return jsonCheck;

    let tokenizerConfig = null;
    if (byName['tokenizer_config.json']) {
        try {
            tokenizerConfig = JSON.parse(byName['tokenizer_config.json'].text);
        } catch (error) {
            return reject(CUSTOM_ARTIFACT_REJECTIONS.INVALID_JSON, `tokenizer_config.json: ${error.message}`);
        }
    }
    const configCheck = validateTokenizerConfig(tokenizerConfig, byName['tokenizer_config.json']?.text ?? null);
    if (!configCheck.ok) return configCheck;

    if (byName['special_tokens_map.json']) {
        let specialTokens;
        try {
            specialTokens = JSON.parse(byName['special_tokens_map.json'].text);
        } catch (error) {
            return reject(CUSTOM_ARTIFACT_REJECTIONS.INVALID_JSON, `special_tokens_map.json: ${error.message}`);
        }
        const markers = findRemoteCodeMarkers(byName['special_tokens_map.json'].text, specialTokens);
        if (markers.length > 0) return reject(CUSTOM_ARTIFACT_REJECTIONS.REMOTE_CODE, markers.join(', '));
    }

    return {
        ok: true,
        files: fileCheck.files,
        totalBytes: fileCheck.totalBytes,
        tokenizerJson,
        tokenizerConfig,
        summary: { ...jsonCheck.summary, ...configCheck.summary },
    };
}

/** 파일 이름·길이·내용을 정규 문자열로 만들어 지문 입력을 만든다. */
export function fingerprintInput(files) {
    return [...files]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((file) => `${file.name}:${utf8Bytes(file.text)}:${file.text}`)
        .join(' ');
}

export async function fingerprintCustomArtifact(files, subtle = globalThis.crypto?.subtle) {
    if (!subtle || typeof subtle.digest !== 'function') {
        return { available: false, unavailableReason: 'subtle-crypto-unavailable', sha256: null };
    }
    const bytes = new TextEncoder().encode(fingerprintInput(files));
    const digest = await subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    return { available: true, unavailableReason: null, sha256 };
}

/**
 * 세션 한정 custom artifact 서술자. 저장소 정보가 없다는 사실을 감추지 않는다.
 */
export function createCustomArtifactDescriptor({
    parsed,
    fingerprint,
    smoke,
    engineCompatibility,
    createdAt = null,
}) {
    if (!parsed || parsed.ok !== true) throw new TypeError('parsed: expected a successful validation result');
    if (!smoke || typeof smoke.ok !== 'boolean') throw new TypeError('smoke: expected an encode/decode result');

    return {
        schemaVersion: CUSTOM_ARTIFACT_SCHEMA_VERSION,
        id: 'local/custom-tokenizer',
        label: 'Custom (session only)',
        source: 'local-upload',
        // 로컬 파일에는 저장소 revision이 없다. 추정하지 않고 지문으로 대신한다.
        revision: null,
        revisionUnavailableReason: 'local-upload-has-no-commit',
        fingerprint,
        license: {
            status: 'unknown',
            identifier: 'unknown',
            reason: 'A locally uploaded file carries no repository license metadata.',
        },
        engineCompatibility,
        persistence: 'session-only',
        totalBytes: parsed.totalBytes,
        files: parsed.files.map((file) => ({ name: file.name, bytes: file.bytes })),
        summary: parsed.summary,
        smoke,
        createdAt: createdAt || new Date().toISOString(),
    };
}

/** encode → decode 왕복이 성립하는지 확인한다. 실패해도 성공으로 넘기지 않는다. */
export function evaluateSmokeTest({ text, ids, decoded }) {
    if (!Array.isArray(ids) || ids.length === 0) {
        return { ok: false, code: CUSTOM_ARTIFACT_REJECTIONS.SMOKE_TEST_FAILED, detail: 'no-token-ids', tokens: 0, roundTrip: 'unavailable' };
    }
    const roundTrip = decoded === text ? 'lossless' : 'differs';
    return {
        ok: true,
        code: null,
        detail: null,
        tokens: ids.length,
        roundTrip,
        sampleText: text,
    };
}
