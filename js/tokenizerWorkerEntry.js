// Executable P1 module-worker entry backed by the pinned Transformers.js adapter.
import { MODELS, disposeTokenizer, loadTokenizer, tokenizeReal } from './tokenizer.js';
import { registerTokenizerWorkerAdapter } from './tokenizerWorker.js';

function abortError() {
    return new DOMException('Tokenizer worker operation was cancelled.', 'AbortError');
}

function assertActive(signal) {
    if (signal?.aborted) throw abortError();
}

registerTokenizerWorkerAdapter({
    async load(modelId, { signal, onProgress }) {
        assertActive(signal);
        const tokenizer = await loadTokenizer(modelId, (ratio, detail) => {
            assertActive(signal);
            onProgress({ phase: 'loading-tokenizer', ratio, details: detail || null });
        });
        assertActive(signal);
        const artifact = MODELS.find((entry) => entry.id === modelId);
        return {
            resource: tokenizer,
            estimatedBytes: artifact?.operations.fileSize.totalBytes || 0,
        };
    },
    async analyze(tokenizer, payload, { signal, onProgress }) {
        assertActive(signal);
        onProgress({ phase: 'tokenizing', ratio: 0 });
        const result = tokenizeReal(tokenizer, payload.text, payload.options);
        assertActive(signal);
        onProgress({ phase: 'tokenizing', ratio: 1 });
        return result;
    },
    async dispose(_tokenizer, { modelId }) {
        disposeTokenizer(modelId);
    },
});
