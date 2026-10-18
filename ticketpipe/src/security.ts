import { randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

export function createApiSecurity() {
  const token = randomBytes(32).toString("hex");
  let lastWarn = 0;
  function authorize(req: Request, port: number) {
    const host = `127.0.0.1:${port}`, origin = `http://${host}`;
    const supplied = req.headers.get("x-ticketpipe-token") ?? "";
    const reason =
      req.headers.get("host") !== host ? `host header is "${req.headers.get("host")}", expected "${host}"`
      : new URL(req.url).origin !== origin ? `request URL origin is "${new URL(req.url).origin}"`
      : req.headers.has("origin") && req.headers.get("origin") !== origin ? `origin header is "${req.headers.get("origin")}"`
      : !supplied ? "no token sent"
      : Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
        ? "token is from an older TicketPipe window (the app was restarted)"
      : null;
    if (reason) {
      // Never print the token itself. Rate-limited so an old window doesn't flood the terminal.
      if (Date.now() - lastWarn > 5000) {
        lastWarn = Date.now();
        console.warn(`[security] refused ${req.method} ${new URL(req.url).pathname}: ${reason}`);
      }
      throw new AppError("This local control request is not authorized.", 403);
    }
  }
  return { token, authorize };
}
