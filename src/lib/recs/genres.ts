/**
 * Genre matching.
 *
 * Genre labels come from file tags, Apple's catalog and listeners, so the same music shows up as
 * "Bollywood", "Filmi", "Hindi Film Music" or "Modern Bollywood". Each label is mapped to a
 * canonical genre, and canonical genres belong to families with known neighbours, so that
 * "Bollywood" is close to "Indian Pop" and "Punjabi" but far from "Metal" — the way streaming
 * services treat genres as a map rather than as exact strings.
 */
import { fold } from "../util";

export interface CanonicalGenre {
  id: string;
  family: string;
  /** Language the genre implies (e.g. Tamil film music), used when nothing better is known. */
  lang?: string;
  aliases: string[];
}

const G = (id: string, family: string, aliases: string[], lang?: string): CanonicalGenre => ({ id, family, aliases, lang });

export const GENRES: CanonicalGenre[] = [
  // Indian film and regional music (Apple files regional film music under the language name).
  G("bollywood", "indian-film", ["bollywood", "filmi", "hindi film", "hindi film music", "hindi films", "hindi soundtrack", "hindi", "indian film", "bollywood music", "hindustani film"], "hi"),
  G("tamil", "indian-film", ["tamil", "kollywood", "tamil film"], "ta"),
  G("telugu", "indian-film", ["telugu", "tollywood", "telugu film"], "te"),
  G("malayalam", "indian-film", ["malayalam", "mollywood"], "ml"),
  G("kannada", "indian-film", ["kannada", "sandalwood"], "kn"),
  G("marathi", "indian-film", ["marathi"], "mr"),
  G("bengali", "indian-film", ["bengali", "bangla"], "bn"),
  G("gujarati", "indian-film", ["gujarati", "garba"], "gu"),
  G("bhojpuri", "indian-film", ["bhojpuri"], "bho"),
  G("regional-indian", "indian-film", ["regional indian", "regional"]),
  G("punjabi", "punjabi", ["punjabi", "punjabi pop", "bhangra", "punjabi music", "punjabi folk"], "pa"),
  G("indian-pop", "indian-pop", ["indian pop", "indipop", "indi pop", "hindi pop", "desi pop", "indian indie", "hindi indie", "indie india"]),
  G("desi-hiphop", "desi-hiphop", ["desi hip hop", "indian hip hop", "hindi rap", "hindi hip hop", "desi rap", "gully rap", "punjabi rap", "punjabi hip hop"]),
  G("sufi", "sufi", ["sufi", "qawwali", "qawali", "sufi rock", "sufi music"]),
  G("ghazal", "sufi", ["ghazal", "ghazals", "nazm"]),
  G("indian-classical", "indian-classical", ["indian classical", "hindustani", "hindustani classical", "carnatic", "carnatic classical", "raga"]),
  G("devotional", "devotional", ["devotional", "devotional spiritual", "devotional and spiritual", "bhajan", "bhajans", "kirtan", "aarti", "gurbani", "shabad", "spiritual", "religious", "mantra", "mantras", "bhakti", "christian", "gospel"]),
  // Global
  G("k-pop", "k-pop", ["k pop", "kpop", "korean pop"], "ko"),
  G("pop", "pop", ["pop", "dance pop", "synth pop", "synthpop", "electropop", "teen pop", "adult contemporary", "top 40", "j pop", "jpop"]),
  G("hip-hop", "hip-hop", ["hip hop", "hip hop rap", "rap", "trap", "drill", "grime", "gangsta rap", "boom bap", "hiphop"]),
  G("rnb", "rnb", ["r b", "rnb", "r b soul", "soul", "funk", "neo soul", "contemporary r b", "rhythm and blues", "soul and funk", "soul funk"]),
  G("rock", "rock", ["rock", "hard rock", "classic rock", "alternative rock", "punk", "pop rock", "soft rock", "grunge", "indian rock", "metal", "heavy metal"]),
  G("indie", "indie", ["indie", "alternative", "indie pop", "indie rock", "alt", "singer songwriter"]),
  G("electronic", "electronic", ["electronic", "electronica", "edm", "dance", "house", "deep house", "techno", "trance", "dubstep", "drum bass", "drum and bass", "dnb", "electro", "future bass", "progressive house", "dance electronic"]),
  G("chill", "chill", ["lo fi", "lofi", "chill", "chillout", "chill out", "chillhop", "ambient", "downtempo", "lounge"]),
  G("jazz", "jazz", ["jazz", "smooth jazz", "bebop", "swing"]),
  G("blues", "blues", ["blues"]),
  G("classical", "classical", ["classical", "orchestral", "opera", "baroque", "piano"]),
  G("soundtrack", "soundtrack", ["soundtrack", "film score", "score", "ost", "original soundtrack", "films games", "musicals"]),
  G("country", "country", ["country", "americana", "bluegrass"]),
  G("folk", "folk", ["folk", "acoustic"]),
  G("latin", "latin", ["latin", "reggaeton", "latin pop", "salsa", "bachata", "cumbia", "latino", "urbano latino"], "es"),
  G("reggae", "reggae", ["reggae", "dancehall", "ska"]),
  G("african", "african", ["afrobeats", "afrobeat", "african music", "african", "amapiano", "afro pop"]),
  G("kids", "kids", ["kids", "childrens music", "children"]),
];

/** How close two different families are (symmetric). Same family = 0.75, same genre = 1. */
const FAMILY_LINKS: [string, string, number][] = [
  ["indian-film", "indian-pop", 0.6],
  ["indian-film", "punjabi", 0.45],
  ["indian-film", "sufi", 0.5],
  ["indian-film", "soundtrack", 0.45],
  ["indian-film", "desi-hiphop", 0.3],
  ["indian-film", "indian-classical", 0.3],
  ["indian-film", "devotional", 0.25],
  ["indian-pop", "punjabi", 0.55],
  ["indian-pop", "pop", 0.4],
  ["indian-pop", "indie", 0.4],
  ["indian-pop", "desi-hiphop", 0.35],
  ["indian-pop", "sufi", 0.35],
  ["punjabi", "desi-hiphop", 0.6],
  ["punjabi", "hip-hop", 0.35],
  ["desi-hiphop", "hip-hop", 0.7],
  ["sufi", "devotional", 0.45],
  ["sufi", "indian-classical", 0.45],
  ["devotional", "indian-classical", 0.45],
  ["pop", "rnb", 0.5],
  ["pop", "electronic", 0.5],
  ["pop", "indie", 0.45],
  ["pop", "k-pop", 0.5],
  ["pop", "latin", 0.35],
  ["pop", "rock", 0.3],
  ["pop", "country", 0.25],
  ["hip-hop", "rnb", 0.6],
  ["rock", "indie", 0.6],
  ["electronic", "chill", 0.45],
  ["indie", "chill", 0.35],
  ["indie", "folk", 0.45],
  ["jazz", "blues", 0.55],
  ["jazz", "chill", 0.3],
  ["jazz", "rnb", 0.35],
  ["classical", "soundtrack", 0.55],
  ["classical", "chill", 0.25],
  ["country", "folk", 0.5],
  ["reggae", "latin", 0.3],
  ["african", "reggae", 0.35],
  ["african", "hip-hop", 0.3],
];

const linkMap = new Map<string, number>();
for (const [a, b, v] of FAMILY_LINKS) {
  linkMap.set(`${a}|${b}`, v);
  linkMap.set(`${b}|${a}`, v);
}

const byId = new Map(GENRES.map((g) => [g.id, g]));

// Longest aliases first, so "punjabi pop" wins over "pop" and "hip hop rap" over "rap".
const ALIASES = GENRES.flatMap((g) => g.aliases.map((alias) => ({ alias, g })))
  .sort((a, b) => b.alias.length - a.alias.length)
  // Aliases are already folded (lowercase letters, digits and spaces), so they are regex-safe.
  .map(({ alias, g }) => ({ g, re: new RegExp(`(^| )${alias}( |$)`) }));

export type GenreWeights = Map<string, number>;

/**
 * Canonical genres for a list of labels, with weights: an exact alias counts 1, a label that
 * only contains an alias ("Modern Bollywood", "Punjabi Sad Songs") counts 0.8.
 */
export function canonicalGenres(labels: string[]): GenreWeights {
  const out: GenreWeights = new Map();
  for (const label of labels) {
    const key = fold(label);
    if (!key) continue;
    const exact = ALIASES.find((a) => a.g.aliases.includes(key));
    if (exact) {
      out.set(exact.g.id, 1);
      continue;
    }
    for (const a of ALIASES) {
      if (a.re.test(key)) {
        out.set(a.g.id, Math.max(out.get(a.g.id) ?? 0, 0.8));
        break;
      }
    }
  }
  return out;
}

export function genreInfo(id: string): CanonicalGenre | undefined {
  return byId.get(id);
}

/** Similarity of two canonical genres in [0,1]. */
export function genrePairSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const fa = byId.get(a)?.family;
  const fb = byId.get(b)?.family;
  if (!fa || !fb) return 0;
  if (fa === fb) return 0.75;
  return linkMap.get(`${fa}|${fb}`) ?? 0;
}

/** Best match between two weighted genre sets, in [0,1]; null when either side is unknown. */
export function genreSimilarity(a: GenreWeights, b: GenreWeights): number | null {
  if (!a.size || !b.size) return null;
  let best = 0;
  for (const [ga, wa] of a) {
    for (const [gb, wb] of b) {
      const v = Math.sqrt(wa * wb) * genrePairSimilarity(ga, gb);
      if (v > best) best = v;
    }
  }
  return best;
}

/** The language a set of genres implies ("Tamil" → ta), if they agree on one. */
export function languageFromGenres(genres: GenreWeights): string | undefined {
  const langs = new Set<string>();
  for (const id of genres.keys()) {
    const l = byId.get(id)?.lang;
    if (l) langs.add(l);
  }
  return langs.size === 1 ? [...langs][0] : undefined;
}

export function familiesOf(genres: GenreWeights): Set<string> {
  const out = new Set<string>();
  for (const id of genres.keys()) {
    const f = byId.get(id)?.family;
    if (f) out.add(f);
  }
  return out;
}
