import { createHash } from "node:crypto";

export function connectionIdFor(a: string, b: string) {
  return `c_${createHash("sha256").update([a, b].sort().join("\0")).digest("hex").slice(0, 32)}`;
}
