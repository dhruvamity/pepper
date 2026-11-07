/**
 * How well autoplay continues from a single song on your real library, using the shared playlists
 * as the answer key (see src/lib/recs/eval.ts):
 *
 *   npm run eval:autoplay
 *
 * Read-only: loads the catalog from the same database the app uses (.env.local).
 */
export {};
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // local mode
}

async function main() {
  const { repo } = await import("../src/lib/server/db");
  const { evaluateAutoplay } = await import("../src/lib/recs/eval");
  const { emptyTaste } = await import("../src/lib/server/db/types");
  const db = await repo();
  const catalog = await db.getCatalog();
  if (!catalog.playlists?.length) {
    console.log("No shared playlists yet — import some folders first (npm run import).");
    return;
  }
  console.log(`${catalog.tracks.length} songs, ${catalog.playlists.length} shared playlists. Running…`);
  const r = evaluateAutoplay(
    { tracks: catalog.tracks, artists: catalog.artists, playlists: catalog.playlists, stats: await db.getTrackStats(), taste: emptyTaste(), likes: {}, followed: {}, cooc: {}, now: Date.now() },
    { k: 10, splits: 3, seedsPerSplit: 4 },
  );
  if (!r.withPlaylists.runs) {
    console.log("This check needs playlists with at least 8 songs.");
    return;
  }
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(7);
  console.log(`\nAutoplay from one song, next ${r.k} songs (${r.withPlaylists.runs} starts across ${r.playlists} playlists):\n`);
  console.log("                                      with playlists   without   random");
  console.log(`  hidden playlist songs found           ${pct(r.withPlaylists.found)}   ${pct(r.withoutPlaylists.found)}  ${pct(r.random.found)}`);
  console.log(`  songs sharing a playlist with start   ${pct(r.withPlaylists.samePlaylist)}   ${pct(r.withoutPlaylists.samePlaylist)}  ${pct(r.random.samePlaylist)}`);
  console.log(`  same language as the start song       ${pct(r.withPlaylists.sameLanguage)}   ${pct(r.withoutPlaylists.sameLanguage)}`);
  console.log("\n\"Hidden\" songs were taken out of their playlist first, so they can only be found by how they sound,");
  console.log("who sings them, genre, language, era and other playlists they're in.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
