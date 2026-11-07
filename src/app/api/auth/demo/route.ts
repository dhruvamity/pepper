import { z } from "zod";
import { issueDemoToken } from "@/lib/server/auth";
import { config } from "@/lib/server/env";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { slugify } from "@/lib/util";

const body = z.object({
  name: z.string().trim().min(1).max(60),
  role: z.enum(["admin", "listener"]),
});

/** Local mode sign-in: no passwords, a signed token for a named demo user. */
export const POST = route(async (req) => {
  if (!config.allowDemoLogin) throw new HttpError(403, "Demo login is disabled — configure Firebase Auth");
  const { name, role } = body.parse(await readJson(req));
  const uid = `demo-${role}-${slugify(name, 30) || "user"}`;
  const token = issueDemoToken({ uid, name, admin: role === "admin" });
  return json({ token, user: { uid, name, isAdmin: role === "admin" } });
});
