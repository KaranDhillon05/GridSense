// Centralized LLM provider config.
//
// All three call sites (AI playbook, Copilot tool-loop, routing ops-brief) speak
// the OpenAI-compatible chat-completions format, so we can swap providers by URL
// + model + key alone. We pick the provider by whichever API key is present, in
// order of free-tier generosity:
//   1. Google Gemini   — very high free limits (1M tokens/min), OpenAI-compatible
//                         endpoint, supports tools + JSON mode.
//   2. Cerebras        — free, fast, same Llama-3.3-70B model, supports tools.
//   3. Groq (fallback) — only 100k tokens/DAY on the free tier (the bottleneck).
//
// Set GEMINI_API_KEY (recommended) or CEREBRAS_API_KEY in the environment to use
// a higher-limit provider; the app falls back to GROQ_API_KEY automatically.
// Override the model per provider with LLM_MODEL.

export type LlmConfig = {
  provider: "gemini" | "cerebras" | "groq";
  url: string;
  model: string;
  key?: string;
  /** Extra request-body params for this provider (spread into every call). */
  extraBody: Record<string, unknown>;
};

export function getLlm(): LlmConfig {
  const gemini = process.env.GEMINI_API_KEY?.trim();
  if (gemini) {
    return {
      provider: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      model: process.env.LLM_MODEL ?? "gemini-2.0-flash",
      key: gemini,
      extraBody: {},
    };
  }
  const cerebras = process.env.CEREBRAS_API_KEY?.trim();
  if (cerebras) {
    return {
      provider: "cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      // gpt-oss-120b is a reasoning model; "low" effort keeps token usage ~6×
      // smaller so we stay under the free-tier 30k tokens/minute limit.
      model: process.env.LLM_MODEL ?? "gpt-oss-120b",
      key: cerebras,
      extraBody: { reasoning_effort: "low" },
    };
  }
  return {
    provider: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    key: process.env.GROQ_API_KEY?.trim(),
    extraBody: {},
  };
}
