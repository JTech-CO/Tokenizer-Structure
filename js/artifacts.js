// artifacts.js — tokenizer artifact catalog (runtime-independent metadata)

export const ARTIFACTS_VERIFIED_AT = '2026-08-24';

export const TOKENIZER_ENGINE_COMPATIBILITY = Object.freeze({
    package: '@huggingface/transformers',
    version: '3.8.1',
    status: 'verified',
    runtime: 'browser',
});

const STAGE_ACCESS = Object.freeze({
    normalizer: 'runtime-detected',
    preTokenizer: 'runtime-detected',
    model: 'direct',
    postProcessor: 'encode-only',
});

const RUNTIME_CAPABILITIES = Object.freeze({
    stageAccess: STAGE_ACCESS,
    offsetLevel: 'none',
    chatTemplate: 'unknown',
    textPair: 'runtime-contract',
    padding: 'runtime-conditional',
    paddingSide: 'runtime-property',
    truncation: 'runtime-contract',
    stride: 'unsupported-runtime-contract',
    decode: 'runtime-contract',
    attentionMask: 'runtime-call',
    tokenTypeIds: 'runtime-conditional',
    specialTokenMask: 'derived-special-id-set',
    sequenceIds: 'runtime-not-exposed',
    wordIds: 'runtime-not-exposed',
});

function artifact({ licenseIdentifier, tokenizerAssetBytes, ...entry }) {
    const metadataSourceUrl =
        `https://huggingface.co/api/models/${entry.id}/revision/${entry.revision}?blobs=true`;
    const license = licenseIdentifier === null
        ? Object.freeze({
              status: 'missing-metadata',
              identifier: 'unknown',
              reason: 'The pinned revision API response does not include cardData.license.',
              sourceUrl: metadataSourceUrl,
          })
        : Object.freeze({
              status: 'declared',
              identifier: licenseIdentifier,
              sourceField: 'cardData.license',
              sourceUrl: metadataSourceUrl,
          });

    return Object.freeze({
        ...entry,
        sourceUrl: `https://huggingface.co/${entry.id}/tree/${entry.revision}`,
        metadataSourceUrl,
        verifiedAt: ARTIFACTS_VERIFIED_AT,
        engineCompatibility: TOKENIZER_ENGINE_COMPATIBILITY,
        license,
        capabilities: RUNTIME_CAPABILITIES,
        operations: Object.freeze({
            anonymousBrowserLoad: 'verified',
            cors: 'verified',
            private: false,
            gated: false,
            revisionPolicy: 'pinned-commit',
            fileSize: Object.freeze({
                status: 'verified',
                totalBytes: tokenizerAssetBytes,
                sourceUrl: metadataSourceUrl,
            }),
        }),
    });
}

// The display fields below are retained for the current UI. Capabilities describe
// only what this app has verified; they are not inferred from a model name.
export const ARTIFACTS = Object.freeze([
    artifact({
        id: 'Xenova/gpt-4o',
        revision: '7956d98f2a83b2751a98ea7136fdf7fe6cf54e69',
        label: 'GPT-4o (o200k)', family: 'BPE · byte-level', context: 128_000,
        licenseIdentifier: 'mit', tokenizerAssetBytes: 16_857_568,
    }),
    artifact({
        id: 'onnx-community/Qwen3.5-0.8B-ONNX',
        revision: 'c0d619322dad7c4441a8841a53fc59772ddddcc0',
        label: 'Qwen3.5 0.8B', family: 'BPE · byte-level', context: 262_144,
        licenseIdentifier: 'apache-2.0', tokenizerAssetBytes: 19_235_272,
    }),
    artifact({
        id: 'Xenova/llama4-tokenizer',
        revision: '2cac0ef8980927774181b5fdc77d539b25cde31f',
        label: 'Llama 4 Scout tokenizer', family: 'BPE · byte-level', context: 10_000_000,
        licenseIdentifier: null, tokenizerAssetBytes: 21_652_018,
    }),
    artifact({
        id: 'onnx-community/gemma-3-1b-it-ONNX',
        revision: 'a58439f40017d3b99c7d378ff525e54e0ba08ebf',
        label: 'Gemma 3 1B', family: 'SentencePiece', context: 32_768,
        licenseIdentifier: 'gemma', tokenizerAssetBytes: 20_326_002,
    }),
    artifact({
        id: 'deepseek-ai/DeepSeek-V3',
        revision: 'e815299b0bcbac849fa540c768ef21845365c9eb',
        label: 'DeepSeek-V3', family: 'BPE · byte-level', context: 131_072,
        licenseIdentifier: null, tokenizerAssetBytes: 7_850_780,
    }),
    artifact({
        id: 'Xenova/bert-base-multilingual-cased',
        revision: '17016e764a76e30ed904bc251df4510f27b7f23f',
        label: 'BERT multilingual', family: 'WordPiece', context: 512,
        licenseIdentifier: null, tokenizerAssetBytes: 3_915_328,
    }),
]);

// Temporary compatibility name for the existing UI imports.
export const MODELS = ARTIFACTS;
