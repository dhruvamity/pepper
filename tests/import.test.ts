/** Bulk import logic: fingerprints, merging copies, matching the library, playlist names and order. */
import { describe, expect, it } from "vitest";
import { catalogLookup, findExisting, groupRecordings, sameSongByTags, youtubeId, type ScannedFile } from "@/lib/import/dedupe";
import { decodeFingerprint, encodeFingerprint, fingerprintDistance, parseFpcalc } from "@/lib/import/fingerprint";
import { orderFiles, parseOrderListing, playlistIdFor, playlistNameFromFolder } from "@/lib/import/order";
import { songKey } from "@/lib/metadata/normalize";
import { trackIdFromSha } from "@/lib/server/catalog";
import type { CatalogTrack } from "@/lib/types";
import { seededRandom } from "@/lib/util";

const rand = seededRandom(3);
const fp = (n = 900) => Uint32Array.from({ length: n }, () => Math.floor(rand() * 2 ** 32) >>> 0);
/** The same audio after a lossy re-encode: a few bits flip. */
const noisy = (src: Uint32Array, flips = 0.02) => Uint32Array.from(src, (v) => (rand() < flips * 32 ? (v ^ (1 << Math.floor(rand() * 32))) >>> 0 : v));

let n = 0;
function file(over: Partial<ScannedFile>): ScannedFile {
  n++;
  return { rel: `f${n}.mp3`, folder: "A", size: 1000 + n, mtimeMs: n, sha256: `${n}`.padStart(64, "0"), durationMs: 200_000, title: `Song ${n}`, artists: ["Someone"], bitrate: 320_000, ...over };
}

describe("fingerprints", () => {
  it("parses fpcalc output and tells same audio from different audio", () => {
    const parsed = parseFpcalc("DURATION=211\nFINGERPRINT=1,2,4294967295\n");
    expect(parsed?.duration).toBe(211);
    expect([...parsed!.values]).toEqual([1, 2, 4294967295]);
    const a = fp();
    expect(fingerprintDistance(a, a)).toBe(0);
    expect(fingerprintDistance(a, noisy(a))).toBeLessThan(0.05);
    expect(fingerprintDistance(a, a.slice(5))).toBe(0); // the copy starts a little later
    expect(fingerprintDistance(a, fp())).toBeGreaterThan(0.4);
    expect([...decodeFingerprint(encodeFingerprint(a))]).toEqual([...a]);
  });
});

describe("merging copies", () => {
  it("merges identical files, the same link and the same audio; keeps the best copy", () => {
    const audio = fp();
    const a = file({ title: "Humdard", hasCover: true, sha256: "a".repeat(64), fingerprint: audio });
    const sameBytes = file({ sha256: "a".repeat(64), fingerprint: audio, folder: "B" });
    const reencoded = file({ title: 'Humdard (From "Ek Villain")', bitrate: 128_000, fingerprint: noisy(audio), durationMs: 201_000 });
    const linkA = file({ title: "Channa Ve", sourceUrl: "https://music.youtube.com/watch?v=epm7tAtEvYA", fingerprint: fp() });
    const linkB = file({ title: "Channa Ve", sourceUrl: "https://music.youtube.com/watch?v=epm7tAtEvYA&si=x", fingerprint: fp(), durationMs: 202_000 });
    const other = file({ title: "Tum Hi Ho", fingerprint: fp() });
    const empty = file({ error: "empty file (0 bytes)" });
    const groups = groupRecordings([a, sameBytes, reencoded, linkA, linkB, other, empty]);
    expect(groups).toHaveLength(3);
    const humdard = groups.find((g) => g.files.includes(a))!;
    expect(humdard.files).toHaveLength(3);
    expect(humdard.primary).toBe(a); // 320 kbps with a cover beats the 128 kbps copy
    expect(humdard.reasons).toEqual(expect.arrayContaining(["same file", "same audio"]));
    expect(groups.find((g) => g.files.includes(linkA))!.files).toContain(linkB);
    expect(youtubeId("https://youtu.be/epm7tAtEvYA")).toBe("epm7tAtEvYA");
  });

  it("keeps different recordings apart even with the same title and artist", () => {
    const rest1 = file({ title: "Rest", artists: ["Soothing Oasis"], durationMs: 131_000, fingerprint: fp() });
    const rest2 = file({ title: "Rest", artists: ["Soothing Oasis"], durationMs: 129_000, fingerprint: fp() });
    expect(groupRecordings([rest1, rest2])).toHaveLength(2);
  });

  it("without fingerprints, matches on title + artist + length but not across versions", () => {
    const base = file({ title: "Ishq de Fanniyar", artists: ["Jyotica Tangri"] });
    const same = file({ title: 'Ishq de Fanniyar (From "Fitoor")', artists: ["Jyotica Tangri", "Amit Trivedi"], durationMs: 201_500 });
    const female = file({ title: "Ishq de Fanniyar - Female Version", artists: ["Jyotica Tangri"] });
    const otherArtist = file({ title: "Ishq de Fanniyar", artists: ["Someone Else"] });
    expect(sameSongByTags(base, same)).toBe(true);
    expect(sameSongByTags(base, female)).toBe(false);
    expect(sameSongByTags(base, otherArtist)).toBe(false);
    expect(groupRecordings([base, same, female, otherArtist])).toHaveLength(3);
  });

  it("recognises songs already in the library by file hash or by tags", () => {
    const sha = "b".repeat(64);
    const existing: CatalogTrack = {
      id: trackIdFromSha(sha),
      title: "Channa Ve",
      subtitle: 'From "Bhoot"',
      artists: [{ id: "mansheel-gujral", name: "Mansheel Gujral" }],
      album: { id: "x", title: "x" },
      genres: [],
      durationMs: 211_000,
      hasLyrics: false,
      createdAt: 0,
    };
    const lookup = catalogLookup([existing]);
    const [byHash] = groupRecordings([file({ sha256: sha })]);
    expect(findExisting(byHash, lookup, trackIdFromSha)).toBe(existing.id);
    const [byTags] = groupRecordings([file({ title: 'Channa Ve - From "Bhoot - Part One"', artists: ["Mansheel Gujral"], durationMs: 212_000 })]);
    expect(findExisting(byTags, lookup, trackIdFromSha)).toBe(existing.id);
    const [differentVersion] = groupRecordings([file({ title: "Channa Ve (Reprise)", artists: ["Mansheel Gujral"], durationMs: 211_000 })]);
    expect(findExisting(differentVersion, lookup, trackIdFromSha)).toBeUndefined();
  });
});

describe("playlists from folders", () => {
  it("names playlists after their folder without the number, with stable ids", () => {
    expect(playlistNameFromFolder("01 - Soft romantic hindi songs 2026")).toBe("Soft romantic hindi songs 2026");
    expect(playlistNameFromFolder("16 - shahrukh khan, my husband")).toBe("shahrukh khan, my husband");
    expect(playlistNameFromFolder("Road_Trip")).toBe("Road Trip");
    expect(playlistIdFor("01 - Soft romantic hindi songs 2026")).toBe(playlistIdFor("01 - Soft romantic hindi songs 2026"));
    expect(playlistIdFor("01 - Soft romantic hindi songs 2026")).toMatch(/^pl_soft-romantic-hindi-songs-2026-\w{4}$/);
  });

  it("keeps the archive's song order, then download order", () => {
    const listing = parseOrderListing(
      [
        "## 📁 01 - Soft romantic hindi songs 2026 (28/28 downloaded | 275.89 MB)",
        "",
        "- [x] `[Msg 0003]` Arijit Singh - Dekha Hazaro Dafaa.mp3 (8.08 MB | ⏱ 03:27)",
        "- [x] `[Msg 0004]` Jyotica Tangri - Ishq de Fanniyar.mp3 (6.95 MB | ⏱ 02:57)",
        "- [ ] `[Msg 0005]` Arijit Singh - Yeh Fitoor Mera.mp3 (10.97 MB | ⏱ 04:43)",
        "## 📁 02 - Sleep music (1/1 downloaded | 5 MB)",
        "- [x] `[Msg 0040]` Soothing Oasis - Rest.mp3 (5 MB | ⏱ 02:11)",
      ].join("\r\n"),
    );
    expect(listing.get("01 - Soft romantic hindi songs 2026")).toEqual(["Arijit Singh - Dekha Hazaro Dafaa.mp3", "Jyotica Tangri - Ishq de Fanniyar.mp3", "Arijit Singh - Yeh Fitoor Mera.mp3"]);
    const files = [
      { rel: "01/Zed.mp3", mtimeMs: 1 },
      { rel: "01/Jyotica Tangri - Ishq de Fanniyar.mp3", mtimeMs: 9 },
      { rel: "01/Arijit Singh - Dekha Hazaro Dafaa.mp3", mtimeMs: 5 },
      { rel: "01/Alpha.mp3", mtimeMs: 3 },
    ];
    expect(orderFiles(files, listing.get("01 - Soft romantic hindi songs 2026")).map((f) => f.rel)).toEqual([
      "01/Arijit Singh - Dekha Hazaro Dafaa.mp3",
      "01/Jyotica Tangri - Ishq de Fanniyar.mp3",
      "01/Zed.mp3", // not in the listing: download order (file time)
      "01/Alpha.mp3",
    ]);
    expect(orderFiles(files).map((f) => f.rel)[0]).toBe("01/Zed.mp3"); // no listing: download order
  });
});

describe("song versions", () => {
  it("gives every version of a song the same key", () => {
    expect(songKey("Tum Hi Ho")).toBe(songKey("Tum Hi Ho (Reprise)"));
    expect(songKey("Tum Hi Ho")).toBe(songKey("Tum Hi Ho - Female Version"));
    expect(songKey("Tum Hi Ho")).not.toBe(songKey("Tum Hi Ho Bandhu"));
    expect(songKey('Channa Ve - From "Bhoot - Part One: The Haunted Ship"')).toBe("channa ve");
    expect(songKey("Kalank (Title Track)")).toBe("kalank");
    expect(songKey("Lo-Fi Sajni (Slowed + Reverb)")).toBe("sajni");
  });
});
