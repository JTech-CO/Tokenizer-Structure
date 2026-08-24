import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARTIFACTS,
    ARTIFACTS_VERIFIED_AT,
    MODELS,
    TOKENIZER_ENGINE_COMPATIBILITY,
} from '../js/artifacts.js';

const EXPECTED_ARTIFACTS = [
    ['Xenova/gpt-4o', '7956d98f2a83b2751a98ea7136fdf7fe6cf54e69', 'GPT-4o (o200k)', 'BPE · byte-level', 128_000],
    ['onnx-community/Qwen3.5-0.8B-ONNX', 'c0d619322dad7c4441a8841a53fc59772ddddcc0', 'Qwen3.5 0.8B', 'BPE · byte-level', 262_144],
    ['Xenova/llama4-tokenizer', '2cac0ef8980927774181b5fdc77d539b25cde31f', 'Llama 4 Scout tokenizer', 'BPE · byte-level', 10_000_000],
    ['onnx-community/gemma-3-1b-it-ONNX', 'a58439f40017d3b99c7d378ff525e54e0ba08ebf', 'Gemma 3 1B', 'SentencePiece', 32_768],
    ['deepseek-ai/DeepSeek-V3', 'e815299b0bcbac849fa540c768ef21845365c9eb', 'DeepSeek-V3', 'BPE · byte-level', 131_072],
    ['Xenova/bert-base-multilingual-cased', '17016e764a76e30ed904bc251df4510f27b7f23f', 'BERT multilingual', 'WordPiece', 512],
];

const EXPECTED_METADATA = new Map([
    ['Xenova/gpt-4o', { license: 'mit', totalBytes: 16_857_568 }],
    ['onnx-community/Qwen3.5-0.8B-ONNX', { license: 'apache-2.0', totalBytes: 19_235_272 }],
    ['Xenova/llama4-tokenizer', { license: null, totalBytes: 21_652_018 }],
    ['onnx-community/gemma-3-1b-it-ONNX', { license: 'gemma', totalBytes: 20_326_002 }],
    ['deepseek-ai/DeepSeek-V3', { license: null, totalBytes: 7_850_780 }],
    ['Xenova/bert-base-multilingual-cased', { license: null, totalBytes: 3_915_328 }],
]);

test('artifact catalog preserves the six pinned UI entries', () => {
    assert.strictEqual(MODELS, ARTIFACTS);
    assert.deepEqual(
        ARTIFACTS.map(({ id, revision, label, family, context }) => [id, revision, label, family, context]),
        EXPECTED_ARTIFACTS
    );
    assert.equal(new Set(ARTIFACTS.map(({ id }) => id)).size, ARTIFACTS.length);
    assert.equal(new Set(ARTIFACTS.map(({ revision }) => revision)).size, ARTIFACTS.length);
});

test('artifact provenance is immutable and dated', () => {
    assert.equal(ARTIFACTS_VERIFIED_AT, '2026-08-24');
    for (const entry of ARTIFACTS) {
        assert.match(entry.revision, /^[0-9a-f]{40}$/);
        assert.equal(entry.verifiedAt, ARTIFACTS_VERIFIED_AT);
        assert.equal(entry.sourceUrl, `https://huggingface.co/${entry.id}/tree/${entry.revision}`);
        assert.equal(
            entry.metadataSourceUrl,
            `https://huggingface.co/api/models/${entry.id}/revision/${entry.revision}?blobs=true`
        );
        assert.doesNotThrow(() => new URL(entry.sourceUrl));
        assert.doesNotThrow(() => new URL(entry.metadataSourceUrl));
    }
});

test('artifact capabilities and operational claims are explicit', () => {
    assert.deepEqual(TOKENIZER_ENGINE_COMPATIBILITY, {
        package: '@huggingface/transformers',
        version: '3.8.1',
        status: 'verified',
        runtime: 'browser',
    });

    for (const entry of ARTIFACTS) {
        const expected = EXPECTED_METADATA.get(entry.id);
        assert.ok(expected);
        assert.strictEqual(entry.engineCompatibility, TOKENIZER_ENGINE_COMPATIBILITY);
        assert.deepEqual(entry.capabilities.stageAccess, {
            normalizer: 'runtime-detected',
            preTokenizer: 'runtime-detected',
            model: 'direct',
            postProcessor: 'encode-only',
        });
        assert.equal(entry.capabilities.offsetLevel, 'none');
        for (const name of ['chatTemplate', 'textPair', 'padding', 'truncation', 'decode']) {
            assert.equal(entry.capabilities[name], 'unknown');
        }
        assert.deepEqual(entry.operations, {
            anonymousBrowserLoad: 'verified',
            cors: 'verified',
            private: false,
            gated: false,
            revisionPolicy: 'pinned-commit',
            fileSize: {
                status: 'verified',
                totalBytes: expected.totalBytes,
                sourceUrl: entry.metadataSourceUrl,
            },
        });
    }
});

test('license metadata distinguishes declarations from missing metadata', () => {
    for (const entry of ARTIFACTS) {
        const identifier = EXPECTED_METADATA.get(entry.id).license;
        if (identifier === null) {
            assert.deepEqual(entry.license, {
                status: 'missing-metadata',
                identifier: 'unknown',
                reason: 'The pinned revision API response does not include cardData.license.',
                sourceUrl: entry.metadataSourceUrl,
            });
        } else {
            assert.deepEqual(entry.license, {
                status: 'declared',
                identifier,
                sourceField: 'cardData.license',
                sourceUrl: entry.metadataSourceUrl,
            });
        }
    }
});
