import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFile } from "music-metadata";
import {
  cleanText,
  fromMusicMetadata,
  normalizeGenres,
  normalizeTags,
  parseFileName,
  splitArtists,
  splitTitle,
} from "@/lib/metadata/normalize";
import { parseLrc } from "@/lib/metadata/lrc";

const SAMPLE =
  process.env.PEPPER_SAMPLE_MP3 ??
  "/Users/dhruv/Downloads/Mansheel_Gujral,_Akhil_Sachdeva_Channa_Ve_From_Bhoot_Part.mp3";

describe("reference file (spotDL / YouTube Music style tags)", () => {
  it.skipIf(!existsSync(SAMPLE))("extracts every field correctly", async () => {
    const meta = await parseFile(SAMPLE);
    const { tags, format, picture } = fromMusicMetadata(meta);
    const d = normalizeTags(tags, format, SAMPLE);

    expect(d.title).toBe("Channa Ve");
    expect(d.subtitle).toBe('From "Bhoot - Part One: The Haunted Ship"');
    expect(d.rawTitle).toBe('Channa Ve - From "Bhoot - Part One: The Haunted Ship"');
    expect(d.film).toBe("Bhoot - Part One: The Haunted Ship");
    expect(d.artists).toEqual(["Mansheel Gujral", "Akhil Sachdeva"]);
    expect(d.albumArtist).toBe("Akhil Sachdeva");
    expect(d.album).toBe('Channa Ve (From "Bhoot - Part One: The Haunted Ship" / Original Motion Picture Soundtrack)');
    expect(d.genres).toEqual(["Modern Bollywood"]);
    expect(d.year).toBe(2020);
    expect(d.releaseDate).toBe("2020-02-12");
    expect(d.trackNo).toBe(1);
    expect(d.trackTotal).toBe(1);
    expect(d.label).toBe("Zee Music Company");
    expect(d.copyright).toBe("© 2020 Zee Music Company");
    expect(d.sourceUrl).toBe("https://music.youtube.com/watch?v=epm7tAtEvYA");
    expect(d.durationMs).toBeGreaterThan(211_000);
    expect(d.durationMs).toBeLessThan(212_000);
    expect(d.format.bitrate).toBe(320000);
    expect(d.format.sampleRate).toBe(48000);
    expect(picture?.format).toBe("image/jpeg");
    expect(picture?.data.length).toBeGreaterThan(100_000);
    expect(d.warnings).toEqual([]);
  });
});

describe("cleanText", () => {
  it("strips download-site watermarks and video noise", () => {
    expect(cleanText("Kesariya (PagalWorld.com)")).toBe("Kesariya");
    expect(cleanText("Tum Hi Ho - DJMaza.Info")).toBe("Tum Hi Ho");
    expect(cleanText("Raataan Lambiyan [www.Songs.PK]")).toBe("Raataan Lambiyan");
    expect(cleanText("Apna Bana Le (Official Video)")).toBe("Apna Bana Le");
    expect(cleanText("Pasoori &amp; More")).toBe("Pasoori & More");
    expect(cleanText("Love You Zindagi (Club Mix)")).toBe("Love You Zindagi (Club Mix)");
  });
});

describe("splitArtists", () => {
  it("handles the common separators", () => {
    expect(splitArtists("Mansheel Gujral/Akhil Sachdeva")).toEqual(["Mansheel Gujral", "Akhil Sachdeva"]);
    expect(splitArtists("Arijit Singh, Shreya Ghoshal & Pritam")).toEqual(["Arijit Singh", "Shreya Ghoshal", "Pritam"]);
    expect(splitArtists("Diljit Dosanjh feat. Sia")).toEqual(["Diljit Dosanjh", "Sia"]);
    expect(splitArtists("Badshah x Aastha Gill")).toEqual(["Badshah", "Aastha Gill"]);
    expect(splitArtists("Lil Nas X")).toEqual(["Lil Nas X"]);
  });
  it("keeps protected and band names intact", () => {
    expect(splitArtists(["AC", "DC"])).toEqual(["AC/DC"]);
    expect(splitArtists("Echo & the Bunnymen")).toEqual(["Echo & the Bunnymen"]);
    expect(splitArtists("Simon & Garfunkel")).toEqual(["Simon & Garfunkel"]);
    expect(splitArtists("Salim-Sulaiman")).toEqual(["Salim-Sulaiman"]);
  });
  it("drops placeholder artists", () => {
    expect(splitArtists("Unknown Artist")).toEqual([]);
    expect(splitArtists("Various Artists/Arijit Singh")).toEqual(["Arijit Singh"]);
  });
});

describe("splitTitle", () => {
  it("separates film/version suffixes", () => {
    expect(splitTitle('Kesariya (From "Brahmastra")')).toEqual({
      title: "Kesariya",
      subtitle: 'From "Brahmastra"',
      film: "Brahmastra",
    });
    expect(splitTitle("Yellow - Remastered 2011")).toEqual({ title: "Yellow", subtitle: "Remastered 2011" });
    expect(splitTitle("Bhool Bhulaiyaa 2 - Title Track")).toEqual({ title: "Bhool Bhulaiyaa 2 - Title Track" });
  });
});

describe("normalizeGenres", () => {
  it("splits and prettifies", () => {
    expect(normalizeGenres(["hip hop/r&b", "modern bollywood; filmi", "(12)", "Other"])).toEqual([
      "Hip-Hop",
      "R&B",
      "Modern Bollywood",
      "Filmi",
    ]);
  });
});

describe("file-name fallback", () => {
  it("parses common patterns", () => {
    expect(parseFileName("03 - Arijit Singh - Tum Hi Ho.mp3")).toEqual({
      artists: ["Arijit Singh"],
      title: "Tum Hi Ho",
      trackNo: 3,
    });
    expect(parseFileName("Channa_Ve.mp3")).toEqual({ title: "Channa Ve", trackNo: undefined });
  });
  it("is used when tags are missing", () => {
    const d = normalizeTags({}, { duration: 200 }, "Pritam - Kesariya (PagalWorld.com).mp3");
    expect(d.title).toBe("Kesariya");
    expect(d.artists).toEqual(["Pritam"]);
    expect(d.album).toBe("Kesariya");
    expect(d.warnings.length).toBeGreaterThan(0);
  });
});

describe("lyrics", () => {
  it("parses LRC including multi-stamps and offsets", () => {
    const lines = parseLrc("[ar:Someone]\n[offset:+500]\n[00:01.00]Hello\n[00:05.50][00:10.00]Chorus\n");
    expect(lines).toEqual([
      { t: 500, text: "Hello" },
      { t: 5000, text: "Chorus" },
      { t: 9500, text: "Chorus" },
    ]);
  });
  it("detects LRC embedded in an unsynced lyrics frame", () => {
    const d = normalizeTags(
      { title: "X", artist: "Y", lyrics: [{ text: "[00:01.00]a\n[00:02.00]b\n[00:03.00]c" }] },
      { duration: 10 },
      "x.mp3",
    );
    expect(d.lyrics?.synced?.length).toBe(3);
    expect(d.lyrics?.plain).toBe("a\nb\nc");
  });
});
