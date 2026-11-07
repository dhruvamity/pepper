import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, route } from "@/lib/server/http";
import { isActive, isMember, jamId, jamSnapshot } from "@/lib/server/jam";

export const maxDuration = 60;

export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const { uid } = await requireUser(req);
  const id = jamId.parse((await params).id);
  const db = await repo();
  const initial = await db.getJam(id);
  if (!isActive(initial) || !isMember(initial, uid)) throw new HttpError(404, "You are no longer in this Jam");

  const encoder = new TextEncoder();
  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      const finish = () => {
        if (!active) return;
        dispose();
        controller.close();
      };
      // Reconnect periodically to stay within serverless request limits and recheck auth.
      const timeout = setTimeout(finish, Math.min(50_000, initial.expiresAt - Date.now()));
      const heartbeat = setInterval(() => send({ serverTime: Date.now() }), 12_000);
      let unwatch = () => {};
      let active = true;
      dispose = () => {
        if (!active) return;
        active = false;
        clearTimeout(timeout);
        clearInterval(heartbeat);
        unwatch();
        req.signal.removeEventListener("abort", finish);
      };
      send(jamSnapshot(initial, uid));
      let version = initial.version;
      const watch = (doc: Parameters<typeof jamSnapshot>[0]) => {
        if (!active) return;
        const snapshot = jamSnapshot(doc, uid);
        if (!snapshot.jam) {
          send(snapshot);
          finish();
        } else if (snapshot.jam.version > version) {
          version = snapshot.jam.version;
          send(snapshot);
        }
      };
      try {
        unwatch = db.watchJam(id, watch, (error) => {
          if (!active) return;
          dispose();
          controller.error(error);
        });
      } catch (error) {
        dispose();
        throw error;
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
