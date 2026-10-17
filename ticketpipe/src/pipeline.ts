// fetch → clean → redact → LLM → markdown. Shared by the server and the CLI.

import { config } from "./config";
import { buildContext, fetchRaw, type Context } from "./context";
import { redact, totalRedactions } from "./redact";
import { generateHelp, generateTicket, toMarkdown, type Help, type Ticket } from "./ticket";

export type Stats = {
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

export type Draft = {
  ticket: Ticket;
  title: string;
  body: string;
  labels: string[];
  stats: Stats;
  /** Exactly what was sent to the LLM (already redacted) — shown in the UI for transparency. */
  contextSent: string;
};

export type HelpResult = { help: Help; stats: Stats; contextSent: string };

function deepRedact<T>(value: T): T {
  if (typeof value === "string") return redact(value).text as T;
  if (Array.isArray(value)) return value.map(deepRedact) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepRedact(v)])) as T;
  }
  return value;
}

/** Read screenpipe, clean and mask it. Shared by tickets and quick fixes. */
async function prepare(minutes: number, rawNote: string) {
  const note = redact(rawNote).text;
  const raw = await fetchRaw(minutes);
  const ctx = buildContext(raw);
  if (ctx.events === 0) {
    throw new Error(
      `Nothing was recorded in the last ${minutes} minutes. Check that screenpipe is running and recording, then try again.`,
    );
  }
  const { text: contextSent, counts } = redact(ctx.rendered);
  return { note, ctx, contextSent, counts, stats: statsOf(ctx, counts, minutes) };
}

function statsOf(ctx: Context, counts: Record<string, number>, minutes: number): Stats {
  return {
    rawItems: ctx.rawItems,
    events: ctx.events,
    segments: ctx.segments.length,
    apps: ctx.apps,
    from: ctx.from?.toISOString() ?? null,
    to: ctx.to?.toISOString() ?? null,
    redactions: counts,
    llm: config.llmProvider === "mock" ? "demo AI" : config.llmModel,
    source: config.demoMode
      ? "sample incident"
      : config.contextFile
        ? `file: ${config.contextFile}`
        : `screenpipe, last ${minutes} min`,
  };
}

export async function createDraft(opts: { minutes?: number; note?: string } = {}): Promise<Draft> {
  const minutes = opts.minutes ?? config.lookbackMinutes;
  const { note, ctx, contextSent, counts, stats } = await prepare(minutes, opts.note ?? "");
  // Defense in depth: re-mask every string of the ticket (the demo AI reads raw highlights).
  const ticket = deepRedact(await generateTicket(ctx, contextSent, note));
  const body = toMarkdown(ticket, { events: ctx.events, from: ctx.from, to: ctx.to, redactions: totalRedactions(counts) });
  return { ticket, title: ticket.title, body, labels: ["it-ticket", `severity:${ticket.severity}`], stats, contextSent };
}

export async function createHelp(opts: { minutes?: number; note?: string } = {}): Promise<HelpResult> {
  const minutes = opts.minutes ?? config.lookbackMinutes;
  const { note, ctx, contextSent, stats } = await prepare(minutes, opts.note ?? "");
  const help = deepRedact(await generateHelp(ctx, contextSent, note));
  return { help, stats, contextSent };
}
