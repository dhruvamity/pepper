import { recommend } from "@/lib/recs/engine";
import { requireUser } from "@/lib/server/auth";
import { repo } from "@/lib/server/db";
import { HttpError, json, route } from "@/lib/server/http";
import { isActive, isMember, jamId } from "@/lib/server/jam";
import { loadRecData } from "@/lib/server/recdata";

export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const { uid } = await requireUser(req);
  const id = jamId.parse((await params).id);
  const db = await repo();
  const jam = await db.getJam(id);
  if (!isActive(jam) || !isMember(jam, uid)) throw new HttpError(404, "You are no longer in this Jam");

  const seed = jam.playback.track?.id;
  const seeds = seed ? [seed] : [];
  const { data } = await loadRecData(uid, seeds);
  const exclude = [...new Set([...seeds, ...jam.queue.map((track) => track.id), ...jam.history.slice(-15).map((track) => track.id)])];
  const preferences = await Promise.all(jam.members.map(async (member) => {
    if (member.uid === uid) return data;
    const [taste, library] = await Promise.all([db.getTaste(member.uid), db.getLibrary(member.uid)]);
    return { ...data, taste, likes: library.likes, followed: library.artists };
  }));
  const scores = new Map<string, number>();
  for (const profile of preferences) {
    const picks = recommend(profile, { mode: "mix", seeds, exclude, limit: 30, allowKnown: true });
    picks.forEach(({ id }, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (5 + rank)));
  }
  const tracks = [...scores]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id]) => ({ id, likedBy: preferences.filter((profile) => profile.likes[id]).length }));
  return json({ tracks });
});
