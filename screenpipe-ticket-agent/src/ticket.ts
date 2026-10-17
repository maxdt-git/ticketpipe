// Turn the (redacted) context into a structured IT ticket with an LLM.

import { config } from "./config";
import type { Context } from "./context";

export type Severity = "low" | "medium" | "high" | "critical";

export type Ticket = {
  title: string;
  summary: string;
  severity: Severity;
  category: string;
  affected_app: string | null;
  app_version: string | null;
  environment: string | null;
  error_messages: string[];
  steps_to_reproduce: string[];
  attempted_fixes: string[];
  timeline: { time: string; event: string }[];
  suggested_next_steps: string[];
  missing_info: string[];
};

const SCHEMA = `{
  "title": string,                     // < 90 chars, specific: app + symptom
  "summary": string,                   // 2-4 sentences: what the user tried to do, what happened, impact
  "severity": "low" | "medium" | "high" | "critical",
  "category": string,                  // e.g. "network/vpn", "access/sso", "software/crash", "hardware", "email"
  "affected_app": string | null,
  "app_version": string | null,        // only if visible in the context
  "environment": string | null,        // OS / device info, only if visible
  "error_messages": string[],          // verbatim, as seen on screen
  "steps_to_reproduce": string[],      // what the user actually did, in order
  "attempted_fixes": string[],         // what the user already tried
  "timeline": [{ "time": "HH:MM:SS", "event": string }],  // 3-10 key moments, UTC
  "suggested_next_steps": string[],    // for the IT technician, 1-4 items
  "missing_info": string[]             // what IT would still need to ask
}`;

function systemPrompt(): string {
  return `You are an IT support assistant. You turn a user's recent screen activity, captured by screenpipe
(OCR of the screen, UI events, sometimes audio transcripts), into a precise, actionable IT ticket.

How to pick the problem:
- The USER NOTE is the authority on what the problem is. Build the ticket around it, and only use the
  parts of the context that relate to it. If there is no note, pick the MOST RECENT error.
- If several distinct errors relate to the problem, list them all in chronological order; the most recent
  one is usually the current blocker.

What the context is (and is not):
- It is OCR of the whole screen: it also contains documentation, web pages, chat conversations
  (including with AI assistants), examples and suggestions. Text that is displayed is NOT necessarily
  something the user did. Only treat as a user action what clearly shows it was done: a command in a
  terminal followed by its output, a click/key event (lines starting with "›"), an app's own error dialog.
- OCR is imperfect: garbled characters are normal. Copy error messages as they appear, but you may drop
  obvious garbage at their edges.

Strict rules (no guessing):
- Only state facts that appear in the context or in the user's note. Never invent versions, error codes,
  hostnames, URLs, impact, root causes or steps.
- "steps_to_reproduce" and "attempted_fixes": only actions you can SEE were done. Anything else → "missing_info".
- "category", "affected_app", "environment": only from clear evidence, otherwise "other" / null.
- "summary": describe what is observed. Do not claim business impact unless the user says so.
- Severity defaults to "medium". Use "high"/"critical" only if the note or the context explicitly says the
  user is fully blocked / many users are affected. "low" for cosmetic issues.
- Markers like [REDACTED_EMAIL] are intentional privacy masks: keep them as-is, never try to guess them.
- "suggested_next_steps" are hypotheses for the technician: phrase them as checks, not as conclusions.
- Write every string value in this language: ${config.ticketLanguage}.
- Reply with ONE JSON object and nothing else (no markdown fences), matching this schema:
${SCHEMA}`;
}

function userPrompt(ctx: Context, contextText: string, note: string): string {
  return [
    `USER NOTE (authoritative description of the problem): ${
      note.trim() || "(none — the user just pressed \"create ticket\"; focus on the most recent error)"
    }`,
    "",
    `Captured context (${ctx.events} events, redacted):`,
    "<context>",
    contextText,
    "</context>",
  ].join("\n");
}

// ---------------------------------------------------------------- providers

async function callAnthropic(system: string, user: string): Promise<string> {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set (or use LLM_PROVIDER=mock).");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API → HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const json = (await res.json()) as { content: { type: string; text?: string }[] };
  return json.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

async function callOpenAI(system: string, user: string): Promise<string> {
  if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is not set (or use LLM_PROVIDER=mock).");
  const res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.openaiModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible API → HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0]?.message?.content ?? "";
}

/** No network: builds a plausible ticket from the detected error lines. For tests and offline demos. */
function mockTicket(ctx: Context, note: string): Ticket {
  const top = ctx.highlights[0];
  const app = top?.app ?? ctx.apps[0] ?? null;
  return {
    title: top ? `${app}: ${top.line}`.slice(0, 90) : "Issue reported from screen activity",
    summary:
      (note ? `User note: ${note}. ` : "") +
      `Generated in mock mode from ${ctx.events} screen events. ${ctx.highlights.length} error-like line(s) detected.`,
    severity: ctx.highlights.length > 2 ? "high" : "medium",
    category: "unknown",
    affected_app: app,
    app_version: null,
    environment: null,
    error_messages: ctx.highlights.map((h) => h.line),
    steps_to_reproduce: ctx.segments.slice(-6).map((s) => `Used ${s.app}${s.window ? ` (${s.window})` : ""}`),
    attempted_fixes: [],
    timeline: ctx.highlights.slice(0, 8).map((h) => ({ time: h.time.toISOString().slice(11, 19), event: h.line })),
    suggested_next_steps: ["Run with a real LLM provider for a full analysis."],
    missing_info: [],
  };
}

// ---------------------------------------------------------------- parsing

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseTicket(raw: string): Ticket {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`LLM did not return JSON:\n${raw.slice(0, 500)}`);
  const j = JSON.parse(raw.slice(start, end + 1));

  const sev = String(j.severity ?? "medium").toLowerCase();
  return {
    title: asStr(j.title) ?? "Untitled issue",
    summary: asStr(j.summary) ?? "",
    severity: (["low", "medium", "high", "critical"].includes(sev) ? sev : "medium") as Severity,
    category: asStr(j.category) ?? "other",
    affected_app: asStr(j.affected_app),
    app_version: asStr(j.app_version),
    environment: asStr(j.environment),
    error_messages: asList(j.error_messages),
    steps_to_reproduce: asList(j.steps_to_reproduce),
    attempted_fixes: asList(j.attempted_fixes),
    timeline: Array.isArray(j.timeline)
      ? j.timeline
          .map((t: any) => ({ time: String(t?.time ?? ""), event: String(t?.event ?? "") }))
          .filter((t: { event: string }) => t.event)
      : [],
    suggested_next_steps: asList(j.suggested_next_steps),
    missing_info: asList(j.missing_info),
  };
}

export async function generateTicket(ctx: Context, contextText: string, note = ""): Promise<Ticket> {
  if (config.llmProvider === "mock") return mockTicket(ctx, note);
  const system = systemPrompt();
  const user = userPrompt(ctx, contextText, note);
  const raw = config.llmProvider === "openai" ? await callOpenAI(system, user) : await callAnthropic(system, user);
  return parseTicket(raw);
}

// ---------------------------------------------------------------- markdown

const bullets = (items: string[], ordered = false) =>
  items.length ? items.map((s, i) => `${ordered ? `${i + 1}.` : "-"} ${s}`).join("\n") : "_None_";

export function toMarkdown(t: Ticket, meta: { events: number; from: Date | null; to: Date | null; redactions: number }) {
  const range =
    meta.from && meta.to ? `${meta.from.toISOString().slice(0, 19)}Z → ${meta.to.toISOString().slice(11, 19)}Z` : "n/a";
  return `## Summary
${t.summary}

| | |
|---|---|
| **Severity** | ${t.severity} |
| **Category** | ${t.category} |
| **Application** | ${t.affected_app ?? "unknown"} |
| **Version** | ${t.app_version ?? "unknown"} |
| **Environment** | ${t.environment ?? "unknown"} |

## Error messages (verbatim)
${t.error_messages.length ? t.error_messages.map((e) => "```\n" + e + "\n```").join("\n") : "_None captured_"}

## Steps to reproduce
${bullets(t.steps_to_reproduce, true)}

## Already tried by the user
${bullets(t.attempted_fixes)}

## Timeline (UTC)
${t.timeline.length ? t.timeline.map((e) => `- \`${e.time}\` ${e.event}`).join("\n") : "_n/a_"}

## Suggested next steps
${bullets(t.suggested_next_steps)}

## Missing information
${bullets(t.missing_info)}

---
<sub>🤖 Generated by screenpipe-ticket-agent from ${meta.events} screen events (${range}).
${meta.redactions} sensitive item(s) were masked locally. Reviewed by the user before sending.</sub>
`;
}
