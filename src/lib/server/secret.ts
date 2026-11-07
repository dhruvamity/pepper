import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "./env";

const g = globalThis as unknown as { __pepperSecret?: string };

/** APP_SECRET, or a random secret persisted in the local data dir (local mode only). */
export function appSecret(): string {
  if (g.__pepperSecret) return g.__pepperSecret;
  if (config.appSecret) return (g.__pepperSecret = config.appSecret);
  const file = path.join(config.dataDir, "secret");
  try {
    if (existsSync(file)) return (g.__pepperSecret = readFileSync(file, "utf8").trim());
    mkdirSync(config.dataDir, { recursive: true });
    const s = randomBytes(32).toString("hex");
    writeFileSync(file, s, { mode: 0o600 });
    return (g.__pepperSecret = s);
  } catch {
    // Read-only file system (serverless) — fall back to a per-process secret.
    return (g.__pepperSecret = randomBytes(32).toString("hex"));
  }
}

export function hmac(payload: string): string {
  return createHmac("sha256", appSecret()).update(payload).digest("base64url");
}

export function hmacVerify(payload: string, signature: string): boolean {
  const expected = Buffer.from(hmac(payload));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
