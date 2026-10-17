// fetch → clean → redact → LLM → markdown. Shared by the server and the CLI.

import { config } from "./config";
import { buildContext, fetchRaw } from "./context";
import { redact, totalRedactions } from "./redact";
import { generateTicket, toMarkdown, type Ticket } from "./ticket";

export type Draft = {
  ticket: Ticket;
  title: string;
  body: string;
  labels: string[];
  stats: {
    rawItems: number;
    events: number;
    segments: number;
    apps: string[];
    from: string | null;
    to: string | null;
    redactions: Record<string, number>;
    llm: string;
    source: string;
  };
  /** Exactly what was sent to the LLM (already redacted) — shown in the UI for transparency. */
  contextSent: string;
};

function deepRedact<T>(value: T): T {
  if (typeof value === "string") return redact(value).text as T;
  if (Array.isArray(value)) return value.map(deepRedact) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepRedact(v)])) as T;
  }
  return value;
}

export async function createDraft(opts: { minutes?: number; note?: string } = {}): Promise<Draft> {
  const minutes = opts.minutes ?? config.lookbackMinutes;
  const note = redact(opts.note ?? "").text;

  const raw = await fetchRaw(minutes);
  const ctx = buildContext(raw);
  if (ctx.events === 0) {
    throw new Error(
      `Nothing was recorded in the last ${minutes} minutes. Check that screenpipe is running and recording, then try again.`,
    );
  }

  const { text: contextSent, counts } = redact(ctx.rendered);
  // Defense in depth: re-mask every string of the ticket (mock mode reads raw highlights).
  const ticket = deepRedact(await generateTicket(ctx, contextSent, note));
  const body = toMarkdown(ticket, { events: ctx.events, from: ctx.from, to: ctx.to, redactions: totalRedactions(counts) });

  return {
    ticket,
    title: ticket.title,
    body,
    labels: ["it-ticket", `severity:${ticket.severity}`],
    stats: {
      rawItems: ctx.rawItems,
      events: ctx.events,
      segments: ctx.segments.length,
      apps: ctx.apps,
      from: ctx.from?.toISOString() ?? null,
      to: ctx.to?.toISOString() ?? null,
      redactions: counts,
      llm: config.llmProvider === "mock" ? "demo" : config.llmModel,
      source: config.demoMode
        ? "sample incident"
        : config.contextFile
          ? `file: ${config.contextFile}`
          : `screenpipe (${minutes} min)`,
    },
    contextSent,
  };
}
