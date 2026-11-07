/**
 * Server configuration. Everything is optional: with no cloud credentials Pepper runs in
 * "local mode" (JSON database + files on disk + demo login), which is ideal for trying it out.
 * Add Firebase / R2 / B2 credentials and the same code switches to the cloud backends.
 */
import path from "node:path";
import { providerName } from "../util";

const env = process.env;

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** A bucket's quota in bytes. 0 is allowed: the bucket keeps serving its files but takes no new ones. */
function quota(v: string | undefined, fallbackGb = 10): number {
  const n = Number(v?.trim() || NaN);
  return (Number.isFinite(n) && n >= 0 ? n : fallbackGb) * GB;
}

function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export interface S3ProviderConfig {
  /** "r2", "b2", "b2_2", … (see ProviderId). */
  id: string;
  kind: "r2" | "b2";
  label: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  quotaBytes: number;
}

function r2Config(): S3ProviderConfig | null {
  const accountId = env.R2_ACCOUNT_ID;
  const endpoint = env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  if (!endpoint || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) return null;
  return {
    id: "r2",
    kind: "r2",
    label: "Cloudflare R2",
    endpoint,
    region: env.R2_REGION || "auto",
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "") || undefined,
    quotaBytes: quota(env.R2_QUOTA_GB),
  };
}

/**
 * One Backblaze account: B2_* is the first (id "b2"), B2_2_*, B2_3_*, … are more (ids "b2_2",
 * "b2_3", …). Each needs an endpoint (or region), key id, application key and bucket.
 */
function b2Config(n?: number): S3ProviderConfig | null {
  const prefix = n ? `B2_${n}_` : "B2_";
  const get = (k: string) => env[prefix + k]?.trim() || undefined;
  const region = get("REGION") || get("ENDPOINT")?.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/)?.[1] || "";
  const endpoint = get("ENDPOINT") || (region ? `https://s3.${region}.backblazeb2.com` : "");
  const bucket = get("BUCKET");
  const accessKeyId = get("KEY_ID");
  const secretAccessKey = get("APPLICATION_KEY");
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    const missing = Object.entries({ ENDPOINT: endpoint, BUCKET: bucket, KEY_ID: accessKeyId, APPLICATION_KEY: secretAccessKey })
      .filter(([, v]) => !v)
      .map(([k]) => prefix + k);
    // Stay quiet about accounts that are not set up at all.
    if (missing.length < 4) console.warn(`[pepper] Ignoring Backblaze account ${prefix}*: ${missing.join(", ")} not set`);
    return null;
  }
  const id = n ? `b2_${n}` : "b2";
  return {
    id,
    kind: "b2",
    label: get("LABEL") || providerName(id),
    endpoint,
    region: region || "us-west-004",
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: get("PUBLIC_BASE_URL")?.replace(/\/$/, ""),
    quotaBytes: quota(get("QUOTA_GB")),
  };
}

/** Numbers of the extra Backblaze accounts (B2_2_*, B2_3_*, …), in order. */
function extraB2Accounts(): number[] {
  const found = new Set<number>();
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^B2_(\d+)_[A-Z_]+$/);
    if (m && v?.trim() && Number(m[1]) > 0) found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

/** Drop accounts that point at a bucket already in the list (a copy-paste slip would count it twice). */
function uniqueBuckets(list: (S3ProviderConfig | null)[]): S3ProviderConfig[] {
  const seen = new Map<string, string>();
  const out: S3ProviderConfig[] = [];
  for (const p of list) {
    if (!p) continue;
    const where = `${p.endpoint.replace(/\/+$/, "")}/${p.bucket}`;
    const first = seen.get(where);
    if (first) {
      console.warn(`[pepper] Ignoring ${p.id}: bucket ${p.bucket} is already used by ${first}`);
      continue;
    }
    seen.set(where, p.id);
    out.push(p);
  }
  return out;
}

function firebaseCredentials(): boolean {
  return Boolean(
    env.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
      env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) ||
      env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

// Order matters for fill-first placement: R2, then Backblaze accounts 1, 2, 3, …
const s3Providers = uniqueBuckets([r2Config(), b2Config(), ...extraB2Accounts().map((n) => b2Config(n))]);
const hasCredentials = firebaseCredentials();
// The Firebase Emulator Suite needs no credentials (firebase-admin reads these env vars itself).
const authEmulator = Boolean(env.FIREBASE_AUTH_EMULATOR_HOST && env.FIREBASE_PROJECT_ID);
const firestoreEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST && env.FIREBASE_PROJECT_ID);
const firebaseServer = hasCredentials || authEmulator;
const firebaseClient = Boolean(env.NEXT_PUBLIC_FIREBASE_API_KEY && env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
const dbOverride = env.PEPPER_DB === "local" || env.PEPPER_DB === "firestore" ? env.PEPPER_DB : null;

export const config = {
  isProd: env.NODE_ENV === "production",
  // Local-mode data folder (resolved at runtime; excluded from build-time file tracing).
  dataDir: path.resolve(/* turbopackIgnore: true */ process.cwd(), env.PEPPER_DATA_DIR || ".data"),
  appSecret: env.APP_SECRET || "",

  db: (dbOverride ?? (hasCredentials || firestoreEmulator ? "firestore" : "local")) as "firestore" | "local",
  auth: firebaseServer && firebaseClient ? ("firebase" as const) : ("local" as const),
  allowDemoLogin: !(firebaseServer && firebaseClient) && (env.NODE_ENV !== "production" || bool(env.PEPPER_ALLOW_DEMO_LOGIN, false)),

  storage: {
    kind: s3Providers.length ? ("s3" as const) : ("local" as const),
    s3: s3Providers,
    strategy: (env.STORAGE_STRATEGY === "balance" ? "balance" : "fill-first") as "balance" | "fill-first",
    /** With fill-first, this bucket fills before the others (default R2, for its free egress). */
    primary: env.STORAGE_PRIMARY?.trim().toLowerCase() || "r2",
    localQuotaBytes: {
      r2: num(env.LOCAL_R2_QUOTA_MB, 10 * 1024) * MB,
      b2: num(env.LOCAL_B2_QUOTA_MB, 10 * 1024) * MB,
    },
    /** Keep this fraction of every bucket free as a safety margin. */
    reserveRatio: 0.02,
  },

  firebase: {
    projectId: env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    serviceAccountBase64: env.FIREBASE_SERVICE_ACCOUNT_BASE64,
    serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
  },

  adminEmails: list(env.ADMIN_EMAILS),
  /**
   * Invite-only: when set, only these listeners (plus admins) can use Pepper. Emails, or
   * "@example.com" for everyone at a domain. Empty: anyone who signs in can listen.
   */
  listenerEmails: list(env.LISTENER_EMAILS),

  enrich: {
    lyrics: bool(env.ENRICH_LYRICS, true),
    artistImages: bool(env.ENRICH_ARTIST_IMAGES, true),
    /** Genre lookups (Apple's catalog) and related artists (Deezer) for autoplay. */
    genres: bool(env.ENRICH_GENRES, true),
  },
};

export type AppConfig = typeof config;

export function describeBackends() {
  return {
    db: config.db,
    auth: config.auth,
    storage: config.storage.kind,
    providers:
      config.storage.kind === "s3"
        ? config.storage.s3.map((p) => ({ id: p.id, label: p.label, bucket: p.bucket as string | undefined, quotaBytes: p.quotaBytes }))
        : (["r2", "b2"] as const).map((id) => ({
            id: id as string,
            label: id === "r2" ? "Local disk (R2 slot)" : "Local disk (B2 slot)",
            bucket: undefined as string | undefined,
            quotaBytes: config.storage.localQuotaBytes[id],
          })),
    strategy: config.storage.strategy,
  };
}
