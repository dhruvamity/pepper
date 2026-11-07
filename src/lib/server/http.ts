import { ZodError } from "zod";
import { StorageFullError } from "./storage/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason the client can react to (e.g. "not_invited"). */
    public code?: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "private, no-store", ...(init?.headers ?? {}) },
  });
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap a route handler: maps thrown errors to JSON responses with proper status codes. */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
      if (err instanceof ZodError) {
        return json({ error: "Invalid request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
      }
      if (err instanceof StorageFullError) return json({ error: err.message }, { status: 507 });
      console.error("[pepper] API error", err);
      return json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
    }
  };
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Expected a JSON body");
  }
}
