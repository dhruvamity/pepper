import { requireAdmin } from "@/lib/server/auth";
import { describeBackends } from "@/lib/server/env";
import { repo } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { providers } from "@/lib/server/storage";

export const GET = route(async (req) => {
  await requireAdmin(req);
  const db = await repo();
  const usage = await db.getStorageUsage();
  const b = describeBackends();
  return json({
    strategy: b.strategy,
    providers: b.providers.map((p) => ({ ...p, used: usage[p.id]?.bytes ?? 0, objects: usage[p.id]?.objects ?? 0 })),
  });
});

/** Re-count what is actually in each bucket (fixes drift in the usage counters). */
export const POST = route(async (req) => {
  await requireAdmin(req);
  const db = await repo();
  const out = [];
  for (const p of providers()) {
    const m = await p.measure();
    await db.setStorageUsage(p.id, m);
    out.push({ id: p.id, ...m });
  }
  return json({ providers: out });
});
