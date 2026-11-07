/**
 * Turns raw audio tags (ID3 / Vorbis / MP4 / APE …) into clean, display-ready metadata.
 *
 * The rules are tuned for real-world libraries, including the files produced by
 * spotDL / YouTube Music downloaders (e.g. `Channa Ve - From "Bhoot - Part One: The Haunted Ship"`,
 * artists separated by "/", label stored in TENC) and the watermark-heavy tags from
 * Indian download sites ("Song (PagalWorld.com)", "Title | Movie | Singer").
 *
 * Isomorphic: no Node or DOM APIs, so the admin's browser and the server share it.
 */
import type { IAudioMetadata } from "music-metadata";
import type { Lyrics } from "../types";
import { normalizeLanguage } from "./language";
import { looksLikeLrc, parseLrc, syncedToPlain } from "./lrc";

export interface RawTags {
  title?: string;
  artist?: string;
  artists?: string[];
  albumartist?: string;
  album?: string;
  year?: number;
  date?: string;
  originaldate?: string;
  genre?: string[];
  track?: { no: number | null; of: number | null };
  disk?: { no: number | null; of: number | null };
  composer?: string[];
  lyricist?: string[];
  producer?: string[];
  label?: string[];
  copyright?: string;
  encodedby?: string;
  isrc?: string[];
  bpm?: number;
  language?: string;
  comment?: string[];
  lyrics?: { text?: string; synced?: { text: string; timestamp?: number }[] }[];
  urls?: string[];
  explicit?: boolean;
  subtitle?: string[];
}

export interface RawFormat {
  duration?: number; // seconds
  bitrate?: number;
  sampleRate?: number;
  numberOfChannels?: number;
  codec?: string;
  container?: string;
  lossless?: boolean;
}

export interface RawPicture {
  format: string;
  data: Uint8Array;
  type?: string;
}

export interface TrackDraft {
  title: string;
  subtitle?: string;
  rawTitle: string;
  artists: string[];
  albumArtist?: string;
  album: string;
  film?: string;
  genres: string[];
  year?: number;
  releaseDate?: string;
  trackNo?: number;
  trackTotal?: number;
  discNo?: number;
  discTotal?: number;
  durationMs: number;
  composers: string[];
  lyricists: string[];
  producers: string[];
  label?: string;
  copyright?: string;
  isrc?: string;
  language?: string;
  explicit?: boolean;
  comment?: string;
  sourceUrl?: string;
  bpmTag?: number;
  lyrics?: Lyrics;
  format: {
    bitrate?: number;
    sampleRate?: number;
    channels?: number;
    codec?: string;
    container?: string;
    lossless?: boolean;
  };
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Adapter for music-metadata                                          */
/* ------------------------------------------------------------------ */

function asText(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "text" in (v as Record<string, unknown>)) {
    const t = (v as { text?: unknown }).text;
    return typeof t === "string" ? t : undefined;
  }
  return undefined;
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;

export function fromMusicMetadata(meta: IAudioMetadata): {
  tags: RawTags;
  format: RawFormat;
  picture?: RawPicture;
} {
  const c = meta.common;
  const urls: string[] = [];
  const comments: string[] = [];
  let explicit: boolean | undefined;
  const extraLyrics: RawTags["lyrics"] = [];

  for (const c0 of (c.comment ?? []) as unknown[]) {
    const t = asText(c0);
    if (t) comments.push(t);
  }

  for (const [, tags] of Object.entries(meta.native ?? {})) {
    for (const tag of tags) {
      const id = String(tag.id);
      const lower = id.toLowerCase();
      const value = asText(tag.value);
      if (/^(woas|wors|woar|wcom|wpub|wxxx|purl|url)/i.test(id) || /^txxx:(url|purl|source|website|comment|description)/i.test(id)) {
        if (value) {
          const found = value.match(URL_RE);
          if (found) urls.push(...found);
          else if (/^txxx:(comment|description)/i.test(id)) comments.push(value);
        }
        if (tag.value && typeof tag.value === "object" && "url" in (tag.value as object)) {
          const u = (tag.value as { url?: string }).url;
          if (u) urls.push(u);
        }
      }
      if (lower === "rtng" || lower.endsWith("itunesadvisory") || lower === "explicit" || lower === "txxx:explicit") {
        const n = Number(value);
        if (n === 1 || n === 4 || value?.toLowerCase() === "true" || value?.toLowerCase() === "explicit") explicit = true;
        else if (!Number.isNaN(n)) explicit = explicit ?? false;
      }
      if ((lower === "lyrics" || lower === "unsyncedlyrics" || lower === "txxx:lyrics") && value && !c.lyrics?.length) {
        extraLyrics.push({ text: value });
      }
    }
  }

  const lyrics: RawTags["lyrics"] = [];
  for (const l of (c.lyrics ?? []) as unknown[]) {
    if (typeof l === "string") lyrics.push({ text: l });
    else if (l && typeof l === "object") {
      const o = l as { text?: string; syncText?: { text: string; timestamp?: number }[] };
      lyrics.push({ text: o.text, synced: o.syncText?.length ? o.syncText : undefined });
    }
  }
  lyrics.push(...extraLyrics);

  const pics = c.picture ?? [];
  const front =
    pics.find((p) => /front/i.test(p.type ?? "")) ?? pics.find((p) => /cover/i.test(p.type ?? "")) ?? pics[0];

  return {
    tags: {
      title: c.title,
      artist: c.artist,
      artists: c.artists,
      albumartist: c.albumartist,
      album: c.album,
      year: c.year,
      date: c.date,
      originaldate: c.originaldate,
      genre: c.genre,
      track: c.track,
      disk: c.disk,
      composer: c.composer,
      lyricist: c.lyricist,
      producer: c.producer,
      label: c.label,
      copyright: c.copyright,
      encodedby: c.encodedby,
      isrc: c.isrc,
      bpm: typeof c.bpm === "number" ? c.bpm : undefined,
      language: c.language,
      comment: comments,
      lyrics,
      urls,
      explicit,
      subtitle: c.subtitle,
    },
    format: {
      duration: meta.format.duration,
      bitrate: meta.format.bitrate,
      sampleRate: meta.format.sampleRate,
      numberOfChannels: meta.format.numberOfChannels,
      codec: meta.format.codec,
      container: meta.format.container,
      lossless: meta.format.lossless,
    },
    picture: front ? { format: front.format, data: front.data, type: front.type } : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Cleaning helpers                                                    */
/* ------------------------------------------------------------------ */

const DOMAIN_RE =
  /\b(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|in|pk|io|co|me|cc|xyz|live|fm|to|mobi|site|online|club|biz|us|uk|tk|ws|asia|world|link|top|pw|vip|fun)\b/i;
const JUNK_WORDS =
  /\b(?:pagal\s?world|pagalworld|djmaza|dj\s?maza|mr-?jatt|djpunjab|songs\.?pk|songspk|webmusic|downloadming|wapking|mp3mad|bestwap|raagsong|djjohal|musicmaza|mymp3song|pendujatt|riskyjatt|naa\s?songs|starmusiq|masstamilan|isaimini)\b/i;
const VIDEO_NOISE =
  /[([]\s*(?:official\s+(?:music\s+)?(?:video|audio|lyric(?:al)?\s+video)|lyric(?:al)?(?:\s+video)?|full\s+(?:video|song|audio)(?:\s+song)?|audio(?:\s+song)?|video(?:\s+song)?|hd|hq|4k|\d{3}\s?kbps|visualizer|audio\s+jukebox|jukebox)\s*[)\]]/gi;

const ENTITY: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">" };

export function cleanText(input: string | undefined | null): string {
  if (!input) return "";
  let s = String(input)
    .replace(/\u0000/g, "")
    .replace(/&(?:amp|quot|#39|apos|lt|gt);/g, (m) => ENTITY[m] ?? m)
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Remove bracketed watermarks: "(PagalWorld.com)", "[www.Songs.PK]", "{DJMaza.Info}"
  s = s.replace(/\s*[([{][^()[\]{}]*[)\]}]/g, (seg) => (DOMAIN_RE.test(seg) || JUNK_WORDS.test(seg) ? "" : seg));
  // Remove dash/pipe separated watermark tails: "Song - DJMaza.Info", "Song | www.site.com"
  s = s
    .split(/\s+[-–—|:]\s+/)
    .filter((part, i) => i === 0 || !(DOMAIN_RE.test(part) || JUNK_WORDS.test(part)))
    .join(" - ");
  // Bare domains / site names anywhere
  s = s.replace(new RegExp(`\\s*${DOMAIN_RE.source}`, "gi"), "").replace(new RegExp(JUNK_WORDS.source, "gi"), "");
  s = s.replace(VIDEO_NOISE, "");
  s = s.replace(/\s{2,}/g, " ").replace(/^[\s\-–—|:,]+|[\s\-–—|:,]+$/g, "").trim();
  if (/^["“].*["”]$/.test(s)) s = s.slice(1, -1).trim();
  return s;
}

/** Names that contain separator characters but are a single artist. */
const PROTECTED_ARTISTS = [
  "AC/DC",
  "Tyler, The Creator",
  "Earth, Wind & Fire",
  "Crosby, Stills, Nash & Young",
  "Crosby, Stills & Nash",
  "Simon & Garfunkel",
  "Hall & Oates",
  "Mumford & Sons",
  "Florence + The Machine",
  "Marina and the Diamonds",
  "Salt-N-Pepa",
  "Vishal & Shekhar",
  "Shankar-Ehsaan-Loy",
  "Shankar Ehsaan Loy",
  "Salim-Sulaiman",
  "Sachin-Jigar",
  "Ajay-Atul",
  "Jatin-Lalit",
  "Nadeem-Shravan",
  "Laxmikant-Pyarelal",
  "Kalyanji-Anandji",
  "Shiv-Hari",
  "Anu Malik & Daughters",
  "Simon & Diamond",
  "Sajid-Wajid",
  "Meet Bros",
  "Tanishk Bagchi & Vayu",
  "Hans Zimmer & Lisa Gerrard",
  "Lisa Mishra & Others",
];
const PROTECTED_FOLDED = new Map(PROTECTED_ARTISTS.map((n) => [n.toLowerCase(), n]));

const FEAT_SPLIT = /\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+/i;
// Lower-case " x " only: upper-case X is usually part of a name (Lil Nas X, Malcolm X).
const X_SPLIT = /\s+(?:x|×)\s+/;
// "&" joins two artists unless it is a band name like "Echo & the Bunnymen".
const AMP_SPLIT = /\s+&\s+(?!(?:the|his|her|friends|co\.?)\b)/i;

export function splitArtists(input: string | string[] | undefined): string[] {
  const parts: string[] = [];
  let seed = Array.isArray(input) ? input : input ? [input] : [];
  // music-metadata splits ID3v2.3 TPE1 on "/", which breaks names like "AC/DC".
  if (seed.length > 1) {
    const joined = PROTECTED_FOLDED.get(seed.join("/").toLowerCase());
    if (joined) seed = [joined];
  }
  for (const raw of seed) {
    const cleaned = cleanText(raw);
    if (!cleaned) continue;
    const protectedName = PROTECTED_FOLDED.get(cleaned.toLowerCase());
    if (protectedName) {
      parts.push(protectedName);
      continue;
    }
    // Explicit multi-value separators first.
    let chunks = cleaned.split(/\s*(?:\/|;|\u0000|\|)\s*/);
    if (chunks.length === 1 && cleaned.includes("/") && cleaned.length <= 6) chunks = [cleaned];
    for (const chunk of chunks) {
      const p = PROTECTED_FOLDED.get(chunk.toLowerCase());
      if (p) {
        parts.push(p);
        continue;
      }
      for (const piece of chunk.split(/\s*,\s*/)) {
        for (const sub of piece.split(FEAT_SPLIT).flatMap((s) => s.split(X_SPLIT))) {
          const p2 = PROTECTED_FOLDED.get(sub.toLowerCase());
          if (p2) {
            parts.push(p2);
            continue;
          }
          for (const name of sub.split(AMP_SPLIT)) {
            const n = name.replace(/^[(\[]+|[)\]]+$/g, "").trim();
            if (n) parts.push(n);
          }
        }
      }
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (seen.has(k) || /^(unknown|unknown artist|n\/a|none|null|undefined|-)$/i.test(p)) continue;
    seen.add(k);
    out.push(p);
  }
  const various = out.filter((n) => /^various( artists)?$/i.test(n));
  return various.length && out.length > various.length ? out.filter((n) => !various.includes(n)) : out;
}

const SMALL_WORDS = new Set(["and", "or", "of", "the", "a", "an", "in", "on", "n", "de", "la", "le", "el"]);
const GENRE_ACRONYMS: Record<string, string> = {
  "r&b": "R&B",
  rnb: "R&B",
  edm: "EDM",
  idm: "IDM",
  uk: "UK",
  us: "US",
  lofi: "Lo-Fi",
  "lo-fi": "Lo-Fi",
  "hip hop": "Hip-Hop",
  "hip-hop": "Hip-Hop",
  hiphop: "Hip-Hop",
  kpop: "K-Pop",
  "k-pop": "K-Pop",
  jpop: "J-Pop",
  "j-pop": "J-Pop",
  dnb: "Drum & Bass",
};

export function normalizeGenres(genres: string[] | undefined): string[] {
  const out: string[] = [];
  for (const g of genres ?? []) {
    for (const piece of cleanText(g).split(/\s*(?:\/|;|,|\|)\s*/)) {
      const p = piece.replace(/^\(\d+\)/, "").trim();
      if (!p || /^\d+$/.test(p) || /^(other|unknown|genre|none|misc)$/i.test(p)) continue;
      const lower = p.toLowerCase();
      const pretty =
        GENRE_ACRONYMS[lower] ??
        lower
          .split(" ")
          .map((w, i) => GENRE_ACRONYMS[w] ?? (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
          .join(" ");
      if (!out.some((x) => x.toLowerCase() === pretty.toLowerCase())) out.push(pretty);
    }
  }
  return out.slice(0, 6);
}

const VERSION_WORDS =
  /\b(remaster(?:ed)?|live|acoustic|version|edit|mix|remix|lo-?fi|slowed|reverb|unplugged|reprise|instrumental|recreated|reloaded|duet|sad|extended|radio|mono|stereo|demo|bonus|deluxe|karaoke|cover|mashup|sped up|nightcore|rendition|female|male|from)\b/i;

/**
 * Split a title into its display title and an optional subtitle
 * ("Channa Ve - From \"Bhoot\"" -> "Channa Ve" + "From \"Bhoot\"").
 */
export function splitTitle(title: string): { title: string; subtitle?: string; film?: string } {
  let base = title;
  let subtitle: string | undefined;
  let film: string | undefined;

  const fromDash = base.match(/^(.+?)\s+[-–—]\s+(From\s+(?:the\s+)?(?:[A-Za-z ]+\s+)?["“'‘](.+?)["”'’].*)$/i);
  const fromParen = base.match(/^(.+?)\s*[([](From\s+(?:the\s+)?(?:[A-Za-z ]+\s+)?["“'‘](.+?)["”'’][^)\]]*)[)\]]\s*$/i);
  if (fromDash) {
    base = fromDash[1];
    subtitle = fromDash[2].trim();
    film = fromDash[3].trim();
  } else if (fromParen) {
    base = fromParen[1];
    subtitle = fromParen[2].trim();
    film = fromParen[3].trim();
  } else {
    const dash = base.match(/^(.+?)\s+[-–—]\s+([^-–—]+)$/);
    if (dash && VERSION_WORDS.test(dash[2]) && dash[1].length >= 2) {
      base = dash[1];
      subtitle = dash[2].trim();
    }
  }
  base = base.trim();
  if (!base) return { title: title.trim() };
  return { title: base, subtitle, film };
}

// Words that mark a version of a song rather than a different song.
const VERSION_TOKENS = new Set([
  "remaster", "remastered", "live", "acoustic", "version", "edit", "remix", "lofi", "slowed", "reverb", "unplugged",
  "reprise", "instrumental", "recreated", "reloaded", "duet", "sad", "extended", "karaoke", "cover", "mashup",
  "female", "male", "title", "track",
]);

/**
 * One key for every version of a song, so autoplay never plays two of them back to back:
 * "Tum Hi Ho", "Tum Hi Ho (Reprise)" and "Tum Hi Ho - Female Version" share "tum hi ho";
 * "Tum Hi Ho Bandhu" does not.
 */
export function songKey(title: string): string {
  const base = splitTitle(title).title.replace(/\s*[([][^)\]]*[)\]]\s*/g, " ");
  const words = foldKey(base).split(" ").filter((w) => w && !VERSION_TOKENS.has(w));
  return words.join(" ") || foldKey(title);
}

function foldKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`"“”]/g, "")
    .replace(/lo-fi/g, "lofi")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function filmFromAlbum(album: string): string | undefined {
  const m =
    album.match(/From\s+(?:the\s+)?(?:[A-Za-z ]+\s+)?["“'‘](.+?)["”'’]/i) ??
    album.match(/^(.+?)\s*[([](?:Original\s+)?(?:Motion\s+Picture\s+)?(?:Soundtrack|OST)[)\]]/i);
  return m ? m[1].trim() : undefined;
}

const SOFTWARE_RE =
  /^(?:lame|lavf|lavc|ffmpeg|itunes|exact audio copy|eac|foobar2000|mediamonkey|audacity|fre:ac|xld|dbpoweramp|mp3tag|winamp|nero|spotdl|yt-dlp|youtube-dl|tagscanner|picard|kid3|vlc|audiograbber|cdex|max|switch|android|ios)\b/i;

function labelFromCopyright(copyright: string): string | undefined {
  const s = copyright
    .replace(/[©℗]|\((?:c|p)\)/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b(?:all rights reserved|under exclusive licen[cs]e to)\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.-]+|[\s,.-]+$/g, "")
    .trim();
  return s && s.length <= 80 ? s : undefined;
}

function parseDate(date?: string, year?: number): { year?: number; releaseDate?: string } {
  if (date) {
    const m = date.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (m) {
      const y = Number(m[1]);
      const releaseDate = m[2] && m[3] ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
      if (y > 1800 && y < 2200) return { year: y, releaseDate };
    }
  }
  if (year && year > 1800 && year < 2200) return { year };
  return {};
}

const SOURCE_PRIORITY = [/music\.youtube\.com/i, /open\.spotify\.com/i, /youtube\.com|youtu\.be/i, /jiosaavn|saavn/i, /gaana/i, /music\.apple/i, /soundcloud/i, /bandcamp/i];

function pickSourceUrl(urls: string[]): string | undefined {
  const clean = urls.map((u) => u.replace(/[),.;]+$/, "")).filter((u) => /^https?:\/\//i.test(u) && !DOMAIN_JUNK_URL.test(u));
  for (const re of SOURCE_PRIORITY) {
    const hit = clean.find((u) => re.test(u));
    if (hit) return hit;
  }
  return clean[0];
}
const DOMAIN_JUNK_URL = /pagalworld|djmaza|mr-?jatt|songspk|wapking|mp3mad|bestwap|pendujatt|riskyjatt/i;

/* ------------------------------------------------------------------ */
/* File-name fallback                                                  */
/* ------------------------------------------------------------------ */

export function parseFileName(fileName: string): { title?: string; artists?: string[]; trackNo?: number } {
  let base = fileName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{2,5}$/i, "");
  base = base.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  let trackNo: number | undefined;
  const num = base.match(/^(\d{1,3})\s*(?:[-.)_]\s*|\s+)(.+)$/);
  if (num && Number(num[1]) < 200) {
    trackNo = Number(num[1]);
    base = num[2];
  }
  base = cleanText(base);
  const parts = base.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return { artists: splitArtists(parts[0]), title: parts.slice(1).join(" - "), trackNo };
  }
  return { title: base || undefined, trackNo };
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

export function normalizeTags(tags: RawTags, format: RawFormat, fileName: string): TrackDraft {
  const warnings: string[] = [];
  const fromName = parseFileName(fileName);

  // Title
  let rawTitle = (tags.title ?? "").trim();
  let titleSource = cleanText(rawTitle);
  if (titleSource.includes(" | ")) titleSource = titleSource.split(" | ")[0].trim();
  if (!titleSource) {
    titleSource = fromName.title ?? "Untitled";
    rawTitle = rawTitle || titleSource;
    warnings.push("No title tag — title taken from the file name.");
  }
  const split = splitTitle(titleSource);

  // Artists (+ featured artists mentioned in the title)
  let artists = splitArtists(tags.artists && tags.artists.length > 1 ? tags.artists : tags.artist ?? tags.artists);
  const feat = titleSource.match(/[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]/i);
  if (feat) {
    for (const name of splitArtists(feat[1])) if (!artists.some((a) => a.toLowerCase() === name.toLowerCase())) artists.push(name);
  }
  if (!artists.length && fromName.artists?.length) {
    artists = fromName.artists;
    warnings.push("No artist tag — artist taken from the file name.");
  }
  const albumArtist = splitArtists(tags.albumartist)[0];
  if (!artists.length && albumArtist) artists = [albumArtist];
  if (!artists.length) {
    artists = ["Unknown Artist"];
    warnings.push("No artist found — please fill it in.");
  }

  // Album / film
  const album = cleanText(tags.album) || split.film || split.title;
  if (!cleanText(tags.album)) warnings.push("No album tag — using a single-track album.");
  const film = split.film ?? filmFromAlbum(album);

  // Dates
  const { year, releaseDate } = parseDate(tags.date || tags.originaldate, tags.year);

  // Label / copyright
  const copyright = cleanText(tags.copyright) || undefined;
  const labelTag = (tags.label ?? []).map(cleanText).find(Boolean);
  const encodedBy = cleanText(tags.encodedby);
  const label =
    labelTag ||
    (encodedBy && !SOFTWARE_RE.test(encodedBy) && !/\d+\.\d+/.test(encodedBy) ? encodedBy : undefined) ||
    (copyright ? labelFromCopyright(copyright) : undefined);

  // Comments & source link
  const urls = [...(tags.urls ?? [])];
  const commentTexts: string[] = [];
  for (const c of tags.comment ?? []) {
    const found = c.match(URL_RE);
    if (found) urls.push(...found);
    const rest = cleanText(c.replace(URL_RE, ""));
    if (rest && rest.length > 2 && !/^(?:0+|[0-9a-f]{8}(?: [0-9a-f]{8})+)$/i.test(rest)) commentTexts.push(rest);
  }
  const sourceUrl = pickSourceUrl(urls);

  // Lyrics
  let lyrics: Lyrics | undefined;
  for (const l of tags.lyrics ?? []) {
    if (l.synced?.length && l.synced.some((s) => typeof s.timestamp === "number")) {
      const synced = l.synced
        .filter((s) => typeof s.timestamp === "number")
        .map((s) => ({ t: Math.round(s.timestamp ?? 0), text: (s.text ?? "").trim() }))
        .sort((a, b) => a.t - b.t);
      lyrics = { synced, plain: syncedToPlain(synced), source: "tag" };
      break;
    }
    const text = (l.text ?? "").replace(/\r\n/g, "\n").trim();
    if (!text) continue;
    if (looksLikeLrc(text)) {
      const synced = parseLrc(text);
      lyrics = { synced, plain: syncedToPlain(synced), source: "tag" };
    } else {
      lyrics = { plain: text, source: "tag" };
    }
    break;
  }

  // Explicit marker in the title
  let explicit = tags.explicit;
  if (/[([]\s*explicit\s*[)\]]/i.test(titleSource)) explicit = true;

  const track = tags.track ?? { no: null, of: null };
  const disk = tags.disk ?? { no: null, of: null };
  const durationMs = Math.max(0, Math.round((format.duration ?? 0) * 1000));
  if (!durationMs) warnings.push("Could not read the duration from the file header.");

  return {
    title: split.title.replace(/\s*[([]\s*explicit\s*[)\]]/i, "").trim(),
    subtitle: split.subtitle ?? (tags.subtitle ?? []).map(cleanText).find(Boolean),
    rawTitle,
    artists,
    albumArtist: albumArtist && !/^various( artists)?$/i.test(albumArtist) ? albumArtist : albumArtist || undefined,
    album,
    film,
    genres: normalizeGenres(tags.genre),
    year,
    releaseDate,
    trackNo: track.no ?? fromName.trackNo ?? undefined,
    trackTotal: track.of ?? undefined,
    discNo: disk.no ?? undefined,
    discTotal: disk.of ?? undefined,
    durationMs,
    composers: splitArtists(tags.composer),
    lyricists: splitArtists(tags.lyricist),
    producers: splitArtists(tags.producer),
    label,
    copyright,
    isrc: tags.isrc?.find(Boolean)?.toUpperCase(),
    language: normalizeLanguage(tags.language),
    explicit,
    comment: commentTexts[0],
    sourceUrl,
    bpmTag: tags.bpm && tags.bpm > 30 && tags.bpm < 300 ? Math.round(tags.bpm) : undefined,
    lyrics,
    format: {
      bitrate: format.bitrate ? Math.round(format.bitrate) : undefined,
      sampleRate: format.sampleRate,
      channels: format.numberOfChannels,
      codec: format.codec,
      container: format.container,
      lossless: format.lossless,
    },
    warnings,
  };
}

export const AUDIO_EXTENSIONS = ["mp3", "m4a", "mp4", "aac", "flac", "ogg", "oga", "opus", "wav", "aif", "aiff", "wma", "webm"];

export function audioMimeFor(fileName: string, fallback?: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/ogg",
    wav: "audio/wav",
    aif: "audio/aiff",
    aiff: "audio/aiff",
    wma: "audio/x-ms-wma",
    webm: "audio/webm",
  };
  return map[ext] ?? (fallback?.startsWith("audio/") ? fallback : "application/octet-stream");
}
