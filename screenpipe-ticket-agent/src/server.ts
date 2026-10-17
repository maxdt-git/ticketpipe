// Local web app: generate a draft, let the user review/edit it, then publish.
// Run: bun run dev   (or: bun run demo  — replays fixtures/vpn-error.json)

import { applyDemoFlag, config } from "./config";
import { createDraft } from "./pipeline";
import { publishIssue } from "./publish";

applyDemoFlag(process.argv);

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (err: unknown, status = 500) =>
  json({ error: err instanceof Error ? err.message : String(err) }, status);

const server = Bun.serve({
  port: config.port,
  hostname: "127.0.0.1", // local only: screen data never leaves the machine unless the user publishes
  routes: {
    "/": new Response(Bun.file(new URL("../public/index.html", import.meta.url).pathname)),
    // Served locally so the demo works without internet.
    "/vendor/marked.js": new Response(
      Bun.file(new URL("../node_modules/marked/marked.min.js", import.meta.url).pathname),
      { headers: { "content-type": "text/javascript" } },
    ),

    "/api/status": {
      GET: async () => {
        let screenpipe: unknown = config.contextFile ? { mode: "replay", file: config.contextFile } : null;
        if (!config.contextFile) {
          try {
            const res = await fetch(`${config.screenpipeUrl}/health`, { signal: AbortSignal.timeout(2000) });
            screenpipe = res.ok ? await res.json() : { error: `HTTP ${res.status}` };
          } catch (e) {
            screenpipe = { error: `unreachable at ${config.screenpipeUrl}` };
          }
        }
        return json({
          screenpipe,
          llm: config.llmProvider,
          github: config.githubToken && config.githubRepo ? config.githubRepo : "dry-run (saved to ./out)",
          lookbackMinutes: config.lookbackMinutes,
        });
      },
    },

    "/api/draft": {
      POST: async (req) => {
        try {
          const { minutes, note } = (await req.json().catch(() => ({}))) as { minutes?: number; note?: string };
          return json(await createDraft({ minutes: minutes ? Number(minutes) : undefined, note }));
        } catch (e) {
          return fail(e);
        }
      },
    },

    "/api/publish": {
      POST: async (req) => {
        try {
          const { title, body, labels } = (await req.json()) as { title: string; body: string; labels?: string[] };
          if (!title?.trim() || !body?.trim()) return fail("title and body are required", 400);
          return json(await publishIssue({ title: title.trim(), body, labels }));
        } catch (e) {
          return fail(e);
        }
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

console.log(`\n  🎫 screenpipe-ticket-agent → http://${server.hostname}:${server.port}`);
console.log(`     source: ${config.contextFile ? `replay ${config.contextFile}` : config.screenpipeUrl}`);
console.log(`     llm:    ${config.llmProvider}`);
console.log(`     github: ${config.githubToken && config.githubRepo ? config.githubRepo : "dry-run (./out)"}\n`);
