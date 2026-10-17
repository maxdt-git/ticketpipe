// Central config. Bun loads .env automatically.

const env = (key: string, fallback = ""): string => process.env[key]?.trim() || fallback;

export type LlmProvider = "anthropic" | "openai" | "mock";

export const config = {
  screenpipeUrl: env("SCREENPIPE_URL", "http://localhost:3030").replace(/\/$/, ""),
  screenpipeApiKey: env("SCREENPIPE_API_KEY"),
  contentTypes: env("CONTENT_TYPES", "ocr,ui")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  lookbackMinutes: Number(env("LOOKBACK_MINUTES", "15")),
  maxContextChars: Number(env("MAX_CONTEXT_CHARS", "12000")),
  contextFile: env("CONTEXT_FILE"),

  llmProvider: env("LLM_PROVIDER", "anthropic") as LlmProvider,
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  anthropicModel: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
  openaiApiKey: env("OPENAI_API_KEY"),
  openaiModel: env("OPENAI_MODEL", "gpt-4.1-mini"),
  openaiBaseUrl: env("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
  ticketLanguage: env("TICKET_LANGUAGE", "en"),

  githubToken: env("GITHUB_TOKEN"),
  githubRepo: env("GITHUB_REPO"),

  port: Number(env("PORT", "4242")),
};

/** `--demo` flag: replay the bundled fixture with the mock LLM if no key is set. */
export function applyDemoFlag(argv: string[]) {
  if (!argv.includes("--demo")) return;
  if (!config.contextFile) config.contextFile = "fixtures/vpn-error.json";
  const hasKey =
    (config.llmProvider === "anthropic" && config.anthropicApiKey) ||
    (config.llmProvider === "openai" && config.openaiApiKey);
  if (!hasKey) config.llmProvider = "mock";
}
