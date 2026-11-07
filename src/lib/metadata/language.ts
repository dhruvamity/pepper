/**
 * Song language: from the lyrics' script (Devanagari, Gurmukhi, Tamil, …), from romanized
 * lyrics by their most common words (Hindi, Punjabi or English), or from a language tag.
 * Language matters more than genre for Indian music: a Hindi love song should not be
 * followed by a Tamil dance number just because both are "film music".
 */
import { fold } from "../util";

const CODES: Record<string, string> = {
  hin: "hi", hi: "hi", hindi: "hi",
  urd: "ur", ur: "ur", urdu: "ur",
  pan: "pa", pun: "pa", pa: "pa", punjabi: "pa", panjabi: "pa",
  eng: "en", en: "en", english: "en",
  tam: "ta", ta: "ta", tamil: "ta",
  tel: "te", te: "te", telugu: "te",
  mal: "ml", ml: "ml", malayalam: "ml",
  kan: "kn", kn: "kn", kannada: "kn",
  mar: "mr", mr: "mr", marathi: "mr",
  ben: "bn", bn: "bn", bengali: "bn", bangla: "bn",
  guj: "gu", gu: "gu", gujarati: "gu",
  bho: "bho", bhojpuri: "bho",
  ori: "or", ory: "or", or: "or", odia: "or", oriya: "or",
  san: "sa", sa: "sa", sanskrit: "sa",
  spa: "es", es: "es", spanish: "es",
  kor: "ko", ko: "ko", korean: "ko",
  jpn: "ja", ja: "ja", japanese: "ja",
  zho: "zh", chi: "zh", zh: "zh", chinese: "zh",
  fra: "fr", fre: "fr", fr: "fr", french: "fr",
  deu: "de", ger: "de", de: "de", german: "de",
  por: "pt", pt: "pt", portuguese: "pt",
  ara: "ar", ar: "ar", arabic: "ar",
  rus: "ru", ru: "ru", russian: "ru",
};

const NAMES: Record<string, string> = {
  hi: "Hindi", ur: "Urdu", pa: "Punjabi", en: "English", ta: "Tamil", te: "Telugu", ml: "Malayalam",
  kn: "Kannada", mr: "Marathi", bn: "Bengali", gu: "Gujarati", bho: "Bhojpuri", or: "Odia", sa: "Sanskrit",
  es: "Spanish", ko: "Korean", ja: "Japanese", zh: "Chinese", fr: "French", de: "German", pt: "Portuguese",
  ar: "Arabic", ru: "Russian",
};

/** "hin", "Hindi", "HI" → "hi". Unknown or "no language" codes → undefined. */
export function normalizeLanguage(v: string | undefined | null): string | undefined {
  if (!v) return undefined;
  return CODES[v.trim().toLowerCase()];
}

export function languageName(code: string | undefined): string | undefined {
  return code ? (NAMES[code] ?? code.toUpperCase()) : undefined;
}

/** How interchangeable two languages are in a listening session, in [0,1]; null if unknown. */
export function languageSimilarity(a: string | undefined, b: string | undefined): number | null {
  if (!a || !b) return null;
  if (a === b) return 1;
  const pair = [a, b].sort().join("|");
  // Hindi and Urdu are one spoken language in film music; Bollywood borrows Punjabi freely.
  return ({ "hi|ur": 0.9, "hi|pa": 0.4, "pa|ur": 0.35, "bho|hi": 0.5 } as Record<string, number>)[pair] ?? 0;
}

const SCRIPTS: [RegExp, string][] = [
  [/[ऀ-ॿ]/g, "hi"],
  [/[਀-੿]/g, "pa"],
  [/[઀-૿]/g, "gu"],
  [/[ঀ-৿]/g, "bn"],
  [/[଀-୿]/g, "or"],
  [/[஀-௿]/g, "ta"],
  [/[ఀ-౿]/g, "te"],
  [/[ಀ-೿]/g, "kn"],
  [/[ഀ-ൿ]/g, "ml"],
  [/[؀-ۿ]/g, "ur"],
  [/[가-힯ᄀ-ᇿ]/g, "ko"],
  [/[぀-ヿ]/g, "ja"],
  [/[一-鿿]/g, "zh"],
  [/[Ѐ-ӿ]/g, "ru"],
];

// Common words in romanized lyrics. Words both Hindi and Punjabi songs use go in SHARED.
const HINDI = words(
  "hai hain mujhe tujhe mujhko tujhko humko tumko kya kyun kyon nahi nahin yeh woh aur bhi kabhi hoon raha rahi rahe gaya gayi gaye tha thi hota hoti kaise kahan yahan wahan jaise apna apni apne tumhe tumhara tumhari hamara hamari jaana aankhon aankhein baatein saath sapne khwab chahta chahti chahiye lagta lagti dekho dekha suno kehna kaha mein jab tab sab wafa dua mohabbat zindagi duniya khuda sanam lamha dhadkan tanha judaa aashiqui bewafa karun karoon jaaun tum hum",
);
const PUNJABI = words(
  "tenu menu mainu sanu tainu tuhanu tuhade kithe kive kidda kiddan naal nal kudi kudiye munda munde mundeya jatt jatti gallan sohni sohneya soniye pind assi tussi tusi sadda saada tuhada karda kardi karde rehnda rehndi jaanda jaandi aaunda aaundi jado jadon hunda hundi akhan lagda lagdi dasso vekh vekhya chaunda chaundi gabru te ni",
);
const SHARED = words("dil pyaar pyar yaar tera teri tere mera meri mere rab rabba mahi sajna sajni jaan raat yaad nain naina ishq haaye haye oye ve ho ke ki ka ko se di da de");
const ENGLISH = words(
  "the and you your i me my is are was it in on of to that this we our love baby oh yeah dont cant im its just know want never feel like when what all so with be for but not now go got get can will would could there here they she he her his them from up down out night heart tonight girl time way one say come back",
);

function words(s: string): Set<string> {
  return new Set(s.split(" "));
}

/**
 * Detect the language of lyrics (or any text). Returns a confidence in [0,1]; short texts such as
 * titles only ever get low confidence.
 */
export function detectLanguage(text: string | undefined | null): { lang?: string; confidence: number } {
  if (!text) return { confidence: 0 };
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (!letters) return { confidence: 0 };

  let bestScript: string | undefined;
  let bestCount = 0;
  for (const [re, lang] of SCRIPTS) {
    const n = text.match(re)?.length ?? 0;
    if (n > bestCount) {
      bestCount = n;
      bestScript = lang;
    }
  }
  if (bestScript && bestCount >= letters * 0.3) return { lang: bestScript, confidence: Math.min(0.95, 0.5 + bestCount / letters / 2) };

  const tokens = fold(text).split(" ").filter(Boolean);
  if (tokens.length < 3) return { confidence: 0 };
  let hi = 0;
  let pa = 0;
  let shared = 0;
  let en = 0;
  for (const t of tokens) {
    if (HINDI.has(t)) hi += 2;
    if (PUNJABI.has(t)) pa += 3;
    if (SHARED.has(t)) shared += 1;
    if (ENGLISH.has(t)) en += 1.2;
  }
  const n = tokens.length;
  const hiScore = (hi + shared * 0.5) / n;
  const paScore = (pa + shared * 0.5) / n;
  const enScore = en / n;
  // Titles and other short texts are weak evidence.
  const lengthTrust = Math.min(1, n / 40);

  let lang: string | undefined;
  let margin = 0;
  if (enScore > Math.max(hiScore, paScore) * 1.2 && enScore >= 0.15) {
    lang = "en";
    margin = enScore - Math.max(hiScore, paScore);
  } else if (pa / n >= 0.06 && pa >= hi * 0.8) {
    lang = "pa";
    margin = paScore - Math.min(hiScore, enScore);
  } else if (hiScore >= 0.08) {
    lang = "hi";
    margin = hiScore - Math.max(paScore * 0.5, enScore);
  }
  if (!lang) return { confidence: 0 };
  return { lang, confidence: Math.max(0.05, Math.min(0.9, (0.35 + margin * 2) * lengthTrust)) };
}

/**
 * The best guess for a song's language, strongest evidence first: its lyrics, the file's
 * language tag, the language its genre implies (e.g. "Tamil"), then its title.
 */
export function guessLanguage(input: { lyrics?: string; tag?: string; genreLang?: string; title?: string }): string | undefined {
  const fromLyrics = detectLanguage(input.lyrics);
  if (fromLyrics.lang && fromLyrics.confidence >= 0.4) return fromLyrics.lang;
  const tagged = normalizeLanguage(input.tag);
  if (tagged) return tagged;
  if (input.genreLang) return input.genreLang;
  if (fromLyrics.lang) return fromLyrics.lang;
  const fromTitle = detectLanguage(input.title);
  return fromTitle.lang && fromTitle.confidence >= 0.1 ? fromTitle.lang : undefined;
}
