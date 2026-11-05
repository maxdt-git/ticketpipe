// Desktop entry point: starts the local server and opens it in an app window.
// Compiled into a single executable by scripts/build.ts.
//
//   bun run app            # from source
//   ./ticketpipe         # compiled
//   ./ticketpipe --demo  # sample incident, no screenpipe needed
//   ./ticketpipe --install   # Linux: add to the applications menu

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import launcherIcon from "../brand/icon.svg" with { type: "file" };
import { APP_NAME, appDataDir, applyDemoFlag, config, loadSettings } from "./config";
import { openExternal } from "./open";
import { autoDetectKey, isAppRunningOn, lastPing, startServer } from "./server";

const WINDOW = { width: 1120, height: 820 };

// ---------------------------------------------------------------- find a Chromium-based browser

function candidates(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ];
  }
  if (process.platform === "win32") {
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return [
      join(pf, "Google\\Chrome\\Application\\chrome.exe"),
      join(pf86, "Google\\Chrome\\Application\\chrome.exe"),
      join(local, "Google\\Chrome\\Application\\chrome.exe"),
      join(pf86, "Microsoft\\Edge\\Application\\msedge.exe"), // shipped with Windows 10/11
      join(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
      join(pf, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
    ];
  }
  const names = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "microsoft-edge-stable",
    "brave-browser",
  ];
  return names.map((n) => Bun.which(n) ?? "").filter(Boolean);
}

const findBrowser = () => candidates().find((p) => p && existsSync(p)) ?? null;

/** Open the UI in its own window (no tabs, no address bar). Falls back to the default browser. */
function openWindow(url: string) {
  const browser = findBrowser();
  if (!browser) {
    console.log("No Chrome, Edge or Chromium found: opening your default browser instead.");
    openExternal(url);
    return;
  }
  Bun.spawn(
    [
      browser,
      `--app=${url}`,
      `--user-data-dir=${join(appDataDir(), "window")}`, // separate profile = a real standalone window
      `--window-size=${WINDOW.width},${WINDOW.height}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
}

// ---------------------------------------------------------------- Linux: add to the applications menu

function installLinuxLauncher() {
  const exe = process.execPath;
  const apps = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "applications");
  const icons = join(appDataDir(), "icon.svg");
  mkdirSync(apps, { recursive: true });
  writeFileSync(icons, readFileSync(launcherIcon));
  const desktop = join(apps, "ticketpipe.desktop");
  writeFileSync(
    desktop,
    `[Desktop Entry]\nType=Application\nName=${APP_NAME}\nComment=Turn what screenpipe saw into an IT ticket, or a quick fix\nExec="${exe}"\nIcon=${icons}\nTerminal=false\nCategories=Utility;\n`,
  );
  chmodSync(desktop, 0o755);
  console.log(`Added "${APP_NAME}" to your applications menu (${desktop}).`);
}

// ---------------------------------------------------------------- main

if (process.argv.includes("--install")) {
  if (process.platform === "linux") installLinuxLauncher();
  else console.log("--install is only needed on Linux.");
  process.exit(0);
}

loadSettings();
applyDemoFlag(process.argv);

// Already open? Just bring up another window on the running copy.
if (await isAppRunningOn(config.port)) {
  openWindow(`http://127.0.0.1:${config.port}`);
  process.exit(0);
}

let server;
try {
  server = startServer(config.port);
} catch {
  server = startServer(0); // port taken by something else: pick any free one
}
const url = `http://127.0.0.1:${server.port}`;
autoDetectKey();
console.log(`${APP_NAME} is running at ${url}`);
console.log("Close the window to quit.");
openWindow(url);

// Quit when the window has been closed: the page pings every few seconds while it's open.
const started = Date.now();
setInterval(() => {
  const now = Date.now();
  const neverOpened = lastPing === 0 && now - started > 120_000;
  const closed = lastPing !== 0 && now - lastPing > 20_000;
  if (neverOpened || closed) {
    server.stop(true);
    process.exit(0);
  }
}, 5_000);
