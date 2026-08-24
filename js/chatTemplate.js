// chatTemplate.js — P2 chat-template 직렬화와 overhead 분석.
// 능력은 모델 이름이 아니라 실제 런타임 렌더링 결과로만 판정한다.
import { EVIDENCE_GRADES } from './analysisContract.js';
import {
    REQUEST_CAPABILITY_NAMES,
    REQUEST_UNAVAILABLE_REASONS as REASONS,
    createRequestAnalysisResult,
    normalizeRequestSpec,
    rawContentText,
} from './requestContract.js';

// 사용자 입력과 절대 겹치지 않도록 고정된 probe 표식을 사용한다.
// 표식에는 역할 이름을 넣지 않는다. 렌더 결과에서 역할 구분자와 혼동되기 때문이다.
const PROBE = Object.freeze({
    system: 'zzprobealphazz',
    user: 'zzprobebetazz',
    assistant: 'zzprobegammazz',
    tool: 'zzprobedeltazz',
    toolName: 'zzprobe_fn_epsilon',
    documentText: 'zzprobezetazz',
});

const PROBE_TOOL = Object.freeze({
    type: 'function',
    function: {
        name: PROBE.toolName,
        description: 'probe',
        parameters: { type: 'object', properties: {}, required: [] },
    },
});

const PROBE_DOCUMENT = Object.freeze({ title: 'probe', text: PROBE.documentText });

const probeCache = new WeakMap();

function flattenIds(value) {
    const raw = value && value.data !== undefined ? value.data : value;
    let flattened = raw;
    if (Array.isArray(raw) && raw.length === 1
        && (Array.isArray(raw[0]) || ArrayBuffer.isView(raw[0]))) {
        [flattened] = raw;
    }
    if (!Array.isArray(flattened) && !ArrayBuffer.isView(flattened)) {
        throw new Error('Tokenizer returned invalid input_ids');
    }
    return flattened;
}

export function countTokens(tok, text, { addSpecialTokens = false } = {}) {
    const encoded = tok(text, {
        add_special_tokens: addSpecialTokens,
        return_tensor: false,
        padding: false,
        truncation: false,
    });
    return flattenIds(encoded.input_ids).length;
}

// tokenize:false로만 렌더링하고 토큰화는 별도로 수행한다. Transformers.js v3.8.1의
// apply_chat_template은 내부적으로 add_special_tokens=false로 호출하므로 동일한 경로다.
export function renderTemplate(tok, {
    messages,
    tools = [],
    documents = [],
    addGenerationPrompt = false,
}) {
    return tok.apply_chat_template(messages, {
        tokenize: false,
        add_generation_prompt: addGenerationPrompt,
        tools: tools.length > 0 ? tools : null,
        documents: documents.length > 0 ? documents : null,
    });
}

function tryRender(tok, options) {
    try {
        const rendered = renderTemplate(tok, options);
        return typeof rendered === 'string' ? { ok: true, rendered } : { ok: false, error: 'non-string-render' };
    } catch (error) {
        return { ok: false, error: String((error && error.message) || error) };
    }
}

function isMergedTurn(rendered) {
    const systemIndex = rendered.indexOf(PROBE.system);
    const userIndex = rendered.indexOf(PROBE.user);
    if (systemIndex < 0 || userIndex <= systemIndex) return false;
    return rendered.slice(systemIndex + PROBE.system.length, userIndex).trim() === '';
}

function capability(available, unavailableReason = null) {
    return { available, unavailableReason, detectedBy: 'runtime-probe' };
}

function notProbed(unavailableReason) {
    return { available: false, unavailableReason, detectedBy: 'not-probed' };
}

export function unsupportedCapabilities(reason) {
    const result = {};
    for (const name of REQUEST_CAPABILITY_NAMES) result[name] = notProbed(reason);
    return result;
}

// 실제 렌더링 결과를 비교해 능력을 판정한다. 결과는 tokenizer 인스턴스별로 캐시한다.
export function probeChatTemplate(tok) {
    if (probeCache.has(tok)) return probeCache.get(tok);

    const baseline = tryRender(tok, { messages: [{ role: 'user', content: PROBE.user }] });
    if (!baseline.ok) {
        const probed = {
            capabilities: unsupportedCapabilities(REASONS.ARTIFACT_NO_CHAT_TEMPLATE),
            notes: [],
        };
        probeCache.set(tok, probed);
        return probed;
    }

    const capabilities = { chatTemplate: capability(true) };
    const notes = [];

    const withGeneration = tryRender(tok, {
        messages: [{ role: 'user', content: PROBE.user }],
        addGenerationPrompt: true,
    });
    capabilities.addGenerationPrompt = withGeneration.ok && withGeneration.rendered !== baseline.rendered
        ? capability(true)
        : capability(false, REASONS.TEMPLATE_IGNORES_FIELD);

    const withTools = tryRender(tok, {
        messages: [{ role: 'user', content: PROBE.user }],
        tools: [PROBE_TOOL],
    });
    capabilities.tools = withTools.ok && withTools.rendered.includes(PROBE.toolName)
        ? capability(true)
        : capability(false, withTools.ok ? REASONS.TEMPLATE_IGNORES_FIELD : REASONS.TEMPLATE_REJECTS_INPUT);

    const withDocuments = tryRender(tok, {
        messages: [{ role: 'user', content: PROBE.user }],
        documents: [PROBE_DOCUMENT],
    });
    capabilities.documents = withDocuments.ok && withDocuments.rendered.includes(PROBE.documentText)
        ? capability(true)
        : capability(false, withDocuments.ok ? REASONS.TEMPLATE_IGNORES_FIELD : REASONS.TEMPLATE_REJECTS_INPUT);

    const withSystem = tryRender(tok, {
        messages: [
            { role: 'system', content: PROBE.system },
            { role: 'user', content: PROBE.user },
        ],
    });
    capabilities.systemRole = withSystem.ok && withSystem.rendered.includes(PROBE.system)
        ? capability(true)
        : capability(false, withSystem.ok ? REASONS.TEMPLATE_IGNORES_FIELD : REASONS.TEMPLATE_REJECTS_INPUT);
    // 전용 system turn 없이 첫 사용자 turn에 합치는 템플릿이 있다. 값은 보존되지만
    // 구조가 다르므로 사실만 기록하고 지원/미지원으로 뭉뚱그리지 않는다.
    // 두 표식 사이가 공백뿐이면 turn 구분자가 없다는 뜻이므로 합쳐진 것으로 본다.
    if (capabilities.systemRole.available && isMergedTurn(withSystem.rendered)) {
        notes.push('system-merged-into-first-turn');
    }

    const withAssistant = tryRender(tok, {
        messages: [
            { role: 'user', content: PROBE.user },
            { role: 'assistant', content: PROBE.assistant },
        ],
    });
    capabilities.assistantRole = withAssistant.ok && withAssistant.rendered.includes(PROBE.assistant)
        ? capability(true)
        : capability(false, withAssistant.ok ? REASONS.TEMPLATE_IGNORES_FIELD : REASONS.TEMPLATE_REJECTS_INPUT);

    const withTool = tryRender(tok, {
        messages: [
            { role: 'user', content: PROBE.user },
            { role: 'assistant', content: PROBE.assistant },
            { role: 'tool', content: PROBE.tool },
        ],
    });
    capabilities.toolRole = withTool.ok && withTool.rendered.includes(PROBE.tool)
        ? capability(true)
        : capability(false, withTool.ok ? REASONS.TEMPLATE_IGNORES_FIELD : REASONS.TEMPLATE_REJECTS_INPUT);

    const probed = { capabilities, notes };
    probeCache.set(tok, probed);
    return probed;
}

function measurement(tokenCount, evidence = EVIDENCE_GRADES.AUTHORITATIVE) {
    return { tokenCount, evidence, unavailableReason: null };
}

function unavailableMeasurement(unavailableReason) {
    return { tokenCount: null, evidence: EVIDENCE_GRADES.UNAVAILABLE, unavailableReason };
}

function segment({ id, kind, roles = [], label, measure, cachePrefixCandidate }) {
    return {
        id,
        kind,
        role: roles.length === 1 ? roles[0] : null,
        roles,
        label,
        measurement: measure,
        cachePrefixCandidate,
    };
}

// 순차적으로 요소를 더해가며 각 단계의 차이를 세그먼트로 만든다. 합이 정확히
// 전체 토큰 수와 같아지도록 체인 순서를 고정한다.
function buildSegments(tok, spec, effective, warnings) {
    const segments = [];
    const messages = spec.messages;
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');

    let running = 0;
    let chainBroken = false;

    const step = ({ id, kind, roles, label, prefixMessages, tools, documents, addGenerationPrompt, cachePrefixCandidate }) => {
        if (chainBroken) {
            segments.push(segment({
                id, kind, roles, label, cachePrefixCandidate,
                measure: unavailableMeasurement(REASONS.NOT_COMPUTED),
            }));
            return;
        }
        const rendered = tryRender(tok, {
            messages: prefixMessages,
            tools,
            documents,
            addGenerationPrompt,
        });
        if (!rendered.ok) {
            chainBroken = true;
            warnings.push(`segment-render-failed:${id}`);
            segments.push(segment({
                id, kind, roles, label, cachePrefixCandidate,
                measure: unavailableMeasurement(REASONS.TEMPLATE_REJECTS_INPUT),
            }));
            return;
        }
        const total = countTokens(tok, rendered.rendered);
        segments.push(segment({
            id, kind, roles, label, cachePrefixCandidate,
            measure: measurement(total - running, EVIDENCE_GRADES.DERIVED),
        }));
        running = total;
    };

    // 일부 템플릿은 user turn이 없는 중간 prefix를 거부한다("No user query found").
    // 그런 경우 렌더 가능한 지점까지 메시지를 묶어 하나의 세그먼트로 보고한다.
    let pending = [];
    let emitted = 0;
    messages.forEach((message, index) => {
        pending.push(index);
        if (chainBroken) return;

        const prefix = messages.slice(0, index + 1);
        const rendered = tryRender(tok, {
            messages: prefix,
            tools: [],
            documents: [],
            addGenerationPrompt: false,
        });
        if (!rendered.ok) return;

        const total = countTokens(tok, rendered.rendered);
        const group = pending;
        pending = [];
        const parts = group.map((item) => `${messages[item].role} #${item + 1}`);
        segments.push(segment({
            // 첫 세그먼트는 템플릿 preamble을 포함한다. 라벨에 그대로 드러낸다.
            id: `message-${index}`,
            kind: 'message',
            roles: group.map((item) => messages[item].role),
            label: emitted === 0 ? `${parts.join(' + ')} (+template preamble)` : parts.join(' + '),
            cachePrefixCandidate: lastUserIndex === -1 || group.every((item) => item < lastUserIndex),
            measure: measurement(total - running, EVIDENCE_GRADES.DERIVED),
        }));
        running = total;
        emitted += 1;
    });

    if (pending.length > 0) {
        chainBroken = true;
        warnings.push(`segment-render-failed:message-${pending[pending.length - 1]}`);
        segments.push(segment({
            id: `message-${pending[pending.length - 1]}`,
            kind: 'message',
            roles: pending.map((item) => messages[item].role),
            label: pending.map((item) => `${messages[item].role} #${item + 1}`).join(' + '),
            cachePrefixCandidate: false,
            measure: unavailableMeasurement(REASONS.TEMPLATE_REJECTS_INPUT),
        }));
    }

    if (spec.tools.length > 0) {
        step({
            id: 'tools',
            kind: 'tools',
            roles: [],
            label: `tools ×${spec.tools.length}`,
            prefixMessages: messages,
            tools: effective.tools ? spec.tools : [],
            documents: [],
            addGenerationPrompt: false,
            cachePrefixCandidate: true,
        });
    }

    if (spec.documents.length > 0) {
        step({
            id: 'documents',
            kind: 'documents',
            roles: [],
            label: `documents ×${spec.documents.length}`,
            prefixMessages: messages,
            tools: effective.tools ? spec.tools : [],
            documents: effective.documents ? spec.documents : [],
            addGenerationPrompt: false,
            cachePrefixCandidate: true,
        });
    }

    if (spec.addGenerationPrompt) {
        step({
            id: 'generation-prompt',
            kind: 'generation-prompt',
            roles: [],
            label: 'generation prompt',
            prefixMessages: messages,
            tools: effective.tools ? spec.tools : [],
            documents: effective.documents ? spec.documents : [],
            addGenerationPrompt: true,
            cachePrefixCandidate: false,
        });
    }

    return { segments, total: chainBroken ? null : running };
}

function collectUnsupported(spec, capabilities, notes) {
    const unsupported = [];
    const usedRoles = new Set(spec.messages.map((message) => message.role));

    for (const [role, name] of [['system', 'systemRole'], ['assistant', 'assistantRole'], ['tool', 'toolRole']]) {
        if (usedRoles.has(role) && !capabilities[name].available) {
            unsupported.push({
                field: `messages.role=${role}`,
                reason: capabilities[name].unavailableReason,
                detail: 'This artifact template does not reproduce the content of this role.',
            });
        }
    }
    if (spec.tools.length > 0 && !capabilities.tools.available) {
        unsupported.push({
            field: 'tools',
            reason: capabilities.tools.unavailableReason,
            detail: 'The template renders identically with and without tool schemas.',
        });
    }
    if (spec.documents.length > 0 && !capabilities.documents.available) {
        unsupported.push({
            field: 'documents',
            reason: capabilities.documents.unavailableReason,
            detail: 'The template renders identically with and without documents.',
        });
    }
    if (spec.addGenerationPrompt && !capabilities.addGenerationPrompt.available) {
        unsupported.push({
            field: 'addGenerationPrompt',
            reason: capabilities.addGenerationPrompt.unavailableReason,
            detail: 'The template output does not change when a generation prompt is requested.',
        });
    }
    if (notes.includes('system-merged-into-first-turn')) {
        unsupported.push({
            field: 'messages.role=system.dedicatedTurn',
            reason: REASONS.TEMPLATE_IGNORES_FIELD,
            detail: 'The system content is preserved but merged into the first turn instead of a dedicated turn.',
        });
    }
    // 이 앱은 비텍스트 modality를 계산하지 않는다. 0으로 보이지 않도록 명시한다.
    unsupported.push({
        field: 'modality.nonText',
        reason: REASONS.UNSUPPORTED,
        detail: 'Image, audio, and file token accounting is not computed by a local text tokenizer.',
    });
    return unsupported;
}

export function analyzeRequestWithTemplate({ tok, spec, modelId, revision, requestId, createdAt }) {
    const normalizedSpec = normalizeRequestSpec(spec);
    const { capabilities, notes } = probeChatTemplate(tok);
    const warnings = [];

    const rawText = rawContentText(normalizedSpec);
    const raw = measurement(countTokens(tok, rawText));

    const base = {
        requestId,
        createdAt,
        modelId,
        artifact: { id: modelId, revision },
        engine: 'real',
        spec: normalizedSpec,
        capabilities,
        raw,
        providerCounts: {
            preflight: {
                status: 'not-configured',
                unavailableReason: REASONS.GATEWAY_NOT_CONFIGURED,
                countSemantics: 'provider-preflight-requires-a-gateway',
            },
            actual: {
                status: 'not-configured',
                unavailableReason: REASONS.GATEWAY_NOT_CONFIGURED,
                countSemantics: 'actual-usage-requires-a-real-response',
            },
        },
    };

    if (!capabilities.chatTemplate.available) {
        return createRequestAnalysisResult({
            ...base,
            template: unavailableMeasurement(REASONS.ARTIFACT_NO_CHAT_TEMPLATE),
            templateText: null,
            overhead: {
                tokens: null,
                ratio: null,
                evidence: EVIDENCE_GRADES.UNAVAILABLE,
                unavailableReason: REASONS.ARTIFACT_NO_CHAT_TEMPLATE,
            },
            specialTokenDuplication: {
                checked: false,
                unavailableReason: REASONS.ARTIFACT_NO_CHAT_TEMPLATE,
            },
            segments: [],
            unsupported: collectUnsupported(normalizedSpec, capabilities, notes),
            warnings,
        });
    }

    const effective = {
        tools: capabilities.tools.available,
        documents: capabilities.documents.available,
    };
    const rendered = tryRender(tok, {
        messages: normalizedSpec.messages,
        tools: effective.tools ? normalizedSpec.tools : [],
        documents: effective.documents ? normalizedSpec.documents : [],
        addGenerationPrompt: normalizedSpec.addGenerationPrompt,
    });

    if (!rendered.ok) {
        return createRequestAnalysisResult({
            ...base,
            template: unavailableMeasurement(REASONS.TEMPLATE_REJECTS_INPUT),
            templateText: null,
            overhead: {
                tokens: null,
                ratio: null,
                evidence: EVIDENCE_GRADES.UNAVAILABLE,
                unavailableReason: REASONS.TEMPLATE_REJECTS_INPUT,
            },
            specialTokenDuplication: {
                checked: false,
                unavailableReason: REASONS.TEMPLATE_REJECTS_INPUT,
            },
            segments: [],
            unsupported: [
                ...collectUnsupported(normalizedSpec, capabilities, notes),
                {
                    field: 'messages',
                    reason: REASONS.TEMPLATE_REJECTS_INPUT,
                    detail: rendered.error.slice(0, 200),
                },
            ],
            warnings: ['template-render-failed'],
        });
    }

    const templateCount = countTokens(tok, rendered.rendered);
    const withSpecialCount = countTokens(tok, rendered.rendered, { addSpecialTokens: true });
    const { segments, total: segmentTotal } = buildSegments(tok, normalizedSpec, effective, warnings);

    if (segmentTotal !== null && segmentTotal !== templateCount) {
        // 체인이 합산되지 않으면 잘못된 정밀도를 주장하지 않고 사실을 남긴다.
        warnings.push(`segment-total-mismatch:${segmentTotal}!=${templateCount}`);
    }

    return createRequestAnalysisResult({
        ...base,
        template: measurement(templateCount),
        templateText: rendered.rendered,
        overhead: {
            tokens: templateCount - raw.tokenCount,
            ratio: raw.tokenCount === 0 ? null : templateCount / raw.tokenCount,
            evidence: EVIDENCE_GRADES.DERIVED,
            unavailableReason: raw.tokenCount === 0 ? REASONS.NOT_COMPUTED : null,
        },
        specialTokenDuplication: {
            checked: true,
            withSpecialTokenCount: withSpecialCount,
            duplicatedTokens: Math.max(0, withSpecialCount - templateCount),
        },
        segments,
        unsupported: collectUnsupported(normalizedSpec, capabilities, notes),
        warnings,
    });
}

export function unavailableRequestAnalysis({ spec, modelId, requestId, createdAt, reason }) {
    const normalizedSpec = normalizeRequestSpec(spec);
    return createRequestAnalysisResult({
        requestId,
        createdAt,
        modelId,
        artifact: null,
        engine: 'heuristic',
        spec: normalizedSpec,
        capabilities: unsupportedCapabilities(reason),
        raw: unavailableMeasurement(reason),
        template: unavailableMeasurement(reason),
        templateText: null,
        overhead: {
            tokens: null,
            ratio: null,
            evidence: EVIDENCE_GRADES.UNAVAILABLE,
            unavailableReason: reason,
        },
        specialTokenDuplication: { checked: false, unavailableReason: reason },
        segments: [],
        unsupported: [{
            field: 'chatTemplate',
            reason,
            detail: 'A real tokenizer artifact is required before any request structure can be reproduced.',
        }],
        providerCounts: {
            preflight: { status: 'not-configured', unavailableReason: REASONS.GATEWAY_NOT_CONFIGURED },
            actual: { status: 'not-configured', unavailableReason: REASONS.GATEWAY_NOT_CONFIGURED },
        },
        warnings: [],
    });
}
