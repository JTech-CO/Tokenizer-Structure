import test from 'node:test';
import assert from 'node:assert/strict';

import {
    analyzeRequestWithTemplate,
    countTokens,
    probeChatTemplate,
    renderTemplate,
    unavailableRequestAnalysis,
} from '../js/chatTemplate.js';
import { validateRequestAnalysisResult } from '../js/requestContract.js';
import { EVIDENCE_GRADES } from '../js/analysisContract.js';

// 결정론적 가짜 tokenizer. 토큰 수 = code point 수, 특수 토큰 추가 시 +2.
function makeTokenizer({
    chatTemplate = true,
    supportsTools = true,
    supportsDocuments = true,
    supportsGeneration = true,
    rejectsToolRole = false,
    mergesSystem = false,
    requiresUserTurn = false,
    requiresToolsForToolRole = false,
} = {}) {
    const tok = (text, options = {}) => {
        const count = [...text].length + (options.add_special_tokens ? 2 : 0);
        return { input_ids: [Array.from({ length: count }, (_, index) => index + 1)] };
    };

    tok.apply_chat_template = (messages, {
        tools = null,
        documents = null,
        add_generation_prompt: addGenerationPrompt = false,
        tokenize = true,
    } = {}) => {
        if (!chatTemplate) throw new Error('chat_template must be a string, but got object');
        if (rejectsToolRole && messages.some((message) => message.role === 'tool')) {
            throw new Error('Conversation roles must alternate user/assistant/user/assistant/...');
        }
        if (requiresUserTurn && !messages.some((message) => message.role === 'user')) {
            throw new Error('No user query found in messages.');
        }
        if (requiresToolsForToolRole && !tools && messages.some((message) => message.role === 'tool')) {
            throw new Error('A tool response requires declared tools.');
        }
        let out = '<bos>';
        for (const message of messages) {
            // 합치는 템플릿은 turn 구분자 없이 공백만 두고 앞 turn 안에 내용을 이어 붙인다.
            if (mergesSystem && message.role === 'system') {
                out += `<user>${message.content} `;
                continue;
            }
            if (mergesSystem && message.role === 'user' && out.endsWith(' ')) {
                out += `${message.content}</user>`;
                continue;
            }
            out += `<${message.role}>${message.content}</${message.role}>`;
        }
        if (supportsTools && tools) out += `<t>${tools.map((item) => item.function.name).join(',')}</t>`;
        if (supportsDocuments && documents) out += `<d>${documents.map((item) => item.text).join(',')}</d>`;
        if (supportsGeneration && addGenerationPrompt) out += '<assistant>';
        if (!tokenize) return out;
        return tok(out, { add_special_tokens: false }).input_ids;
    };

    return tok;
}

const SPEC = {
    messages: [
        { role: 'system', content: 'terse' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'again' },
    ],
    tools: [{ type: 'function', function: { name: 'get_weather', description: 'w', parameters: { type: 'object' } } }],
    documents: [{ title: 'doc', text: 'body' }],
    addGenerationPrompt: true,
};

function analyze(tok, spec = SPEC) {
    return analyzeRequestWithTemplate({
        tok,
        spec,
        modelId: 'demo/artifact',
        revision: 'abc123',
        requestId: 'req-1',
        createdAt: '2026-08-25T00:00:00.000Z',
    });
}

test('capabilities come from runtime probes, not from the artifact name', () => {
    const probed = probeChatTemplate(makeTokenizer());
    for (const [name, value] of Object.entries(probed.capabilities)) {
        assert.equal(value.available, true, name);
        assert.equal(value.detectedBy, 'runtime-probe', name);
        assert.equal(value.unavailableReason, null, name);
    }
});

test('a template that ignores a field is reported as unsupported, not as working', () => {
    const probed = probeChatTemplate(makeTokenizer({ supportsTools: false, supportsDocuments: false }));
    assert.equal(probed.capabilities.tools.available, false);
    assert.equal(probed.capabilities.tools.unavailableReason, 'template-ignores-field');
    assert.equal(probed.capabilities.documents.unavailableReason, 'template-ignores-field');
    assert.equal(probed.capabilities.chatTemplate.available, true);
});

test('a template that rejects a role is separated from one that drops it', () => {
    const probed = probeChatTemplate(makeTokenizer({ rejectsToolRole: true }));
    assert.equal(probed.capabilities.toolRole.available, false);
    assert.equal(probed.capabilities.toolRole.unavailableReason, 'template-rejects-input');
    assert.equal(probed.capabilities.assistantRole.available, true);
});

test('a merged system turn is recorded as a note rather than silently accepted', () => {
    const probed = probeChatTemplate(makeTokenizer({ mergesSystem: true }));
    assert.equal(probed.capabilities.systemRole.available, true);
    assert.deepEqual(probed.notes, ['system-merged-into-first-turn']);

    const result = analyze(makeTokenizer({ mergesSystem: true }));
    const fields = result.unsupported.map((item) => item.field);
    assert.ok(fields.includes('messages.role=system.dedicatedTurn'));
});

test('render-then-count matches the tokenizer\'s own tokenizing template call', () => {
    const tok = makeTokenizer();
    const rendered = renderTemplate(tok, {
        messages: SPEC.messages,
        tools: SPEC.tools,
        documents: SPEC.documents,
        addGenerationPrompt: true,
    });
    const direct = tok.apply_chat_template(SPEC.messages, {
        tokenize: true,
        tools: SPEC.tools,
        documents: SPEC.documents,
        add_generation_prompt: true,
    });
    assert.equal(countTokens(tok, rendered), direct[0].length);
});

test('segments sum exactly to the template token count', () => {
    const result = analyze(makeTokenizer());
    const sum = result.segments.reduce((total, item) => total + item.measurement.tokenCount, 0);
    assert.equal(sum, result.template.tokenCount);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(
        result.segments.map((item) => item.id),
        ['message-0', 'message-1', 'message-2', 'message-3', 'tools', 'documents', 'generation-prompt'],
    );
    assert.equal(result.segments[0].label, 'system #1 (+template preamble)');
});

test('messages that cannot be rendered alone are grouped instead of breaking the chain', () => {
    const result = analyze(makeTokenizer({ requiresUserTurn: true }));
    const sum = result.segments.reduce((total, item) => total + item.measurement.tokenCount, 0);
    assert.equal(sum, result.template.tokenCount);
    assert.deepEqual(result.warnings, []);

    // system 단독 prefix는 렌더되지 않으므로 첫 user turn까지 하나로 묶인다.
    const first = result.segments[0];
    assert.equal(first.id, 'message-1');
    assert.equal(first.label, 'system #1 + user #2 (+template preamble)');
    assert.equal(first.role, null);
    assert.equal(first.cachePrefixCandidate, true);
    assert.deepEqual(
        result.segments.map((item) => item.id),
        ['message-1', 'message-2', 'message-3', 'tools', 'documents', 'generation-prompt'],
    );
});

test('a trailing group that never renders stays unavailable rather than guessed', () => {
    // 전체 렌더는 tools 덕분에 성공하지만, tools 없이 만드는 중간 prefix는 실패한다.
    const result = analyze(makeTokenizer({ requiresToolsForToolRole: true }), {
        messages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
            { role: 'tool', content: '{"ok":1}' },
        ],
        tools: [{ type: 'function', function: { name: 'get_weather', parameters: {} } }],
        addGenerationPrompt: false,
    });
    assert.ok(result.template.tokenCount > 0);
    assert.equal(result.segments[0].id, 'message-0');
    assert.equal(result.segments[1].id, 'message-1');

    const tail = result.segments[2];
    assert.equal(tail.measurement.tokenCount, null);
    assert.equal(tail.measurement.unavailableReason, 'template-rejects-input');
    assert.ok(result.warnings.some((item) => item.startsWith('segment-render-failed:')));

    // 이후 단계도 추정하지 않고, 합이 맞지 않는다는 사실을 그대로 남긴다.
    assert.equal(result.segments.at(-1).measurement.tokenCount, null);
    assert.ok(result.warnings.some((item) => item.startsWith('segment-total-mismatch:')) === false);
});

test('cache prefix candidates stop at the last user message', () => {
    const result = analyze(makeTokenizer());
    const flags = Object.fromEntries(result.segments.map((item) => [item.id, item.cachePrefixCandidate]));
    assert.deepEqual(flags, {
        'message-0': true,
        'message-1': true,
        'message-2': true,
        'message-3': false,
        tools: true,
        documents: true,
        'generation-prompt': false,
    });
});

test('overhead is the exact difference between template and raw content tokens', () => {
    const result = analyze(makeTokenizer());
    assert.equal(result.raw.evidence, EVIDENCE_GRADES.AUTHORITATIVE);
    assert.equal(result.overhead.tokens, result.template.tokenCount - result.raw.tokenCount);
    assert.equal(result.overhead.evidence, EVIDENCE_GRADES.DERIVED);
    assert.ok(result.overhead.tokens > 0);
    assert.equal(result.overhead.ratio, result.template.tokenCount / result.raw.tokenCount);
});

test('re-tokenizing a rendered template with special tokens is reported as duplication', () => {
    const result = analyze(makeTokenizer());
    assert.equal(result.specialTokenDuplication.checked, true);
    assert.equal(
        result.specialTokenDuplication.withSpecialTokenCount - result.template.tokenCount,
        result.specialTokenDuplication.duplicatedTokens,
    );
    assert.equal(result.specialTokenDuplication.duplicatedTokens, 2);
});

test('an artifact without a chat template reports unavailable instead of zero', () => {
    const result = analyze(makeTokenizer({ chatTemplate: false }));
    assert.equal(result.capabilities.chatTemplate.available, false);
    assert.equal(result.capabilities.chatTemplate.unavailableReason, 'artifact-no-chat-template');
    assert.equal(result.template.tokenCount, null);
    assert.equal(result.overhead.tokens, null);
    assert.equal(result.overhead.unavailableReason, 'artifact-no-chat-template');
    assert.equal(result.specialTokenDuplication.checked, false);
    assert.deepEqual(result.segments, []);
    // raw 본문 계수는 chat template 없이도 여전히 실제 값이다.
    assert.ok(result.raw.tokenCount > 0);
});

test('a template that rejects the conversation keeps the failure explicit', () => {
    const result = analyze(makeTokenizer({ rejectsToolRole: true }), {
        messages: [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' },
            { role: 'tool', content: '{"ok":1}' },
        ],
    });
    assert.equal(result.template.tokenCount, null);
    assert.equal(result.template.unavailableReason, 'template-rejects-input');
    assert.ok(result.warnings.includes('template-render-failed'));
    const rejected = result.unsupported.find((item) => item.field === 'messages');
    assert.equal(rejected.reason, 'template-rejects-input');
});

test('unsupported fields are listed for tools, documents, and non-text modality', () => {
    const result = analyze(makeTokenizer({ supportsTools: false, supportsDocuments: false, supportsGeneration: false }));
    const byField = Object.fromEntries(result.unsupported.map((item) => [item.field, item.reason]));
    assert.equal(byField.tools, 'template-ignores-field');
    assert.equal(byField.documents, 'template-ignores-field');
    assert.equal(byField.addGenerationPrompt, 'template-ignores-field');
    assert.equal(byField['modality.nonText'], 'unsupported');
    // 무시되는 필드는 세그먼트에서 0 토큰으로 정직하게 나타난다.
    const tools = result.segments.find((item) => item.id === 'tools');
    assert.equal(tools.measurement.tokenCount, 0);
});

test('every produced result passes the versioned request contract', () => {
    for (const options of [{}, { chatTemplate: false }, { supportsTools: false }, { rejectsToolRole: true }]) {
        const result = analyze(makeTokenizer(options));
        assert.deepEqual(validateRequestAnalysisResult(result), result);
        assert.equal(result.providerCounts.preflight.status, 'not-configured');
        assert.equal(result.providerCounts.actual.status, 'not-configured');
    }
});

test('the heuristic fallback never claims a request structure', () => {
    const result = unavailableRequestAnalysis({
        spec: SPEC,
        modelId: 'demo/artifact',
        requestId: 'req-2',
        createdAt: '2026-08-25T00:00:00.000Z',
        reason: 'heuristic-engine',
    });
    assert.equal(result.engine, 'heuristic');
    assert.equal(result.artifact, null);
    assert.equal(result.raw.tokenCount, null);
    assert.equal(result.template.tokenCount, null);
    assert.equal(result.raw.unavailableReason, 'heuristic-engine');
    assert.deepEqual(validateRequestAnalysisResult(result), result);
});
