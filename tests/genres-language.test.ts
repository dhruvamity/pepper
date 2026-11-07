/** Genre canonicalisation and language detection (lines below are made up for the tests). */
import { describe, expect, it } from "vitest";
import { detectLanguage, guessLanguage, languageSimilarity, normalizeLanguage } from "@/lib/metadata/language";
import { canonicalGenres, genreSimilarity, languageFromGenres } from "@/lib/recs/genres";

const ids = (labels: string[]) => [...canonicalGenres(labels).keys()];

describe("canonical genres", () => {
  it("maps store and tag labels to one genre", () => {
    expect(ids(["Bollywood"])).toEqual(["bollywood"]);
    expect(ids(["Filmi"])).toEqual(["bollywood"]);
    expect(ids(["Modern Bollywood"])).toEqual(["bollywood"]);
    expect(ids(["Hip-Hop/Rap"])).toEqual(["hip-hop"]);
    expect(ids(["R&B/Soul"])).toEqual(["rnb"]);
    expect(ids(["Devotional & Spiritual"])).toEqual(["devotional"]);
    expect(ids(["Indian Pop"])).toEqual(["indian-pop"]);
    expect(ids(["Punjabi Pop"])).toEqual(["punjabi"]);
    expect(ids(["Tamil"])).toEqual(["tamil"]);
    expect(ids(["Romantic"])).toEqual([]);
  });

  it("scores related genres between unrelated and identical", () => {
    const sim = (a: string, b: string) => genreSimilarity(canonicalGenres([a]), canonicalGenres([b]));
    expect(sim("Bollywood", "Filmi")).toBe(1);
    expect(sim("Bollywood", "Tamil")).toBeCloseTo(0.75);
    expect(sim("Bollywood", "Indian Pop")).toBeGreaterThan(0.5);
    expect(sim("Punjabi", "Hip-Hop/Rap")).toBeGreaterThan(0.3);
    expect(sim("Bollywood", "Heavy Metal")).toBe(0);
    expect(genreSimilarity(canonicalGenres(["Romantic"]), canonicalGenres(["Bollywood"]))).toBeNull();
  });

  it("knows the language some genres imply", () => {
    expect(languageFromGenres(canonicalGenres(["Telugu"]))).toBe("te");
    expect(languageFromGenres(canonicalGenres(["Punjabi Pop"]))).toBe("pa");
    expect(languageFromGenres(canonicalGenres(["Pop"]))).toBeUndefined();
  });
});

describe("language", () => {
  it("normalizes tags", () => {
    expect(normalizeLanguage("hin")).toBe("hi");
    expect(normalizeLanguage("Punjabi")).toBe("pa");
    expect(normalizeLanguage("ENG")).toBe("en");
    expect(normalizeLanguage("XXX")).toBeUndefined();
  });

  it("reads the script", () => {
    expect(detectLanguage("तुम ही हो, अब तुम ही हो").lang).toBe("hi");
    expect(detectLanguage("ਤੇਰੇ ਨਾਲ ਮੈਂ ਰਹਿਣਾ").lang).toBe("pa");
    expect(detectLanguage("நான் உன்னை காதலிக்கிறேன்").lang).toBe("ta");
    expect(detectLanguage("నేను నిన్ను ప్రేమిస్తున్నాను").lang).toBe("te");
  });

  it("tells romanized Hindi, Punjabi and English apart", () => {
    const hindi =
      "main tujhse pyaar karta hoon, tu meri zindagi hai, kya karun dil nahi maanta, tere bina kuch bhi nahi, har pal teri yaad aati hai, kabhi to mil jaana, yeh duniya kuch nahi tum ho to sab hai";
    const punjabi =
      "tenu vekh ke dil mera nachda, kudi sohni naal mere chal ve, mainu tere bina kuch nahi sujhda, assi tere ho gaye sohneya, jado tu hasdi te chann vi sharma jaanda, pind de raah te tera intezaar";
    const english =
      "i walk alone at night and you are on my mind, never let me go, baby i know the way back home, when the lights go down we can feel it all, hold my heart tonight";
    expect(detectLanguage(hindi)).toMatchObject({ lang: "hi" });
    expect(detectLanguage(punjabi)).toMatchObject({ lang: "pa" });
    expect(detectLanguage(english)).toMatchObject({ lang: "en" });
    expect(detectLanguage(hindi).confidence).toBeGreaterThan(0.4);
    expect(detectLanguage("Tum Hi Ho").confidence).toBeLessThan(0.3);
  });

  it("prefers lyrics, then the tag, then the genre, then the title", () => {
    const punjabi = "tenu vekh ke dil mera nachda, kudi sohni naal mere chal ve, mainu tere bina kuch nahi sujhda, assi tere ho gaye sohneya";
    expect(guessLanguage({ lyrics: punjabi, tag: "hin" })).toBe("pa");
    expect(guessLanguage({ tag: "hin", genreLang: "ta" })).toBe("hi");
    expect(guessLanguage({ genreLang: "ta", title: "Tum Hi Ho" })).toBe("ta");
    expect(guessLanguage({ title: "Tum Hi Ho Mere Sanam" })).toBe("hi");
    expect(guessLanguage({})).toBeUndefined();
  });

  it("treats Hindi and Urdu as nearly the same", () => {
    expect(languageSimilarity("hi", "ur")).toBeGreaterThan(0.8);
    expect(languageSimilarity("hi", "ta")).toBe(0);
    expect(languageSimilarity("hi", undefined)).toBeNull();
  });
});
