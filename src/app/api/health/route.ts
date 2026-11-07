import { config } from "@/lib/server/env";
import { firebaseAdminApp } from "@/lib/server/firebase-admin";
import { S3Provider } from "@/lib/server/storage/s3";

export const dynamic = "force-dynamic";

/**
 * Deployment self-check: does each backend work with the configured settings? Reports only
 * pass/fail and short reasons — never a secret value. Open /api/health after changing env vars.
 */
export async function GET() {
  const env = process.env;
  const plain = (v: string | undefined) => (v ? /^[\x20-\x7e]+$/.test(v.trim()) : false);
  const settings: Record<string, string> = {};
  const note = (name: string, ok: boolean, why: string) => (settings[name] = ok ? "ok" : why);

  for (const name of ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_APP_ID", "APP_SECRET"]) {
    note(name, plain(env[name]), env[name] ? "contains hidden-preview dots or other stray characters" : "missing");
  }
  const sa = env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (sa) {
    try {
      const j = JSON.parse(Buffer.from(sa, "base64").toString("utf8"));
      note("FIREBASE_SERVICE_ACCOUNT_BASE64", j.project_id === env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && Boolean(j.private_key), "decodes, but is for another project or has no private key");
    } catch {
      note("FIREBASE_SERVICE_ACCOUNT_BASE64", false, "not valid base64 JSON (truncated or masked when pasted?)");
    }
  }
  for (const p of config.storage.s3) {
    const prefix = p.id === "b2" ? "B2_" : p.id === "r2" ? "R2_" : `${p.id.toUpperCase()}_`;
    note(`${prefix}KEY_ID`, plain(p.accessKeyId), "contains stray characters");
    note(`${prefix}APPLICATION_KEY`, plain(p.secretAccessKey), "contains stray characters");
  }

  const timed = async (fn: () => Promise<unknown>) => {
    const t = Date.now();
    try {
      await fn();
      return { ok: true, ms: Date.now() - t };
    } catch (err) {
      return { ok: false, ms: Date.now() - t, error: (err as Error).name + ": " + (err as Error).message.slice(0, 160) };
    }
  };
  const [firestore, ...buckets] = await Promise.all([
    timed(async () => {
      const { getFirestore } = await import("firebase-admin/firestore");
      await getFirestore(firebaseAdminApp()).doc("catalog/meta").get();
    }),
    ...config.storage.s3.map((cfg) => timed(() => new S3Provider(cfg).ping())),
  ]);
  const storage = Object.fromEntries(config.storage.s3.map((cfg, i) => [`${cfg.id} (${cfg.bucket})`, buckets[i]]));
  const ok = firestore.ok && buckets.every((b) => b.ok) && Object.values(settings).every((v) => v === "ok");
  return Response.json(
    { ok, backends: { db: config.db, auth: config.auth, storage: config.storage.kind }, settings, firestore, storage, region: env.VERCEL_REGION ?? null },
    { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } },
  );
}
