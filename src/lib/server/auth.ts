import { config } from "./env";
import { hmac, hmacVerify } from "./secret";
import { HttpError } from "./http";

export interface AuthUser {
  uid: string;
  name: string;
  email?: string;
  photoURL?: string;
  isAdmin: boolean;
  /** False when Pepper is invite-only and this listener isn't on the list. */
  invited: boolean;
}

/** Whether a signed-in listener may use Pepper (see LISTENER_EMAILS). */
export function isInvited(email: string | undefined, verified: boolean, isAdmin: boolean, allow = config.listenerEmails): boolean {
  if (isAdmin || !allow.length) return true;
  if (!email || !verified) return false;
  const e = email.toLowerCase();
  return allow.some((a) => (a.startsWith("@") ? e.endsWith(a) : a === e));
}

const DEMO_TTL_MS = 30 * 24 * 3600 * 1000;

/** Local mode only: issue a signed demo token. */
export function issueDemoToken(user: { uid: string; name: string; admin: boolean }): string {
  if (!config.allowDemoLogin) throw new HttpError(403, "Demo login is disabled");
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + DEMO_TTL_MS })).toString("base64url");
  return `demo.${payload}.${hmac(`demo.${payload}`)}`;
}

function verifyDemoToken(token: string): AuthUser | null {
  if (!config.allowDemoLogin) return null;
  const [kind, payload, sig] = token.split(".");
  if (kind !== "demo" || !payload || !sig || !hmacVerify(`demo.${payload}`, sig)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      uid: string;
      name: string;
      admin: boolean;
      exp: number;
    };
    if (data.exp < Date.now()) return null;
    return { uid: data.uid, name: data.name, isAdmin: Boolean(data.admin), invited: true };
  } catch {
    return null;
  }
}

async function verifyFirebaseToken(token: string): Promise<AuthUser | null> {
  const { getAuth } = await import("firebase-admin/auth");
  const { firebaseAdminApp } = await import("./firebase-admin");
  try {
    const d = await getAuth(firebaseAdminApp()).verifyIdToken(token);
    const email = d.email?.toLowerCase();
    const isAdmin = d.admin === true || Boolean(email && d.email_verified && config.adminEmails.includes(email));
    return {
      uid: d.uid,
      name: (d.name as string | undefined) || email?.split("@")[0] || "Listener",
      email,
      photoURL: d.picture,
      isAdmin,
      invited: isInvited(email, Boolean(d.email_verified), isAdmin),
    };
  } catch {
    return null;
  }
}

export async function verifyToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  if (token.startsWith("demo.")) return verifyDemoToken(token);
  if (config.auth === "firebase") return verifyFirebaseToken(token);
  return null;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h?.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return null;
}

export async function getUser(req: Request): Promise<AuthUser | null> {
  return verifyToken(bearer(req));
}

export async function requireUser(req: Request): Promise<AuthUser> {
  const u = await getUser(req);
  if (!u) throw new HttpError(401, "Sign in required");
  if (!u.invited) {
    throw new HttpError(403, `Listening is invite-only. Ask the admin to add ${u.email ?? "your email"} to the guest list.`, "not_invited");
  }
  return u;
}

export async function requireAdmin(req: Request): Promise<AuthUser> {
  const u = await requireUser(req);
  if (!u.isAdmin) throw new HttpError(403, "Admins only");
  return u;
}
