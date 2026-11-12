import type { MediaRef, UploadIntent } from "@/lib/types";
import { parseMediaRef } from "@/lib/util";
import { repo } from "./db";
import { provider } from "./storage";

const UPLOAD_BATCH = 50;
const JAM_BATCH = 500;
const ACTIVITY_BATCH = 500;
const objectId = (providerId: string, key: string) => `${providerId}:${key}`;

function collectImageRefs(refs: Set<string>, image?: { sm: MediaRef; lg: MediaRef }) {
  if (!image) return;
  for (const value of [image.sm, image.lg]) {
    const ref = parseMediaRef(value);
    if (ref) refs.add(objectId(ref.provider, ref.key));
  }
}

function trackIdForAudio(key: string) {
  return key.match(/^audio\/(t[a-f0-9]{15})\.[a-z0-9]{2,5}$/i)?.[1];
}

async function isReferenced(intent: UploadIntent, providerId: string, key: string, imageRefs: Set<string>, active: UploadIntent[]) {
  const object = objectId(providerId, key);
  if (imageRefs.has(object) || active.some((session) => session.objects.some((item) => objectId(item.provider, item.key) === object))) return true;
  if (intent.target?.kind === "playlist") {
    const refs = new Set<string>();
    collectImageRefs(refs, (await (await repo()).getPlaylist(intent.target.id))?.cover);
    return refs.has(object);
  }
  const trackId = intent.target?.kind === "track" ? intent.target.id : trackIdForAudio(key);
  if (!trackId) return false;
  const track = await (await repo()).getTrack(trackId);
  return Boolean(track?.audio.provider === providerId && track.audio.key === key);
}

/** Removes only expired, explicitly tracked uploads that are still unused anywhere in Pepper. */
export async function runMaintenance(now = Date.now()) {
  const db = await repo();
  const [expired, active, catalog] = await Promise.all([
    db.listExpiredUploadIntents(now, UPLOAD_BATCH),
    db.listActiveUploadIntents(now, 2000),
    db.getCatalog(),
  ]);
  const imageRefs = new Set<string>();
  for (const track of catalog.tracks) collectImageRefs(imageRefs, track.cover);
  for (const artist of Object.values(catalog.artists)) collectImageRefs(imageRefs, artist.image);
  for (const playlist of catalog.playlists ?? []) collectImageRefs(imageRefs, playlist.cover);

  let deletedObjects = 0;
  let removedIntents = 0;
  let failedIntents = 0;
  const expiredObjects = new Set<string>();
  for (const intent of expired) {
    let failed = false;
    for (const object of intent.objects) {
      const id = objectId(object.provider, object.key);
      if (expiredObjects.has(id) || await isReferenced(intent, object.provider, object.key, imageRefs, active)) continue;
      const allowed = /^audio\/t[a-f0-9]{15}\.[a-z0-9]{2,5}$/i.test(object.key) || /^img\/(covers|artists)\/[a-zA-Z0-9._-]+$/.test(object.key);
      if (!allowed) {
        failed = true;
        continue;
      }
      const storage = provider(object.provider);
      if (!storage) {
        failed = true;
        continue;
      }
      try {
        await storage.delete(object.key);
        expiredObjects.add(id);
        deletedObjects++;
      } catch (error) {
        failed = true;
        console.warn("[pepper] abandoned upload cleanup failed", object.provider, object.key, error);
      }
    }
    if (failed) {
      failedIntents++;
      continue;
    }
    await db.deleteUploadIntent(intent.id);
    removedIntents++;
  }
  const [expiredJams, expiredJamRequests, expiredActivities] = await Promise.all([
    db.deleteExpiredJams(now, JAM_BATCH),
    db.deleteExpiredJamRequests(now, JAM_BATCH),
    db.deleteExpiredActivities(now, ACTIVITY_BATCH),
  ]);
  return { examinedUploadIntents: expired.length, removedUploadIntents: removedIntents, deletedObjects, failedUploadIntents: failedIntents, deletedJams: expiredJams, deletedJamRequests: expiredJamRequests, deletedActivities: expiredActivities };
}
