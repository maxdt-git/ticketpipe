// Open a URL or folder with the system's default app (browser, file manager).

export function openExternal(target: string) {
  const cmd =
    process.platform === "darwin"
      ? ["open", target]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", target]
        : ["xdg-open", target];
  try {
    Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] }).unref();
    return true;
  } catch {
    return false;
  }
}
