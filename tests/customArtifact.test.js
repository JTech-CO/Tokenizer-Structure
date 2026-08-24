import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CUSTOM_ARTIFACT_LIMITS,
    CUSTOM_ARTIFACT_REJECTIONS,
    CUSTOM_ARTIFACT_SCHEMA_VERSION,
    createCustomArtifactDescriptor,
    evaluateSmokeTest,
    findRemoteCodeMarkers,
    fingerprintCustomArtifact,
    fingerprintInput,
    parseCustomArtifact,
    validateCustomArtifactFiles,
    validateTokenizerConfig,
    validateTokenizerJson,
} from '../js/customArtifact.js';

const TOKENIZER_JSON = {
    version: '1.0',
    added_tokens: [{ id: 0, content: '[UNK]', special: true }],
    normalizer: { type: 'Sequence', normalizers: [{ type: 'NFC' }, { type: 'Lowercase' }] },
    pre_tokenizer: { type: 'ByteLevel', add_prefix_space: false },
    post_processor: { type: 'TemplateProcessing', single: [] },
    decoder: { type: 'ByteLevel' },
    model: { type: 'BPE', vocab: { a: 0, b: 1 }, merges: ['a b'] },
};

const CONFIG_JSON = { tokenizer_class: 'PreTrainedTokenizerFast', model_max_length: 1024 };

function files(overrides = {}) {
    return [
        { name: 'tokenizer.json', text: JSON.stringify(overrides.tokenizer ?? TOKENIZER_JSON) },
        { name: 'tokenizer_config.json', text: JSON.stringify(overrides.config ?? CONFIG_JSON) },
    ];
}

test('only the known tokenizer file names, counts, and sizes are accepted', () => {
    assert.equal(validateCustomArtifactFiles(files()).ok, true);

    assert.equal(
        validateCustomArtifactFiles([{ name: 'model.onnx', text: '{}' }]).code,
        CUSTOM_ARTIFACT_REJECTIONS.UNKNOWN_FILE,
    );
    assert.equal(
        validateCustomArtifactFiles([{ name: 'tokenizer_config.json', text: '{}' }]).code,
        CUSTOM_ARTIFACT_REJECTIONS.MISSING_REQUIRED_FILE,
    );
    assert.equal(
        validateCustomArtifactFiles([...files(), { name: 'tokenizer.json', text: '{}' }]).code,
        CUSTOM_ARTIFACT_REJECTIONS.DUPLICATE_FILE,
    );
    assert.equal(
        validateCustomArtifactFiles([
            { name: 'tokenizer.json', text: 'x'.repeat(CUSTOM_ARTIFACT_LIMITS.maxFileBytes + 1) },
        ]).code,
        CUSTOM_ARTIFACT_REJECTIONS.FILE_TOO_LARGE,
    );
    assert.equal(
        validateCustomArtifactFiles([
            ...files(),
            { name: 'special_tokens_map.json', text: '{}' },
            { name: 'special_tokens_map.json', text: '{}' },
        ]).code,
        CUSTOM_ARTIFACT_REJECTIONS.TOO_MANY_FILES,
    );
});

test('remote-code fields are rejected in raw text and in parsed objects', () => {
    assert.deepEqual(findRemoteCodeMarkers('{"auto_map":{}}', { auto_map: {} }), ['auto_map']);
    assert.ok(findRemoteCodeMarkers('{"trust_remote_code":true}', {}).includes('trust_remote_code'));

    // `owner/repo--Module.Class` 처럼 모듈 경로를 가리키는 클래스 이름을 막는다.
    const markers = findRemoteCodeMarkers('{}', { tokenizer_class: 'acme/repo--custom.MyTokenizer' });
    assert.ok(markers.some((marker) => marker.startsWith('tokenizer_class:')));
    assert.deepEqual(findRemoteCodeMarkers('{}', { tokenizer_class: 'LlamaTokenizer' }), []);

    assert.equal(
        validateTokenizerConfig({ tokenizer_class: 'acme/repo--x.Y' }).code,
        CUSTOM_ARTIFACT_REJECTIONS.REMOTE_CODE,
    );
    assert.equal(
        validateTokenizerConfig({ tokenizer_class: 'Ok' }, '{"auto_map":{"AutoTokenizer":["x","y"]}}').code,
        CUSTOM_ARTIFACT_REJECTIONS.REMOTE_CODE,
    );
    assert.equal(validateTokenizerConfig(null).ok, true);
});

test('unknown component types are refused instead of being passed through', () => {
    assert.equal(validateTokenizerJson(TOKENIZER_JSON).ok, true);

    const badNormalizer = validateTokenizerJson({
        ...TOKENIZER_JSON,
        normalizer: { type: 'Sequence', normalizers: [{ type: 'RunArbitraryCode' }] },
    });
    assert.equal(badNormalizer.code, CUSTOM_ARTIFACT_REJECTIONS.UNSUPPORTED_COMPONENT);
    assert.match(badNormalizer.detail, /RunArbitraryCode/);

    assert.equal(
        validateTokenizerJson({ ...TOKENIZER_JSON, model: { type: 'Magic', vocab: {} } }).code,
        CUSTOM_ARTIFACT_REJECTIONS.UNSUPPORTED_COMPONENT,
    );
    assert.equal(
        validateTokenizerJson({ ...TOKENIZER_JSON, model: undefined }).code,
        CUSTOM_ARTIFACT_REJECTIONS.MISSING_MODEL,
    );
    assert.equal(
        validateTokenizerJson({ ...TOKENIZER_JSON, decoder: { type: 'ByteLevel', auto_map: {} } }).code,
        CUSTOM_ARTIFACT_REJECTIONS.REMOTE_CODE,
    );
});

test('component walking is bounded in depth and node count', () => {
    let deep = { type: 'Sequence' };
    let cursor = deep;
    for (let i = 0; i < CUSTOM_ARTIFACT_LIMITS.maxComponentDepth + 4; i += 1) {
        cursor.normalizers = [{ type: 'Sequence' }];
        [cursor] = cursor.normalizers;
    }
    assert.equal(
        validateTokenizerJson({ ...TOKENIZER_JSON, normalizer: deep }).code,
        CUSTOM_ARTIFACT_REJECTIONS.COMPONENT_TOO_DEEP,
    );

    const wide = {
        type: 'Sequence',
        normalizers: Array.from({ length: CUSTOM_ARTIFACT_LIMITS.maxComponentNodes + 10 }, () => ({ type: 'NFC' })),
    };
    assert.equal(
        validateTokenizerJson({ ...TOKENIZER_JSON, normalizer: wide }).code,
        CUSTOM_ARTIFACT_REJECTIONS.COMPONENT_TOO_LARGE,
    );
});

test('oversized vocabularies and added-token lists are refused', () => {
    const vocab = {};
    assert.equal(validateTokenizerJson({
        ...TOKENIZER_JSON,
        model: { type: 'BPE', vocab, merges: Array.from({ length: CUSTOM_ARTIFACT_LIMITS.maxMerges + 1 }, () => 'a b') },
    }).code, CUSTOM_ARTIFACT_REJECTIONS.VOCAB_TOO_LARGE);

    assert.equal(validateTokenizerJson({
        ...TOKENIZER_JSON,
        added_tokens: Array.from({ length: CUSTOM_ARTIFACT_LIMITS.maxAddedTokens + 1 }, (_, id) => ({ id })),
    }).code, CUSTOM_ARTIFACT_REJECTIONS.TOO_MANY_ADDED_TOKENS);
});

test('parsing reports a usable summary or a specific rejection', () => {
    const parsed = parseCustomArtifact(files());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.summary.modelType, 'BPE');
    assert.equal(parsed.summary.vocabSize, 2);
    assert.equal(parsed.summary.tokenizerClass, 'PreTrainedTokenizerFast');
    assert.equal(parsed.summary.components.pre_tokenizer, 'ByteLevel');

    assert.equal(
        parseCustomArtifact([{ name: 'tokenizer.json', text: '{not json' }]).code,
        CUSTOM_ARTIFACT_REJECTIONS.INVALID_JSON,
    );
    assert.equal(
        parseCustomArtifact(files({ config: { auto_map: { AutoTokenizer: ['a', 'b'] } } })).code,
        CUSTOM_ARTIFACT_REJECTIONS.REMOTE_CODE,
    );
    assert.equal(
        parseCustomArtifact([
            ...files(),
            { name: 'special_tokens_map.json', text: '{"auto_map":{}}' },
        ]).code,
        CUSTOM_ARTIFACT_REJECTIONS.REMOTE_CODE,
    );
});

test('the fingerprint depends on content, not on upload order', async () => {
    const ordered = files();
    const reversed = [...ordered].reverse();
    assert.equal(fingerprintInput(ordered), fingerprintInput(reversed));

    const first = await fingerprintCustomArtifact(ordered);
    const second = await fingerprintCustomArtifact(reversed);
    assert.equal(first.available, true);
    assert.match(first.sha256, /^[0-9a-f]{64}$/);
    assert.equal(first.sha256, second.sha256);

    const changed = await fingerprintCustomArtifact(files({ config: { ...CONFIG_JSON, model_max_length: 2048 } }));
    assert.notEqual(first.sha256, changed.sha256);

    // undefined는 기본 인자를 되살리므로, 없는 환경은 null로 표현한다.
    const unavailable = await fingerprintCustomArtifact(ordered, null);
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.sha256, null);
});

test('a smoke test that produces no tokens is a failure, not a pass', () => {
    assert.equal(evaluateSmokeTest({ text: 'a', ids: [], decoded: '' }).ok, false);
    assert.equal(evaluateSmokeTest({ text: 'a', ids: [], decoded: '' }).roundTrip, 'unavailable');

    const lossless = evaluateSmokeTest({ text: 'hello', ids: [1, 2], decoded: 'hello' });
    assert.deepEqual([lossless.ok, lossless.tokens, lossless.roundTrip], [true, 2, 'lossless']);
    assert.equal(evaluateSmokeTest({ text: 'hello', ids: [1], decoded: 'hell' }).roundTrip, 'differs');
});

test('a custom descriptor never claims a revision or a license it does not have', () => {
    const parsed = parseCustomArtifact(files());
    const descriptor = createCustomArtifactDescriptor({
        parsed,
        fingerprint: { available: true, unavailableReason: null, sha256: 'a'.repeat(64) },
        smoke: evaluateSmokeTest({ text: 'hi', ids: [1, 2], decoded: 'hi' }),
        engineCompatibility: { package: '@huggingface/transformers', version: '3.8.1' },
        createdAt: '2026-08-25T00:00:00.000Z',
    });

    assert.equal(descriptor.schemaVersion, CUSTOM_ARTIFACT_SCHEMA_VERSION);
    assert.equal(descriptor.revision, null);
    assert.equal(descriptor.revisionUnavailableReason, 'local-upload-has-no-commit');
    assert.equal(descriptor.license.status, 'unknown');
    assert.equal(descriptor.persistence, 'session-only');
    assert.equal(descriptor.engineCompatibility.version, '3.8.1');
    assert.deepEqual(descriptor.files.map((file) => file.name), ['tokenizer.json', 'tokenizer_config.json']);
    assert.equal(descriptor.smoke.roundTrip, 'lossless');

    assert.throws(
        () => createCustomArtifactDescriptor({ parsed: { ok: false }, fingerprint: {}, smoke: { ok: true } }),
        /successful validation/,
    );
});
