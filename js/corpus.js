// corpus.js — P3 말뭉치 계약. 내장 말뭉치와 사용자 정의 문장 묶음을 같은 형태로 다룬다.
import { measureText } from './unicodeMetrics.js';

export const CORPUS_SCHEMA_VERSION = 1;

export const CORPUS_LIMITS = Object.freeze({
    maxSamples: 60,
    maxTextCodePoints: 2_000,
    maxTotalCodePoints: 40_000,
    maxNameLength: 64,
    maxTagLength: 32,
});

// 언어 태그는 BCP-47 primary subtag 형태만 허용하고, 알 수 없으면 'und'를 쓴다.
const LANGUAGE_PATTERN = /^(?:[a-z]{2,3}|und)(?:-[A-Za-z0-9]{2,8})*$/;
const DOMAIN_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// 사용자 입력 줄 앞에 붙일 수 있는 선택적 태그 접두사: [ko,prose] 본문
const LINE_TAG_PATTERN = /^\[([^,\]]*)(?:,([^\]]*))?\]\s*/;

function fail(path, message) {
    throw new TypeError(path + ': ' + message);
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(value, allowed, path) {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!allowedSet.has(key)) fail(path + '.' + key, 'unknown field');
    }
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

export function normalizeCorpusSample(value, path = 'sample') {
    if (!isPlainObject(value)) fail(path, 'expected a plain object');
    // 이미 정규화된 표본을 다시 넣어도 같은 결과가 나오도록 파생 필드를 허용한다.
    assertKnownKeys(value, ['id', 'text', 'language', 'domain', 'codePointLength', 'utf8ByteLength'], path);

    if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) {
        fail(`${path}.id`, 'expected a lowercase slug of 1 to 64 characters');
    }
    if (typeof value.text !== 'string' || value.text.trim() === '') {
        fail(`${path}.text`, 'expected a non-empty string');
    }
    const metrics = measureText(value.text);
    if (metrics.codePoints > CORPUS_LIMITS.maxTextCodePoints) {
        fail(`${path}.text`, `must not exceed ${CORPUS_LIMITS.maxTextCodePoints} code points`);
    }
    // 파생 필드는 항상 다시 계산하고, 들어온 값과 다르면 조용히 덮지 않고 거부한다.
    for (const [key, computed] of [['codePointLength', metrics.codePoints], ['utf8ByteLength', metrics.utf8Bytes]]) {
        if (hasOwn(value, key) && value[key] !== computed) {
            fail(`${path}.${key}`, `must equal the measured value ${computed}`);
        }
    }

    const language = hasOwn(value, 'language') ? value.language : 'und';
    if (typeof language !== 'string' || !LANGUAGE_PATTERN.test(language)
        || language.length > CORPUS_LIMITS.maxTagLength) {
        fail(`${path}.language`, 'expected a BCP-47 primary subtag or und');
    }
    const domain = hasOwn(value, 'domain') ? value.domain : 'prose';
    if (typeof domain !== 'string' || !DOMAIN_PATTERN.test(domain)) {
        fail(`${path}.domain`, 'expected a lowercase domain tag');
    }

    return {
        id: value.id,
        text: value.text,
        language,
        domain,
        codePointLength: metrics.codePoints,
        utf8ByteLength: metrics.utf8Bytes,
    };
}

export function normalizeCorpus(value, path = 'corpus') {
    if (!isPlainObject(value)) fail(path, 'expected a plain object');
    assertKnownKeys(value, ['schemaVersion', 'id', 'name', 'source', 'samples'], path);
    if (hasOwn(value, 'schemaVersion') && value.schemaVersion !== CORPUS_SCHEMA_VERSION) {
        fail(`${path}.schemaVersion`, `expected ${CORPUS_SCHEMA_VERSION}`);
    }
    if (typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) {
        fail(`${path}.id`, 'expected a lowercase slug of 1 to 64 characters');
    }
    if (typeof value.name !== 'string' || value.name.trim() === ''
        || value.name.length > CORPUS_LIMITS.maxNameLength) {
        fail(`${path}.name`, `expected 1 to ${CORPUS_LIMITS.maxNameLength} characters`);
    }
    const source = hasOwn(value, 'source') ? value.source : 'builtin';
    if (source !== 'builtin' && source !== 'user') {
        fail(`${path}.source`, 'expected builtin or user');
    }

    if (!Array.isArray(value.samples)) fail(`${path}.samples`, 'expected an array');
    if (value.samples.length === 0) fail(`${path}.samples`, 'expected at least one sample');
    if (value.samples.length > CORPUS_LIMITS.maxSamples) {
        fail(`${path}.samples`, `must not exceed ${CORPUS_LIMITS.maxSamples} samples`);
    }

    const samples = value.samples.map((item, index) => normalizeCorpusSample(item, `${path}.samples[${index}]`));
    const ids = new Set();
    let total = 0;
    for (const sample of samples) {
        if (ids.has(sample.id)) fail(`${path}.samples`, `duplicate sample id: ${sample.id}`);
        ids.add(sample.id);
        total += sample.codePointLength;
    }
    if (total > CORPUS_LIMITS.maxTotalCodePoints) {
        fail(`${path}.samples`, `total text must not exceed ${CORPUS_LIMITS.maxTotalCodePoints} code points`);
    }

    return {
        schemaVersion: CORPUS_SCHEMA_VERSION,
        id: value.id,
        name: value.name,
        source,
        samples,
    };
}

/**
 * 사용자 입력 줄을 말뭉치로 바꾼다. 각 줄이 하나의 표본이며
 * `[ko,prose] 본문`처럼 선택적 태그 접두사를 붙일 수 있다.
 */
export function parseCorpusLines(text, {
    id = 'user-corpus',
    name = 'User corpus',
    defaultLanguage = 'und',
    defaultDomain = 'prose',
} = {}) {
    if (typeof text !== 'string') fail('text', 'expected a string');

    const samples = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed === '') return;

        let language = defaultLanguage;
        let domain = defaultDomain;
        let body = trimmed;

        const match = trimmed.match(LINE_TAG_PATTERN);
        if (match) {
            const rawLanguage = (match[1] || '').trim();
            const rawDomain = (match[2] || '').trim();
            if (rawLanguage !== '') language = rawLanguage;
            if (rawDomain !== '') domain = rawDomain;
            body = trimmed.slice(match[0].length).trim();
        }
        if (body === '') fail(`line ${index + 1}`, 'has tags but no text');

        samples.push(normalizeCorpusSample(
            { id: `line-${index + 1}`, text: body, language, domain },
            `line ${index + 1}`,
        ));
    });

    if (samples.length === 0) fail('text', 'expected at least one non-empty line');
    return normalizeCorpus({ id, name, source: 'user', samples });
}

function sample(id, language, domain, text) {
    return { id, text, language, domain };
}

export const BUILTIN_CORPORA = Object.freeze([
    normalizeCorpus({
        id: 'language-mix',
        name: 'Language mix',
        samples: [
            sample('ko-prose', 'ko', 'prose', '인공지능은 세상을 빠르게 바꾸고 있습니다.'),
            sample('en-prose', 'en', 'prose', 'Artificial intelligence is rapidly changing the world.'),
            sample('ja-prose', 'ja', 'prose', '人工知能は世界を急速に変えています。'),
            sample('zh-prose', 'zh', 'prose', '人工智能正在迅速改变世界。'),
            sample('es-prose', 'es', 'prose', 'La inteligencia artificial está cambiando rápidamente el mundo.'),
            sample('ar-prose', 'ar', 'prose', 'الذكاء الاصطناعي يغير العالم بسرعة.'),
            sample('ru-prose', 'ru', 'prose', 'Искусственный интеллект быстро меняет мир.'),
            sample('hi-prose', 'hi', 'prose', 'कृत्रिम बुद्धिमत्ता दुनिया को तेज़ी से बदल रही है।'),
        ],
    }),
    normalizeCorpus({
        id: 'domain-mix',
        name: 'Domain mix',
        samples: [
            sample('en-code', 'und', 'code', 'for (let i = 0; i < n; i++) { sum += arr[i]; }'),
            sample('py-code', 'und', 'code', 'def add(a: int, b: int) -> int:\n    return a + b'),
            sample('json-data', 'und', 'structured-data', '{"id":42,"tags":["a","b"],"ok":true}'),
            sample('md-markup', 'en', 'markup', '# Title\n\n- item one\n- item two\n\n`inline code`'),
            sample('url-link', 'und', 'url', 'https://example.com/path?query=value&id=42#section'),
            sample('symbols', 'und', 'symbols', '①②③ ™®© ½¼¾ €£¥₩ →←↑↓ ∑∏∫'),
            sample('emoji', 'und', 'emoji', '🤗🚀🌍🔥✨🎉👍💡🧠⚡'),
            sample('log-line', 'en', 'log', '2026-08-25T10:15:00Z ERROR worker=3 retry=2 msg="timeout after 30s"'),
            sample('ko-chat', 'ko', 'chat', '안녕하세요! 오늘 회의 몇 시였죠? ㅋㅋ 확인 부탁드려요 🙏'),
            sample('long-word', 'en', 'prose', 'Pneumonoultramicroscopicsilicovolcanoconiosis'),
        ],
    }),
]);

export function findCorpus(corpusId, extra = []) {
    return [...BUILTIN_CORPORA, ...extra].find((corpus) => corpus.id === corpusId) || null;
}

export function corpusLanguages(corpus) {
    return [...new Set(corpus.samples.map((item) => item.language))].sort();
}

export function corpusDomains(corpus) {
    return [...new Set(corpus.samples.map((item) => item.domain))].sort();
}

export function filterCorpus(corpus, { languages = null, domains = null } = {}) {
    const samples = corpus.samples.filter((item) => (
        (languages === null || languages.includes(item.language))
        && (domains === null || domains.includes(item.domain))
    ));
    return { ...corpus, samples };
}
