import { createHash, randomBytes } from "node:crypto";
import { INVITE_ALPHABET } from "@/lib/invite";
import type { UserProfile } from "@/lib/types";
import type { Repo } from "./db";

export function connectionIdFor(a: string, b: string) {
  return `c_${createHash("sha256").update([a, b].sort().join("\0")).digest("hex").slice(0, 32)}`;
}

export function newInviteCode() {
  let code = "";
  for (const b of randomBytes(12)) code += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  return code;
}

/** The listener's current invite code, creating one the first time it is asked for (or a fresh one when rotating). */
export async function ensureInviteCode(db: Repo, profile: UserProfile, rotate = false): Promise<UserProfile> {
  if (profile.inviteCode && !rotate) return profile;
  const next = { ...profile, inviteCode: newInviteCode() };
  await db.saveUser(next);
  return next;
}
