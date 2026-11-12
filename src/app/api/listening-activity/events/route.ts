import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { route } from "@/lib/server/http";
import type { ListeningActivity } from "@/lib/types";

export const maxDuration = 60;

/**
 * Live listening activity of accepted contacts as an NDJSON stream (same shape as Jam events).
 * The set of contacts allowed to be seen is fixed per connection; the client reconnects every
 * ~50 s (serverless limit), which also picks up new contacts and changed privacy settings.
 */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const db = await repo();
  const rows = (await db.listConnections(user.uid)).filter((c) => c.status === "accepted");
  const uids = rows.map((c) => (c.requesterUid === user.uid ? c.otherUid : c.requesterUid));
  const profiles = await Promise.all(uids.map((uid) => db.getUser(uid)));
  const allowed = new Set(uids.filter((uid, i) => profiles[i]?.activitySharing && profiles[i]?.activityVisibleTo?.includes(user.uid)));
  const visible = (list: ListeningActivity[]) => list.filter((a) => allowed.has(a.uid) && a.expiresAt > Date.now());

  const encoder = new TextEncoder();
  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let active = true;
      const send = (value: unknown) => controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      const finish = () => {
        if (!active) return;
        dispose();
        controller.close();
      };
      const timeout = setTimeout(finish, 50_000);
      const heartbeat = setInterval(() => send({ serverTime: Date.now() }), 12_000);
      let unwatch = () => {};
      dispose = () => {
        if (!active) return;
        active = false;
        clearTimeout(timeout);
        clearInterval(heartbeat);
        unwatch();
        req.signal.removeEventListener("abort", finish);
      };
      let last = "";
      const emit = (list: ListeningActivity[]) => {
        if (!active) return;
        const activities = visible(list);
        const key = JSON.stringify(activities);
        if (key === last) return;
        last = key;
        send({ serverTime: Date.now(), activities });
      };
      if (!allowed.size) send({ serverTime: Date.now(), activities: [] });
      else {
        try {
          unwatch = db.watchActivities([...allowed], emit, (error) => {
            if (!active) return;
            dispose();
            controller.error(error);
          });
        } catch (error) {
          dispose();
          throw error;
        }
      }
      if (req.signal.aborted) finish();
      else req.signal.addEventListener("abort", finish, { once: true });
    },
    cancel() {
      dispose();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
