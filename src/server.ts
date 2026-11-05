// Local web server behind the app window. Listens on 127.0.0.1 only.
//   bun run dev    → server only (open http://127.0.0.1:4242 yourself)
//   bun run app    → server + app window (see app.ts)

import indexHtml from "../public/index.html" with { type: "file" };
import markedJs from "../node_modules/marked/marked.min.js" with { type: "file" };
import { applyDemoFlag, config, isOnboarded, loadSettings, saveSettings, SETTINGS_KEYS, type Settings } from "./config";
import { testScreenpipe } from "./context";
import { openExternal } from "./open";
import { detectScreenpipeKey } from "./detect";
import { createDraft, createHelp } from "./pipeline";
import { publishIssue, testGithub } from "./publish";
import { testLlm } from "./ticket";

const SECRET_KEYS = ["screenpipeApiKey", "llmApiKey", "githubToken"] as const;
const APP_ID = "ticketpipe";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (err: unknown, status = 500) => json({ error: err instanceof Error ? err.message : String(err) }, status);

/** Last time the app window said "I'm still open". */
export let lastPing = 0;

function publicSettings() {
  const out: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) {
    const value = config[key];
    if ((SECRET_KEYS as readonly string[]).includes(key)) {
      const v = String(value || "");
      out[key] = v ? `••••${v.slice(-4)}` : "";
    } else out[key] = value;
  }
  return { ...out, onboarded: isOnboarded(), ticketsDir: config.ticketsDir };
}

export function startServer(port = config.port) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1", // screen data never leaves this machine unless the user sends a ticket
    routes: {
      "/": new Response(Bun.file(indexHtml as unknown as string), { headers: { "content-type": "text/html; charset=utf-8" } }),
      "/vendor/marked.js": new Response(Bun.file(markedJs), { headers: { "content-type": "text/javascript" } }),

      "/api/ping": () => {
        lastPing = Date.now();
        return json({ app: APP_ID });
      },

      "/api/settings": {
        GET: () => json(publicSettings()),
        POST: async (req) => {
          try {
            const patch = (await req.json()) as Record<string, unknown>;
            const clean: Settings = {};
            for (const key of SETTINGS_KEYS) {
              if (!(key in patch)) continue;
              const v = patch[key];
              // Secrets come back masked ("••••1234") when unchanged: ignore those.
              if ((SECRET_KEYS as readonly string[]).includes(key) && typeof v === "string" && v.startsWith("••••")) continue;
              (clean as any)[key] = key === "lookbackMinutes" ? Number(v) : typeof v === "string" ? v.trim() : v;
            }
            if (typeof patch.onboarded === "boolean") clean.onboarded = patch.onboarded;
            saveSettings(clean);
            return json(publicSettings());
          } catch (e) {
            return fail(e, 400);
          }
        },
      },

      "/api/test/:what": {
        POST: async (req) => {
          try {
            const what = req.params.what;
            const message =
              what === "screenpipe" ? await testScreenpipe()
              : what === "ai" ? `Connected to ${await testLlm()}.`
              : what === "github" ? await testGithub().then((r) => (r.startsWith("Tickets") ? r : `Connected to ${r}.`))
              : null;
            if (message === null) return fail("Unknown test", 404);
            return json({ ok: true, message });
          } catch (e) {
            return json({ ok: false, message: e instanceof Error ? e.message : String(e) });
          }
        },
      },

      "/api/detect/screenpipe": {
        POST: async () => {
          const key = await detectScreenpipeKey();
          if (!key) {
            return json({
              ok: false,
              message: "Couldn't find it automatically. Make sure screenpipe is running, or paste the key below.",
            });
          }
          saveSettings({ screenpipeApiKey: key });
          return json({ ok: true, message: "Found your screenpipe key and saved it.", settings: publicSettings() });
        },
      },

      "/api/help": {
        POST: async (req) => {
          try {
            const { minutes, note } = (await req.json().catch(() => ({}))) as { minutes?: number; note?: string };
            return json(await createHelp({ minutes: minutes ? Number(minutes) : undefined, note }));
          } catch (e) {
            return fail(e);
          }
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
            if (!title?.trim() || !body?.trim()) return fail("The ticket needs a title and a description.", 400);
            return json(await publishIssue({ title: title.trim(), body, labels }));
          } catch (e) {
            return fail(e);
          }
        },
      },

      "/api/open": {
        POST: async (req) => {
          const { target } = (await req.json()) as { target?: string };
          if (target === "tickets-folder") {
            await Bun.write(`${config.ticketsDir}/.keep`, "");
            return json({ ok: openExternal(config.ticketsDir) });
          }
          // Only open web links (GitHub issue, docs) — never arbitrary commands.
          if (!target || !/^https:\/\//.test(target)) return fail("Only https links can be opened.", 400);
          return json({ ok: openExternal(target) });
        },
      },
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
}

/** Is our app already running on this port? (used to avoid opening a second copy) */
export async function isAppRunningOn(port: number) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(800) });
    return ((await res.json()) as { app?: string }).app === APP_ID;
  } catch {
    return false;
  }
}

/** No screenpipe key yet? Try to find it in the background so setup is one click shorter. */
export async function autoDetectKey() {
  if (config.screenpipeApiKey || config.demoMode) return;
  const key = await detectScreenpipeKey();
  if (key) saveSettings({ screenpipeApiKey: key });
}

if (import.meta.main) {
  loadSettings();
  applyDemoFlag(process.argv);
  autoDetectKey();
  const server = startServer();
  console.log(`\n  [ ticketpipe ] → http://${server.hostname}:${server.port}`);
  console.log(`     source: ${config.demoMode ? "sample incident" : config.screenpipeUrl}`);
  console.log(`     ai:     ${config.llmProvider === "mock" ? "demo" : config.llmModel}\n`);
}
