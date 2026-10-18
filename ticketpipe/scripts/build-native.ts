import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";

export async function buildNative() {
  if (process.env.TICKETPIPE_WINDOWS_HELPER) {
    const supplied = resolve(process.env.TICKETPIPE_WINDOWS_HELPER);
    if (!existsSync(supplied)) throw new Error("TICKETPIPE_WINDOWS_HELPER must point to a built Windows controller executable.");
    return supplied;
  }
  if (process.platform !== "win32") throw new Error("Build the controller on Windows, or provide its executable through TICKETPIPE_WINDOWS_HELPER.");
  const tools = resolve(import.meta.dir, "../../../.tools/workscope");
  const portable = resolve(tools, "rustup/toolchains/stable-x86_64-pc-windows-gnu/bin");
  const cargo = Bun.which("cargo") ?? resolve(portable, "cargo.exe");
  if (!existsSync(cargo)) throw new Error("Building the Windows release requires Rust. End users only need the compiled executable.");
  const env = { ...process.env };
  if (cargo.startsWith(portable)) {
    env.CARGO_HOME = resolve(tools, "cargo");
    env.RUSTC = resolve(portable, "rustc.exe");
    env.PATH = resolve(tools, "compiler/w64devkit/bin") + delimiter + portable + delimiter + (env.PATH ?? "");
    env.RUSTFLAGS = "-C link-self-contained=yes";
  }
  const child = Bun.spawn([cargo, "build", "--release", "--locked", "--manifest-path", "native/windows/Cargo.toml"], { cwd: resolve(import.meta.dir, ".."), env, stdio: ["ignore", "inherit", "inherit"] });
  if (await child.exited !== 0) throw new Error("The Windows controller build failed.");
  return resolve(import.meta.dir, "../native/windows/target/release/ticketpipe-controller.exe");
}
if (import.meta.main) await buildNative();
