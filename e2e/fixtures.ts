import { expect, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

export interface Session { token: string; user: { uid: string; name: string; isAdmin?: boolean } }
export interface List { id: string; name: string; trackIds: string[]; shared?: boolean }
export const origin = process.env.PEPPER_E2E_ORIGIN!;
if (!origin || new URL(origin).hostname !== "127.0.0.1") throw new Error("Run npm run test:e2e against its isolated local app");

export async function api(path: string, session?: Session, body?: unknown, method = body === undefined ? "GET" : "POST", status = 200) {
  const response = await fetch(origin + path, { method,
    headers: { ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(status);
  return response.json();
}
export async function jamSnapshot(id: string, session: Session) {
  const controller = new AbortController();
  try {
    const response = await fetch(`${origin}/api/jams/${id}/events`, {
      headers: { Authorization: `Bearer ${session.token}` }, signal: controller.signal,
    });
    expect(response.ok).toBeTruthy();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let data = "";
    while (!data.includes("\n")) data += decoder.decode((await reader.read()).value);
    return JSON.parse(data.split("\n")[0]).jam;
  } finally { controller.abort(); }
}
export const login = (name: string, role = "listener"): Promise<Session> => api("/api/auth/demo", undefined, { name, role });

/** Real, locally generated audio: no external music or ffmpeg dependency. */
export function tone(frequency: number) {
  const rate = 8000, samples = rate * 30;
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * frequency / rate) * 2500), 44 + i * 2);
  return b;
}
export async function uploadSong(admin: Session, title: string, frequency: number, artist = "E2E Artist") {
  const bytes = tone(frequency), contentType = "audio/wav";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { trackId, duplicate, audio } = await api("/api/admin/uploads", admin, { audio: { sha256, size: bytes.length, ext: "wav", contentType } });
  if (!duplicate) {
    expect((await fetch(new URL(audio.upload.url, origin), { method: "PUT", headers: audio.upload.headers, body: bytes })).ok).toBeTruthy();
    await api("/api/admin/tracks", admin, { trackId, title, rawTitle: title, durationMs: 30000, artists: [artist], album: "E2E Album", genres: ["Pop"],
      audio: { provider: audio.provider, key: audio.key, contentType, size: bytes.length, sha256, originalName: title + ".wav" },
      lyrics: { plain: "First line\nSecond line", synced: [{ t: 0, text: "First line" }, { t: 10000, text: "Second line" }], source: "tag" },
      enrich: { lyrics: false, artistImages: false },
    }, "POST", 201);
  }
  return trackId as string;
}
export async function seed() {
  const admin = await login("E2E Admin", "admin"), listener = await login("E2E Listener");
  const ids: string[] = [];
  for (const [i, word] of ["One", "Two", "Three", "Four", "Five", "Six"].entries()) ids.push(await uploadSong(admin, `E2E Song ${word}`, 220 + i * 55));
  const list = async (name: string, trackIds: string[], session = listener): Promise<List> => (await api("/api/playlists", session, { name, trackIds }, "POST", 201)).playlist;
  const a = await list("E2E Playlist A", ids.slice(0, 2));
  const b = await list("E2E Playlist B", ids.slice(2, 4));
  const curated = await list("E2E Curated", ids, admin);
  return { admin, listener, ids, a, b, curated, list };
}
export async function authenticate(context: BrowserContext, session: Session) {
  await context.addInitScript((session) => {
    localStorage.setItem("pepper.demo", JSON.stringify(session));
    const NativeAudio = window.Audio;
    window.testAudio = [];
    window.Audio = new Proxy(NativeAudio, { construct(target, args) {
      const audio = new target(...args); window.testAudio.push(audio); return audio;
    } });
  }, session);
}
declare global { interface Window { testAudio: HTMLAudioElement[] } }
export async function playing(page: Page, id: string) {
  await expect.poll(() => page.evaluate(() => {
    const audio = window.testAudio?.[0];
    return audio && !audio.paused && audio.currentTime > 0 ? audio.src : "";
  })).toContain(id);
}
export async function navigate(page: Page, path: string) {
  // Exercise Next's normal client navigation through an existing link.
  const link = page.locator(`a[href="${path}"]:visible`).first();
  await link.click();
  await expect(page).toHaveURL(origin + path);
}
