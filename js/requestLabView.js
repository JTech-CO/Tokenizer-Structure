// requestLabView.js — P2 Request Token Lab 화면. 계약이 만든 값만 렌더링하고
// 미지원 항목은 빈칸이나 0이 아니라 이유와 함께 표시한다.
import { el } from './dom.js';
import { state } from './state.js';
import { MODELS } from './artifacts.js';
import { PRICING, PRICING_AS_OF, PRICING_CATALOG, formatInt, formatUSD } from './pricing.js';
import { analyzeRequestWithTemplate, unavailableRequestAnalysis } from './chatTemplate.js';
import { REQUEST_LIMITS, REQUEST_ROLES, normalizeRequestSpec } from './requestContract.js';
import { buildContextTimeline, estimateConversationReplay } from './contextBudget.js';
import { computeCostScenario } from './costScenario.js';

const COPY = Object.freeze({
    ko: {
        tab: 'Request Lab',
        composerTitle: '요청 구성',
        composerNote: '역할별 메시지, tool schema, document를 실제 artifact의 chat template으로 직렬화합니다. 원문은 브라우저 밖으로 전송하지 않습니다.',
        addMessage: '메시지 추가',
        removeMessage: '삭제',
        roleLabel: '역할',
        contentLabel: '내용',
        generationPrompt: '생성 프롬프트 추가',
        toolsLabel: 'tools (JSON 배열)',
        documentsLabel: 'documents (JSON 배열)',
        structureTitle: '구조와 overhead',
        contextTitle: '컨텍스트 예산',
        costTitle: '비용 시나리오',
        templateSummary: '직렬화 결과 보기',
        templateScrollLabel: 'chat template 직렬화 결과 스크롤 영역',
        rawTokens: '본문만',
        templateTokens: '템플릿 적용',
        overheadTokens: '구조 overhead',
        segmentsTitle: '누적 세그먼트',
        colSegment: '세그먼트', colTokens: '토큰', colCumulative: '누적', colCache: '고정 prefix 후보',
        yes: '예', no: '아니오',
        duplicationSafe: '직렬화 결과를 다시 토큰화해도 특수 토큰이 중복되지 않습니다.',
        duplicationWarn: '직렬화 결과에 특수 토큰을 다시 추가하면 {n}개가 중복됩니다. 템플릿 문자열은 add_special_tokens=false로 토큰화해야 합니다.',
        providerTitle: '제공사 계수',
        preflight: '사전 계수', actual: '실제 usage',
        notConfigured: '연동 없음',
        unsupportedTitle: '이 요청에서 지원하지 않는 항목',
        reservedOutput: '출력 여유', reservedReasoning: '추론 여유',
        contextWindow: 'artifact 컨텍스트', inputBudget: '입력 예산', inputTokens: '입력 토큰', headroom: '남은 예산',
        cachePrefix: '고정 prefix', dynamicSuffix: '가변 suffix',
        truncationWarn: '{id} 지점에서 입력 예산을 {n} 토큰 초과합니다. 실제 절단 위치는 제공사 정책에 따라 다릅니다.',
        replay: 'user turn {turns}회를 각각 새 요청으로 보내면 누적 입력은 {tokens} 토큰입니다. 캐시나 서버측 상태 보존은 가정하지 않습니다.',
        costModel: '단가 적용 모델', callsPerDay: '일간 호출 수',
        appliedRate: '적용 단가', perCall: '호출당', perDay: '일간', perMonth: '월간',
        tierBase: '기본 구간', tierHigh: '장문 구간',
        countSemantics: '이 단가는 제공사 API 기준이고 토큰 수는 로컬 artifact 기준입니다. 두 토크나이저가 같다고 주장하지 않습니다.',
        excludedTitle: '비용에서 제외한 항목',
        pricingAsOf: '단가 기준일',
        engineUnavailable: '실제 artifact가 로드되어야 요청 구조를 재현할 수 있습니다.',
        noTemplate: '이 artifact에는 chat template이 없습니다. 본문 토큰 수만 실제 값입니다.',
        invalidJson: 'JSON을 해석할 수 없습니다: {message}',
        invalidSpec: '요청을 구성할 수 없습니다: {message}',
        unavailable: '미지원',
        reasons: {
            'artifact-no-chat-template': 'artifact에 chat template 없음',
            'template-ignores-field': '템플릿이 이 필드를 무시함',
            'template-rejects-input': '템플릿이 이 입력을 거부함',
            'gateway-not-configured': 'gateway 미연동',
            'catalog-has-no-rate': '카탈로그에 단가 없음',
            'heuristic-engine': '휴리스틱 폴백',
            'runtime-not-exposed': 'runtime이 노출하지 않음',
            'not-computed': '계산되지 않음',
            'not-provided': '제공되지 않음',
            unsupported: '지원하지 않음',
        },
        caps: {
            chatTemplate: 'chat template', addGenerationPrompt: '생성 프롬프트', tools: 'tools',
            documents: 'documents', systemRole: 'system', assistantRole: 'assistant', toolRole: 'tool',
        },
        roles: { system: 'system', user: 'user', assistant: 'assistant', tool: 'tool' },
    },
    en: {
        tab: 'Request Lab',
        composerTitle: 'Request composer',
        composerNote: 'Messages, tool schemas, and documents are serialized with the real artifact chat template. Raw input never leaves the browser.',
        addMessage: 'Add message',
        removeMessage: 'Remove',
        roleLabel: 'Role',
        contentLabel: 'Content',
        generationPrompt: 'Add generation prompt',
        toolsLabel: 'tools (JSON array)',
        documentsLabel: 'documents (JSON array)',
        structureTitle: 'Structure and overhead',
        contextTitle: 'Context budget',
        costTitle: 'Cost scenario',
        templateSummary: 'Show serialized output',
        templateScrollLabel: 'Chat template serialization scroll area',
        rawTokens: 'Content only',
        templateTokens: 'With template',
        overheadTokens: 'Structure overhead',
        segmentsTitle: 'Cumulative segments',
        colSegment: 'Segment', colTokens: 'Tokens', colCumulative: 'Cumulative', colCache: 'Fixed-prefix candidate',
        yes: 'Yes', no: 'No',
        duplicationSafe: 'Re-tokenizing the serialized output adds no duplicate special tokens.',
        duplicationWarn: 'Adding special tokens to the serialized output would duplicate {n} of them. Tokenize the template string with add_special_tokens=false.',
        providerTitle: 'Provider counts',
        preflight: 'Preflight', actual: 'Actual usage',
        notConfigured: 'Not configured',
        unsupportedTitle: 'Not supported for this request',
        reservedOutput: 'Output reserve', reservedReasoning: 'Reasoning reserve',
        contextWindow: 'Artifact context', inputBudget: 'Input budget', inputTokens: 'Input tokens', headroom: 'Headroom',
        cachePrefix: 'Fixed prefix', dynamicSuffix: 'Dynamic suffix',
        truncationWarn: 'The input budget is exceeded by {n} tokens at {id}. The real truncation point depends on provider policy.',
        replay: 'Sending {turns} user turns as separate requests replays {tokens} input tokens in total. No caching or server-side state is assumed.',
        costModel: 'Rate model', callsPerDay: 'Calls per day',
        appliedRate: 'Applied rate', perCall: 'Per call', perDay: 'Per day', perMonth: 'Per month',
        tierBase: 'Base tier', tierHigh: 'Long-context tier',
        countSemantics: 'These rates come from a provider API while the token counts come from a local artifact. The two tokenizers are not claimed to match.',
        excludedTitle: 'Excluded from this cost',
        pricingAsOf: 'Rates as of',
        engineUnavailable: 'A real artifact must load before a request structure can be reproduced.',
        noTemplate: 'This artifact has no chat template. Only the content token count is a real value.',
        invalidJson: 'The JSON could not be parsed: {message}',
        invalidSpec: 'The request could not be built: {message}',
        unavailable: 'Unavailable',
        reasons: {
            'artifact-no-chat-template': 'the artifact has no chat template',
            'template-ignores-field': 'the template ignores this field',
            'template-rejects-input': 'the template rejects this input',
            'gateway-not-configured': 'no gateway is configured',
            'catalog-has-no-rate': 'the catalog has no rate',
            'heuristic-engine': 'heuristic fallback',
            'runtime-not-exposed': 'the runtime does not expose it',
            'not-computed': 'not computed',
            'not-provided': 'not provided',
            unsupported: 'unsupported',
        },
        caps: {
            chatTemplate: 'chat template', addGenerationPrompt: 'generation prompt', tools: 'tools',
            documents: 'documents', systemRole: 'system', assistantRole: 'assistant', toolRole: 'tool',
        },
        roles: { system: 'system', user: 'user', assistant: 'assistant', tool: 'tool' },
    },
});

let onSpecChange = null;

function copy() {
    return COPY[state.lang] || COPY.ko;
}

function reasonText(reason) {
    if (!reason) return '';
    return copy().reasons[reason] || reason;
}

function format(template, values) {
    return Object.entries(values).reduce(
        (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
        template,
    );
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function metric(parent, label, value, evidence = 'derived') {
    const box = element('div', 'request-metric');
    box.dataset.evidence = evidence;
    box.append(element('span', null, label), element('strong', null, value));
    parent.append(box);
    return box;
}

function measurementText(measure) {
    if (measure.tokenCount === null) return `${copy().unavailable} (${reasonText(measure.unavailableReason)})`;
    return formatInt(measure.tokenCount);
}

function valueText(entry, suffix = '') {
    if (entry.value === null) return `${copy().unavailable} (${reasonText(entry.unavailableReason)})`;
    return formatInt(entry.value) + suffix;
}

// ── composer ────────────────────────────────────────────────────────────────

function renderMessages() {
    const container = clear(el('requestMessages'));
    const text = copy();

    state.requestSpec.messages.forEach((message, index) => {
        const row = element('div', 'request-message');

        const select = document.createElement('select');
        select.setAttribute('aria-label', `${text.roleLabel} ${index + 1}`);
        for (const role of REQUEST_ROLES) {
            const option = document.createElement('option');
            option.value = role;
            option.textContent = text.roles[role];
            if (role === message.role) option.selected = true;
            select.append(option);
        }
        select.addEventListener('change', () => {
            state.requestSpec.messages[index].role = select.value;
            notify();
        });

        const area = document.createElement('textarea');
        area.rows = 2;
        area.spellcheck = false;
        area.value = message.content;
        area.setAttribute('aria-label', `${text.contentLabel} ${index + 1} (${text.roles[message.role]})`);
        area.addEventListener('input', () => {
            state.requestSpec.messages[index].content = area.value;
            notify();
        });

        const remove = element('button', 'view-tab', '✕');
        remove.type = 'button';
        remove.setAttribute('aria-label', `${text.removeMessage} ${index + 1}`);
        remove.disabled = state.requestSpec.messages.length <= 1;
        remove.addEventListener('click', () => {
            state.requestSpec.messages.splice(index, 1);
            renderMessages();
            notify();
        });

        row.append(select, area, remove);
        container.append(row);
    });
}

function notify() {
    if (onSpecChange) onSpecChange();
    else renderRequestLab();
}

function parseJsonArray(id, fallbackMessage) {
    const node = el(id);
    const raw = node.value.trim();
    if (raw === '') {
        node.removeAttribute('aria-invalid');
        return { ok: true, value: [] };
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('expected an array');
        node.removeAttribute('aria-invalid');
        return { ok: true, value: parsed };
    } catch (error) {
        node.setAttribute('aria-invalid', 'true');
        return { ok: false, message: `${fallbackMessage} — ${format(copy().invalidJson, { message: error.message })}` };
    }
}

function readSpec() {
    const tools = parseJsonArray('requestTools', 'tools');
    const documents = parseJsonArray('requestDocuments', 'documents');
    const errors = [tools, documents].filter((item) => !item.ok).map((item) => item.message);

    const candidate = {
        messages: state.requestSpec.messages
            .filter((message) => message.content.trim() !== '')
            .map((message) => ({ role: message.role, content: message.content })),
        tools: tools.ok ? tools.value : [],
        documents: documents.ok ? documents.value : [],
        addGenerationPrompt: el('optionAddGenerationPrompt').checked,
    };
    if (candidate.messages.length === 0) {
        return { ok: false, errors: [format(copy().invalidSpec, { message: 'messages' })] };
    }
    try {
        return { ok: errors.length === 0, spec: normalizeRequestSpec(candidate), errors };
    } catch (error) {
        return { ok: false, errors: [...errors, format(copy().invalidSpec, { message: error.message })] };
    }
}

// ── structure ───────────────────────────────────────────────────────────────

function renderOverhead(result) {
    const box = clear(el('requestOverhead'));
    const text = copy();
    metric(box, text.rawTokens, measurementText(result.raw), result.raw.evidence);
    metric(box, text.templateTokens, measurementText(result.template), result.template.evidence);
    metric(
        box,
        text.overheadTokens,
        result.overhead.tokens === null
            ? `${text.unavailable} (${reasonText(result.overhead.unavailableReason)})`
            : `+${formatInt(result.overhead.tokens)}${result.overhead.ratio === null ? '' : ` (×${result.overhead.ratio.toFixed(2)})`}`,
        result.overhead.evidence,
    );
}

function renderDuplication(result) {
    const node = clear(el('requestDuplication'));
    const text = copy();
    if (!result.specialTokenDuplication.checked) {
        node.dataset.kind = 'note';
        node.textContent = `${text.unavailable} (${reasonText(result.specialTokenDuplication.unavailableReason)})`;
        return;
    }
    const duplicated = result.specialTokenDuplication.duplicatedTokens;
    node.dataset.kind = duplicated > 0 ? 'warning' : 'note';
    node.textContent = duplicated > 0
        ? format(text.duplicationWarn, { n: duplicated })
        : text.duplicationSafe;
}

function renderCapabilities(result) {
    const box = clear(el('requestCapabilities'));
    const text = copy();
    for (const [name, capability] of Object.entries(result.capabilities)) {
        const chip = element(
            'span',
            'request-cap',
            capability.available
                ? text.caps[name]
                : `${text.caps[name]}: ${reasonText(capability.unavailableReason)}`,
        );
        chip.dataset.available = String(capability.available);
        box.append(chip);
    }
}

function renderTemplateText(result) {
    const node = el('requestTemplateText');
    node.setAttribute('aria-label', copy().templateScrollLabel);
    node.textContent = result.templateText === null
        ? `${copy().unavailable} (${reasonText(result.template.unavailableReason)})`
        : result.templateText;
}

function renderSegments(timeline) {
    const box = clear(el('requestSegments'));
    const text = copy();
    box.append(element('h3', 'p1-subheading', text.segmentsTitle));

    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const label of [text.colSegment, text.colTokens, text.colCumulative, text.colCache]) {
        head.append(element('th', null, label));
    }
    table.append(head);

    for (const step of timeline.steps) {
        const row = document.createElement('tr');
        row.dataset.overflow = String(step.overflow);
        row.append(element('td', null, step.label));
        const tokens = element('td', 'num', step.tokens === null
            ? `${text.unavailable} (${reasonText(step.unavailableReason)})`
            : formatInt(step.tokens));
        const cumulative = element('td', 'num', step.cumulative === null ? '—' : formatInt(step.cumulative));
        row.append(tokens, cumulative, element('td', null, step.cachePrefixCandidate ? text.yes : text.no));
        table.append(row);
    }
    if (timeline.steps.length > 0) box.append(table);
}

function renderProviderSlots(result) {
    const box = clear(el('requestProviderSlots'));
    const text = copy();
    for (const [slot, label] of [['preflight', text.preflight], ['actual', text.actual]]) {
        const entry = result.providerCounts[slot];
        metric(
            box,
            `${text.providerTitle} · ${label}`,
            entry.tokenCount === null
                ? `${text.notConfigured} (${reasonText(entry.unavailableReason)})`
                : formatInt(entry.tokenCount),
            entry.evidence,
        );
    }
}

function renderUnsupported(result) {
    const box = clear(el('requestUnsupported'));
    if (result.unsupported.length === 0) return;
    const text = copy();
    box.append(element('strong', null, text.unsupportedTitle));
    const list = document.createElement('ul');
    for (const item of result.unsupported) {
        const entry = document.createElement('li');
        entry.append(element('code', null, item.field), document.createTextNode(` — ${reasonText(item.reason)}`));
        list.append(entry);
    }
    box.append(list);
}

// ── context ─────────────────────────────────────────────────────────────────

function renderBudget(timeline) {
    const box = clear(el('requestBudget'));
    const text = copy();
    metric(box, text.contextWindow, valueText(timeline.contextWindow), timeline.contextWindow.evidence);
    metric(box, text.inputBudget, valueText(timeline.inputBudget), timeline.inputBudget.evidence);
    metric(box, text.inputTokens, valueText(timeline.inputTokens), timeline.inputTokens.evidence);
    metric(box, text.headroom, valueText(timeline.headroom), timeline.headroom.evidence);
    metric(box, text.cachePrefix, valueText(timeline.cachePrefix), timeline.cachePrefix.evidence);
    metric(box, text.dynamicSuffix, valueText(timeline.dynamicSuffix), timeline.dynamicSuffix.evidence);
}

function renderTimeline(timeline) {
    const box = clear(el('requestTimeline'));
    const text = copy();
    const budget = timeline.inputBudget.value;

    for (const step of timeline.steps) {
        const row = element('div', 'request-step');
        row.dataset.cache = String(step.cachePrefixCandidate);
        row.dataset.overflow = String(step.overflow);
        row.dataset.unavailable = String(step.cumulative === null);

        row.append(element('div', 'request-step-label', step.label));
        row.append(element('div', null, step.cumulative === null ? '—' : formatInt(step.cumulative)));

        const bar = element('div', 'request-step-bar');
        if (step.cumulative !== null && budget) {
            const fill = element('span', 'request-step-fill');
            fill.style.width = `${Math.min(100, (step.cumulative / budget) * 100)}%`;
            bar.append(fill);
        }
        row.append(bar);
        box.append(row);
    }

    if (timeline.truncation.predicted) {
        const warn = element('div', 'request-note');
        warn.dataset.kind = 'warning';
        warn.textContent = format(text.truncationWarn, {
            id: timeline.truncation.atSegmentId,
            n: formatInt(timeline.truncation.overflowTokens),
        });
        box.append(warn);
    }
}

function renderReplay(segments) {
    const node = clear(el('requestReplay'));
    const replay = estimateConversationReplay(segments);
    node.dataset.kind = 'note';
    node.textContent = format(copy().replay, {
        turns: replay.turns,
        tokens: valueText(replay.replayTokens),
    });
}

// ── cost ────────────────────────────────────────────────────────────────────

function buildCostSelect() {
    const select = el('requestCostModel');
    if (select.options.length > 0) return;
    let group = null;
    let provider = null;
    for (const entry of PRICING) {
        if (entry.provider !== provider) {
            provider = entry.provider;
            group = document.createElement('optgroup');
            group.label = provider;
            select.append(group);
        }
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name;
        group.append(option);
    }
    select.value = state.requestCostModelId;
}

function renderCost(timeline) {
    const box = clear(el('requestCost'));
    const excludedBox = clear(el('requestCostExcluded'));
    const text = copy();

    const entry = PRICING.find((item) => item.id === state.requestCostModelId);
    if (!entry) return;

    const inputTokens = timeline.inputTokens.value;
    if (inputTokens === null) {
        box.append(element('div', 'request-note', `${text.unavailable} (${reasonText(timeline.inputTokens.unavailableReason)})`));
        return;
    }

    const scenario = computeCostScenario({
        entry,
        inputTokens,
        outputTokens: state.requestReservedOutput,
        callsPerDay: state.requestCallsPerDay,
        at: today(),
        pricingVerifiedAt: PRICING_AS_OF,
        countSemantics: PRICING_CATALOG.countSemantics,
    });

    const badges = element('div', 'request-caps');
    const lifecycle = element('span', 'request-badge', `${scenario.schedule.status}${scenario.schedule.warningLevel ? ` · ${scenario.schedule.warningLevel}` : ''}`);
    lifecycle.dataset.status = scenario.schedule.warningLevel || scenario.schedule.status;
    const freshness = element('span', 'request-badge', `${text.pricingAsOf} ${scenario.freshness.verifiedAt} · ${scenario.freshness.status}`);
    freshness.dataset.status = scenario.freshness.status;
    badges.append(lifecycle, freshness);
    box.append(badges);

    const grid = element('div', 'request-budget');
    metric(
        grid,
        text.appliedRate,
        `${scenario.appliedRate.tier === 'high' ? text.tierHigh : text.tierBase} · $${scenario.appliedRate.input}/$${scenario.appliedRate.output} per 1M`,
        'authoritative',
    );
    const money = (amount) => (amount.value === null
        ? `${text.unavailable} (${reasonText(amount.unavailableReason)})`
        : formatUSD(amount.value));
    metric(grid, text.perCall, money(scenario.perCall.total), scenario.perCall.total.evidence);
    metric(grid, text.perDay, money(scenario.perDay.total), scenario.perDay.total.evidence);
    metric(grid, text.perMonth, money(scenario.perMonth.total), scenario.perMonth.total.evidence);
    box.append(grid);

    const semantics = element('div', 'request-note', text.countSemantics);
    semantics.dataset.kind = 'note';
    box.append(semantics);

    excludedBox.append(element('strong', null, text.excludedTitle));
    const list = document.createElement('ul');
    for (const item of scenario.excluded) {
        const node = document.createElement('li');
        node.append(element('code', null, item.item), document.createTextNode(` — ${reasonText(item.reason)}`));
        list.append(node);
    }
    excludedBox.append(list);
}

// ── entry points ────────────────────────────────────────────────────────────

export function applyRequestLabLanguage() {
    const text = copy();
    el('tabRequest').textContent = text.tab;
    el('requestComposerTitle').textContent = text.composerTitle;
    el('requestComposerNote').textContent = text.composerNote;
    el('requestAddMessage').textContent = text.addMessage;
    el('labelAddGenerationPrompt').textContent = text.generationPrompt;
    el('labelRequestTools').textContent = text.toolsLabel;
    el('labelRequestDocuments').textContent = text.documentsLabel;
    el('requestStructureTitle').textContent = text.structureTitle;
    el('requestContextTitle').textContent = text.contextTitle;
    el('requestCostTitle').textContent = text.costTitle;
    el('requestTemplateSummary').textContent = text.templateSummary;
    el('labelReservedOutput').textContent = text.reservedOutput;
    el('labelReservedReasoning').textContent = text.reservedReasoning;
    el('labelRequestCostModel').textContent = text.costModel;
    el('labelRequestCalls').textContent = text.callsPerDay;
    renderMessages();
}

export function initRequestLab(onChange) {
    onSpecChange = onChange || null;

    el('requestTools').value = JSON.stringify(state.requestSpec.tools, null, 1);
    el('requestDocuments').value = JSON.stringify(state.requestSpec.documents, null, 1);
    el('optionAddGenerationPrompt').checked = state.requestSpec.addGenerationPrompt;
    el('requestReservedOutput').value = String(state.requestReservedOutput);
    el('requestReservedReasoning').value = String(state.requestReservedReasoning);
    el('requestCallsPerDay').value = String(state.requestCallsPerDay);
    buildCostSelect();

    el('requestAddMessage').addEventListener('click', () => {
        if (state.requestSpec.messages.length >= REQUEST_LIMITS.maxMessages) return;
        state.requestSpec.messages.push({ role: 'user', content: '' });
        renderMessages();
        notify();
    });
    for (const id of ['requestTools', 'requestDocuments', 'optionAddGenerationPrompt']) {
        el(id).addEventListener('input', notify);
        el(id).addEventListener('change', notify);
    }
    const numbers = {
        requestReservedOutput: 'requestReservedOutput',
        requestReservedReasoning: 'requestReservedReasoning',
        requestCallsPerDay: 'requestCallsPerDay',
    };
    for (const id of Object.keys(numbers)) {
        el(id).addEventListener('input', () => {
            const parsed = Number.parseInt(el(id).value, 10);
            const min = id === 'requestCallsPerDay' ? 1 : 0;
            state[numbers[id]] = Number.isSafeInteger(parsed) && parsed >= min ? parsed : min;
            notify();
        });
    }
    el('requestCostModel').addEventListener('change', () => {
        state.requestCostModelId = el('requestCostModel').value;
        notify();
    });

    renderMessages();
}

export function renderRequestLab() {
    const text = copy();
    const status = el('requestSpecStatus');
    const parsed = readSpec();

    if (!parsed.spec) {
        status.dataset.kind = 'error';
        status.textContent = parsed.errors.join(' · ');
        return null;
    }
    const artifact = MODELS.find((model) => model.id === state.currentModelId) || null;
    const result = state.currentTok
        ? analyzeRequestWithTemplate({
              tok: state.currentTok,
              spec: parsed.spec,
              modelId: state.currentModelId,
              revision: artifact ? artifact.revision : 'unknown',
              requestId: `request-${Date.now()}`,
              createdAt: new Date().toISOString(),
          })
        : unavailableRequestAnalysis({
              spec: parsed.spec,
              modelId: state.currentModelId,
              requestId: `request-${Date.now()}`,
              createdAt: new Date().toISOString(),
              reason: 'heuristic-engine',
          });

    const timeline = buildContextTimeline({
        segments: result.segments,
        contextWindow: artifact ? artifact.context : null,
        reservedOutputTokens: Math.min(state.requestReservedOutput, artifact ? artifact.context - 1 : state.requestReservedOutput),
        reservedReasoningTokens: state.requestReservedReasoning,
    });

    renderOverhead(result);
    renderDuplication(result);
    renderCapabilities(result);
    renderTemplateText(result);
    renderSegments(timeline);
    renderProviderSlots(result);
    renderUnsupported(result);
    renderBudget(timeline);
    renderTimeline(timeline);
    renderReplay(result.segments);
    renderCost(timeline);

    // 입력 오류가 artifact 안내 문구에 덮이지 않도록 오류를 먼저 놓고 함께 보여준다.
    const notes = [];
    if (!state.currentTok) notes.push(text.engineUnavailable);
    else if (!result.capabilities.chatTemplate.available) notes.push(text.noTemplate);

    if (parsed.errors.length > 0) {
        status.dataset.kind = 'error';
        status.textContent = [...parsed.errors, ...notes].join(' · ');
    } else {
        status.dataset.kind = 'note';
        status.textContent = notes.length > 0 ? notes.join(' · ') : text.composerNote;
    }
    return result;
}
