"use client";

import type { TrackDraft } from "@/lib/metadata/normalize";

export type EditableMeta = Pick<
  TrackDraft,
  "title" | "subtitle" | "artists" | "albumArtist" | "album" | "film" | "genres" | "year" | "releaseDate" | "trackNo" | "trackTotal" | "discNo" | "label" | "copyright" | "explicit" | "composers" | "lyricists" | "language" | "isrc"
>;

const field = "h-10 w-full rounded-md bg-white/[0.07] px-3 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-muted focus:ring-white/40";
const list = (v: string) =>
  v
    .split(/\s*[,;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-semibold text-subdued">{label}</span>
      {children}
    </label>
  );
}

/** Metadata editor shared by the upload queue and the library manager. */
export function TrackForm({ value, onChange }: { value: EditableMeta; onChange: (v: EditableMeta) => void }) {
  const set = <K extends keyof EditableMeta>(k: K, v: EditableMeta[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Title">
        <input className={field} value={value.title} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <Field label="Version / subtitle">
        <input className={field} value={value.subtitle ?? ""} onChange={(e) => set("subtitle", e.target.value || undefined)} placeholder='e.g. From "Film" · Remastered' />
      </Field>
      <Field label="Artists (comma separated)" wide>
        <input className={field} value={value.artists.join(", ")} onChange={(e) => set("artists", list(e.target.value))} />
      </Field>
      <Field label="Album">
        <input className={field} value={value.album} onChange={(e) => set("album", e.target.value)} />
      </Field>
      <Field label="Album artist">
        <input className={field} value={value.albumArtist ?? ""} onChange={(e) => set("albumArtist", e.target.value || undefined)} />
      </Field>
      <Field label="Film / show">
        <input className={field} value={value.film ?? ""} onChange={(e) => set("film", e.target.value || undefined)} />
      </Field>
      <Field label="Genres (comma separated)">
        <input className={field} value={value.genres.join(", ")} onChange={(e) => set("genres", list(e.target.value))} />
      </Field>
      <div className="grid grid-cols-3 gap-3 sm:col-span-2">
        <Field label="Year">
          <input className={field} inputMode="numeric" value={value.year ?? ""} onChange={(e) => set("year", Number(e.target.value) || undefined)} />
        </Field>
        <Field label="Track #">
          <input className={field} inputMode="numeric" value={value.trackNo ?? ""} onChange={(e) => set("trackNo", Number(e.target.value) || undefined)} />
        </Field>
        <Field label="Disc #">
          <input className={field} inputMode="numeric" value={value.discNo ?? ""} onChange={(e) => set("discNo", Number(e.target.value) || undefined)} />
        </Field>
      </div>
      <Field label="Release date">
        <input className={field} type="date" value={value.releaseDate ?? ""} onChange={(e) => set("releaseDate", e.target.value || undefined)} />
      </Field>
      <Field label="Label">
        <input className={field} value={value.label ?? ""} onChange={(e) => set("label", e.target.value || undefined)} />
      </Field>
      <Field label="Composers">
        <input className={field} value={(value.composers ?? []).join(", ")} onChange={(e) => set("composers", list(e.target.value))} />
      </Field>
      <Field label="Lyricists">
        <input className={field} value={(value.lyricists ?? []).join(", ")} onChange={(e) => set("lyricists", list(e.target.value))} />
      </Field>
      <Field label="Copyright" wide>
        <input className={field} value={value.copyright ?? ""} onChange={(e) => set("copyright", e.target.value || undefined)} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-subdued">
        <input type="checkbox" className="h-4 w-4 accent-[#1ed760]" checked={Boolean(value.explicit)} onChange={(e) => set("explicit", e.target.checked)} />
        Explicit
      </label>
    </div>
  );
}

/** Convert form values into the API payload shape, dropping empty/invalid fields. */
export function cleanMeta(v: EditableMeta) {
  const s = (x?: string, max = 300) => (x && x.trim() ? x.trim().slice(0, max) : undefined);
  const n = (x?: number) => (x && Number.isInteger(x) && x > 0 && x < 10000 ? x : undefined);
  return {
    title: v.title.trim() || "Untitled",
    subtitle: s(v.subtitle),
    artists: v.artists.length ? v.artists.map((a) => a.slice(0, 120)) : ["Unknown Artist"],
    albumArtist: s(v.albumArtist, 120),
    album: s(v.album) ?? v.title,
    film: s(v.film, 200),
    genres: v.genres.slice(0, 6).map((g) => g.slice(0, 60)),
    year: v.year && v.year > 1800 && v.year < 2200 ? Math.round(v.year) : undefined,
    releaseDate: v.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(v.releaseDate) ? v.releaseDate : undefined,
    trackNo: n(v.trackNo),
    trackTotal: n(v.trackTotal),
    discNo: n(v.discNo),
    label: s(v.label, 200),
    copyright: s(v.copyright),
    explicit: v.explicit || undefined,
    composers: (v.composers ?? []).slice(0, 30),
    lyricists: (v.lyricists ?? []).slice(0, 30),
    language: s(v.language, 10),
    isrc: s(v.isrc, 20),
  };
}
