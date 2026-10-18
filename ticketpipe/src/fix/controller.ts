import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { appDataDir } from "../config";
import { embeddedHelper } from "./helper-asset";
import type { Action, Controller, Observation, TargetWindow } from "./contracts";

export class ControllerError extends Error {
  constructor(message: string, public code = "controller_failed", public performed: boolean | null = null) { super(message); }
}

export function helperPath(): string | null {
  if (process.platform !== "win32") return null;
  if (embeddedHelper) {
    const bytes = readFileSync(embeddedHelper);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const directory = join(appDataDir(), "native", hash);
    const destination = join(directory, "ticketpipe-controller.exe");
    if (!existsSync(destination) || createHash("sha256").update(readFileSync(destination)).digest("hex") !== hash) {
      mkdirSync(directory, { recursive: true });
      const staging = destination + "." + crypto.randomUUID() + ".tmp";
      writeFileSync(staging, bytes); renameSync(staging, destination);
    }
    return destination;
  }
  const candidate = resolve(import.meta.dir, "../../native/windows/target/release/ticketpipe-controller.exe");
  return existsSync(candidate) ? candidate : null;
}

/** Private child process; it receives no AI, Screenpipe, or GitHub credentials. */
export class WindowsController implements Controller {
  private process?: ReturnType<typeof Bun.spawn>;
  private sequence = 0;
  private closed = false;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private executable = helperPath()) {}
  private launch() {
    if (this.closed) throw new ControllerError("The desktop controller was stopped.", "cancelled", false);
    if (this.process) return;
    if (!this.executable) throw new ControllerError("The Windows controller is not installed. Build it with bun run build:native.", "unavailable", false);
    const environment: Record<string, string> = {};
    // Native libraries need standard Windows environment paths, never the parent's service keys.
    for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "USERPROFILE", "LOCALAPPDATA"]) if (process.env[key]) environment[key] = process.env[key]!;
    const child = Bun.spawn([this.executable], { stdin: "pipe", stdout: "pipe", stderr: "ignore", windowsHide: true, env: environment });
    this.process = child;
    void this.read(child.stdout as ReadableStream<Uint8Array>);
    void child.exited.then(() => this.terminate(new ControllerError("The desktop controller closed. Any unacknowledged action is uncertain.")));
  }
  private async read(stream: ReadableStream<Uint8Array>) {
    let buffer = "";
    try {
      const reader = stream.getReader(), decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 2_000_000) throw new Error("Invalid controller response size");
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
          const waiter = this.pending.get(message.id);
          if (!waiter) continue;
          this.pending.delete(message.id); clearTimeout(waiter.timer);
          if (message.ok === true) waiter.resolve(message.result);
          else waiter.reject(new ControllerError(message.error?.message || "Controller request failed.", message.error?.code, message.error?.performed ?? null));
        }
      }
    } catch { this.terminate(new ControllerError("The desktop controller did not return a valid response.")); }
  }
  private request<T>(op: string, args: unknown = {}, signal?: AbortSignal, timeout = 12_000): Promise<T> {
    signal?.throwIfAborted(); this.launch();
    const id = ++this.sequence;
    return new Promise<T>((resolvePromise, reject) => {
      const abort = () => this.terminate(new ControllerError("Automatic control was cancelled.", "cancelled"));
      const finish = <F extends (v: any) => void>(fn: F) => (v: any) => { signal?.removeEventListener("abort", abort); fn(v); };
      const timer = setTimeout(() => this.terminate(new ControllerError("The application took too long to respond. Automatic control was stopped.", "timeout")), timeout);
      this.pending.set(id, { resolve: finish(resolvePromise), reject: finish(reject), timer });
      signal?.addEventListener("abort", abort, { once: true });
      try { const stdin = this.process!.stdin as { write(data: string): unknown; flush(): unknown }; stdin.write(JSON.stringify({ id, op, args }) + "\n"); stdin.flush(); }
      catch { this.terminate(new ControllerError("Could not communicate with the desktop controller.")); }
    });
  }
  private terminate(reason: Error) {
    this.closed = true;
    try { this.process?.kill(); } catch {}
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(reason); }
    this.pending.clear();
  }
  windows(signal?: AbortSignal) { return this.request<TargetWindow[]>("windows", {}, signal); }
  async bind(id: string, signal: AbortSignal) { await this.request("bind", { id }, signal); }
  async guard(signal: AbortSignal) { await this.request("guard", {}, signal); }
  observe(signal: AbortSignal) { return this.request<Observation>("observe", {}, signal); }
  act(observationId: string, action: Action, signal: AbortSignal) { return this.request<{ performed: true }>("act", { observationId, action }, signal); }
  async cancel() {
    if (!this.closed && this.process) { try { await this.request("cancel", {}, undefined, 500); } catch {} }
    this.terminate(new ControllerError("Automatic control was stopped.", "cancelled"));
  }
  async close() { this.terminate(new ControllerError("The desktop controller closed.", "cancelled")); }
}
