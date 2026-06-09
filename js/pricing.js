// pricing.js — 주요 LLM API 토큰 가격 카탈로그
// 기준일: 2026-06-08 (가격은 수시 변동 — 실제 청구 전 각 공식 페이지 재확인)
// 단위: USD per 1,000,000 tokens (input/output 분리)
// 출처:
//   OpenAI    — developers.openai.com/api/docs/pricing
//   Google    — ai.google.dev/gemini-api/docs/pricing (페이지 갱신 2026-06-02)
//   Anthropic — platform.claude.com (claude-api 스킬 캐시 2026-05-26)
// tiered: 프롬프트 토큰이 threshold 초과 시 상위 단가 적용(긴 컨텍스트). 시뮬레이터 입력은 보통 저티어.

export const PRICING_AS_OF = '2026-06-08';

export const PRICING = [
  // ── OpenAI (ChatGPT) ──
  { provider: 'OpenAI', name: 'GPT-5.5',        id: 'gpt-5.5',        input: 5.00,  output: 30.00,  context: 1_050_000 },
  { provider: 'OpenAI', name: 'GPT-5.5 Pro',    id: 'gpt-5.5-pro',    input: 30.00, output: 180.00, context: 1_050_000 },
  { provider: 'OpenAI', name: 'GPT-5.4',        id: 'gpt-5.4',        input: 2.50,  output: 15.00,  context: 1_050_000 },
  { provider: 'OpenAI', name: 'GPT-5.4 mini',   id: 'gpt-5.4-mini',   input: 0.75,  output: 4.50,   context: 1_050_000 },
  { provider: 'OpenAI', name: 'GPT-5.4 nano',   id: 'gpt-5.4-nano',   input: 0.20,  output: 1.25,   context: 400_000 },
  { provider: 'OpenAI', name: 'GPT-4.1',        id: 'gpt-4.1',        input: 2.00,  output: 8.00,   context: 1_047_576 },
  { provider: 'OpenAI', name: 'GPT-4.1 mini',   id: 'gpt-4.1-mini',   input: 0.40,  output: 1.60,   context: 1_047_576 },
  { provider: 'OpenAI', name: 'GPT-4o',         id: 'gpt-4o',         input: 2.50,  output: 10.00,  context: 128_000 },
  { provider: 'OpenAI', name: 'GPT-4o mini',    id: 'gpt-4o-mini',    input: 0.15,  output: 0.60,   context: 128_000 },
  { provider: 'OpenAI', name: 'o3',             id: 'o3',             input: 2.00,  output: 8.00,   context: 200_000 },
  { provider: 'OpenAI', name: 'o4-mini',        id: 'o4-mini',        input: 1.10,  output: 4.40,   context: 200_000 },

  // ── Google (Gemini) ──
  { provider: 'Google', name: 'Gemini 3.5 Flash',      id: 'gemini-3.5-flash',       input: 1.50, output: 9.00,  context: 1_048_576 },
  { provider: 'Google', name: 'Gemini 3.1 Pro',        id: 'gemini-3.1-pro-preview', input: 2.00, output: 12.00, context: 1_048_576, tiered: { threshold: 200_000, input: 4.00, output: 18.00 } },
  { provider: 'Google', name: 'Gemini 3.1 Flash-Lite', id: 'gemini-3.1-flash-lite',  input: 0.25, output: 1.50,  context: 1_048_576 },
  { provider: 'Google', name: 'Gemini 3 Flash',        id: 'gemini-3-flash-preview', input: 0.50, output: 3.00,  context: 1_048_576 },
  { provider: 'Google', name: 'Gemini 2.5 Pro',        id: 'gemini-2.5-pro',         input: 1.25, output: 10.00, context: 1_048_576, tiered: { threshold: 200_000, input: 2.50, output: 15.00 } },
  { provider: 'Google', name: 'Gemini 2.5 Flash',      id: 'gemini-2.5-flash',       input: 0.30, output: 2.50,  context: 1_048_576 },
  { provider: 'Google', name: 'Gemini 2.5 Flash-Lite', id: 'gemini-2.5-flash-lite',  input: 0.10, output: 0.40,  context: 1_048_576 },

  // ── Anthropic (Claude) ──
  { provider: 'Anthropic', name: 'Claude Opus 4.8',   id: 'claude-opus-4-8',   input: 5.00, output: 25.00, context: 1_000_000 },
  { provider: 'Anthropic', name: 'Claude Opus 4.7',   id: 'claude-opus-4-7',   input: 5.00, output: 25.00, context: 1_000_000 },
  { provider: 'Anthropic', name: 'Claude Sonnet 4.6', id: 'claude-sonnet-4-6', input: 3.00, output: 15.00, context: 1_000_000 },
  { provider: 'Anthropic', name: 'Claude Haiku 4.5',  id: 'claude-haiku-4-5',  input: 1.00, output: 5.00,  context: 200_000 },
];

// 입력 토큰 수에 대한 단가 선택 (tiered 반영)
export function ratesFor(entry, tokens) {
  if (entry.tiered && tokens > entry.tiered.threshold) {
    return { input: entry.tiered.input, output: entry.tiered.output, tier: 'high' };
  }
  return { input: entry.input, output: entry.output, tier: 'base' };
}

// 토큰 수 → USD
export function costOf(pricePerMillion, tokens) {
  return (tokens / 1_000_000) * pricePerMillion;
}

// 비용 표기 포맷
export function formatUSD(usd) {
  if (usd === 0) return '$0';
  if (usd < 0.000001) return '<$0.000001';
  if (usd < 0.01) return '$' + usd.toFixed(6);
  if (usd < 1) return '$' + usd.toFixed(4);
  return '$' + usd.toFixed(2);
}

// 천단위 구분
export function formatInt(n) {
  return n.toLocaleString('en-US');
}
