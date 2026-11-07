import { config, describeBackends } from "@/lib/server/env";
import { json } from "@/lib/server/http";

export async function GET() {
  const b = describeBackends();
  return json({
    auth: config.auth,
    demoLogin: config.allowDemoLogin,
    db: b.db,
    storage: b.storage,
  });
}
