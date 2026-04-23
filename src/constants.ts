// Curated SOTA lineup (April 2026), grouped by tier.
// Default is the mid-tier workhorse — swap in the fast one when latency matters
// or the top one when you need deep reasoning.
export const MODELS = [
  // ── Top tier — deep reasoning, agent planning, hard coding ──
  { id: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7' },
  { id: 'openai/gpt-5.4-pro', label: 'GPT-5.4 Pro' },
  { id: 'x-ai/grok-4.20', label: 'Grok 4.20' },

  // ── Mid tier — balanced daily driver ──
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { id: 'openai/gpt-5.4', label: 'GPT-5.4' },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },

  // ── Fast tier — cheap, low-latency, good-enough ──
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
  { id: 'openai/gpt-5.4-nano', label: 'GPT-5.4 Nano' },
  { id: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite' },
  { id: 'x-ai/grok-4.1-fast', label: 'Grok 4.1 Fast' },
];

// Sonnet 4.6 — best $/quality trade-off for day-to-day work.
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';
