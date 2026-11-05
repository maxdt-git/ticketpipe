// Build standalone executables for Linux, macOS and Windows (no Bun/Node needed to run them).
//   bun run build              # all platforms
//   bun run build linux-x64    # one platform
// Output: dist/

import { $ } from "bun";
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const pkg = await Bun.file("package.json").json();
const NAME = "ticketpipe";
const APP = "TicketPipe";

type Target = { id: string; bun: string; exe: string; mac?: boolean; win?: boolean };
const TARGETS: Target[] = [
  { id: "linux-x64", bun: "bun-linux-x64", exe: `${NAME}-linux-x64` },
  { id: "linux-arm64", bun: "bun-linux-arm64", exe: `${NAME}-linux-arm64` },
  { id: "mac-arm64", bun: "bun-darwin-arm64", exe: `${NAME}-mac-arm64`, mac: true },
  { id: "mac-x64", bun: "bun-darwin-x64", exe: `${NAME}-mac-x64`, mac: true },
  { id: "windows-x64", bun: "bun-windows-x64", exe: `${NAME}-windows-x64.exe`, win: true },
];

const wanted = Bun.argv.slice(2);
const targets = wanted.length ? TARGETS.filter((t) => wanted.includes(t.id)) : TARGETS;

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

for (const t of targets) {
  process.stdout.write(`→ ${t.id.padEnd(12)} `);
  const out = `dist/${t.exe}`;
  // Bun can only embed the .exe icon when the build itself runs on Windows.
  const icon = t.win && process.platform === "win32" ? ["--windows-icon=brand/icon.ico"] : [];
  if (t.win && !icon.length) process.stdout.write("(no .exe icon: build on Windows to embed it) ");
  const res = await $`bun build src/app.ts --compile --minify --target=${t.bun} ${icon} --outfile ${out}`.quiet().nothrow();
  if (res.exitCode !== 0) {
    console.log(`failed\n${res.stderr.toString().slice(0, 600)}`);
    continue;
  }

  if (t.mac) {
    // Wrap in a .app bundle so it opens with a double-click and shows a proper name.
    const bundle = `dist/${t.id}/${APP}.app/Contents`;
    mkdirSync(`${bundle}/MacOS`, { recursive: true });
    await $`mv ${out} ${bundle}/MacOS/${NAME}`.quiet();
    chmodSync(`${bundle}/MacOS/${NAME}`, 0o755);
    mkdirSync(`${bundle}/Resources`, { recursive: true });
    copyFileSync("brand/icon.icns", `${bundle}/Resources/${APP}.icns`);
    writeFileSync(
      `${bundle}/Info.plist`,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIconFile</key><string>${APP}.icns</string>
  <key>CFBundleName</key><string>${APP}</string>
  <key>CFBundleDisplayName</key><string>${APP}</string>
  <key>CFBundleIdentifier</key><string>dev.hackathon.ticketpipe</string>
  <key>CFBundleVersion</key><string>${pkg.version}</string>
  <key>CFBundleShortVersionString</key><string>${pkg.version}</string>
  <key>CFBundleExecutable</key><string>${NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><false/>
</dict></plist>
`,
    );
    await $`cd dist/${t.id} && zip -qry ../${NAME}-${t.id}.zip ${APP}.app`.quiet();
    rmSync(`dist/${t.id}`, { recursive: true, force: true });
    console.log(`dist/${NAME}-${t.id}.zip`);
  } else {
    console.log(out);
  }
}
