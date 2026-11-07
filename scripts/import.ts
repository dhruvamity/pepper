/**
 * Import a folder of songs — one sub-folder per playlist — into Pepper:
 *
 *   npm run import -- "/path/to/Gaana_Re_Gaana" --dry-run   # see what would happen
 *   npm run import -- "/path/to/Gaana_Re_Gaana"             # do it
 *
 * Uses the same database and buckets as the app (.env.local; local mode without it).
 * Needs ffmpeg; fpcalc (brew install chromaprint) adds audio-fingerprint duplicate detection.
 *
 * Options:
 *   --dry-run          scan, find copies and print the plan; change nothing
 *   --yes              don't ask before starting
 *   --bitrate <kbps>   AAC bitrate (default 160); --keep-original stores the files as they are
 *   --limit <n>        add at most n new songs (to try it first)
 *   --order <file>     listing with the original song order (default: MUSIC_CATALOG.md next to
 *                      or inside the folder, if present)
 *   --jobs <n>         songs processed at once (default: CPU cores - 2, at most 8)
 *   --no-playlists     don't create shared playlists from the folders
 *   --no-lyrics        don't look up lyrics
 *   --no-artists       don't look up artist photos and similar artists
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // No .env.local — local mode.
}

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) flags.set(k, v);
    else if (["bitrate", "limit", "order", "jobs"].includes(k) && argv[i + 1] && !argv[i + 1].startsWith("--")) flags.set(k, argv[++i]);
    else flags.set(k, true);
  }
  return { flags, rest };
}

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`;

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const root = rest[0];
  if (!root || flags.has("help")) {
    console.log('Usage: npm run import -- "/path/to/folder" [--dry-run] [--yes] [--limit n] [--bitrate 160 | --keep-original]');
    process.exit(root ? 0 : 1);
  }
  if (!existsSync(root)) {
    console.error(`Folder not found: ${root}`);
    process.exit(1);
  }
  const num = (k: string, d: number) => (typeof flags.get(k) === "string" ? Number(flags.get(k)) : d);
  const orderFile =
    typeof flags.get("order") === "string"
      ? (flags.get("order") as string)
      : [path.join(root, "MUSIC_CATALOG.md"), path.join(path.dirname(path.resolve(root)), "MUSIC_CATALOG.md")].find((f) => existsSync(f));

  const { config, describeBackends } = await import("../src/lib/server/env");
  const { runImport } = await import("../src/lib/import/run");
  const b = describeBackends();
  const target = b.db === "firestore" ? "Firestore + your buckets" : "local mode (.data folder)";
  console.log(`Pepper import → ${target}`);
  if (orderFile) console.log(`Song order from ${orderFile}`);

  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\nStopping after the songs in progress… (Ctrl+C again to quit now)");
  });

  const report = await runImport({
    root,
    dryRun: flags.has("dry-run"),
    bitrate: flags.has("keep-original") ? 0 : num("bitrate", 160),
    concurrency: Math.max(1, num("jobs", Math.min(8, Math.max(2, os.cpus().length - 2)))),
    playlists: !flags.has("no-playlists"),
    lyrics: !flags.has("no-lyrics"),
    artists: !flags.has("no-artists"),
    limit: flags.has("limit") ? num("limit", 0) : undefined,
    orderFile,
    stateDir: path.join(config.dataDir, "imports"),
    uploadedBy: "import",
    log: (line) => console.log(line),
    shouldStop: () => stopping,
    confirm: async (plan) => {
      printPlan(plan);
      if (flags.has("yes")) return true;
      if (!process.stdin.isTTY) {
        console.log("Add --yes to start without asking.");
        return false;
      }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question("Start the import? [y/N] ");
      rl.close();
      return /^y(es)?$/i.test(answer.trim());
    },
  });

  if (flags.has("dry-run")) printPlan(report);
  else if (report.stopped && !report.added) console.log("Nothing changed.");
  else {
    console.log(`\nDone: added ${report.added} songs, ${report.artistsAdded} artists${report.failed.length ? `, ${report.failed.length} failed` : ""}${report.stopped ? " (stopped early — run again to continue)" : ""}.`);
    const stored = Object.entries(report.storedBytes).map(([id, bytes]) => `${id} ${gb(bytes)}`);
    if (stored.length) console.log(`Stored: ${stored.join(", ")} · database writes: about ${report.writes}`);
  }
  if (report.reportFile) console.log(`Report: ${report.reportFile}`);
  process.exit(report.failed.length ? 2 : 0);
}

function printPlan(p: { files: number; skipped: unknown[]; recordings: number; copiesMerged: number; existing: number; toAdd: number; estimatedBytes: number; freeBytes: number; playlists: { name: string; songs: number; exists: boolean }[]; encoder: string; fingerprints: boolean }) {
  console.log("");
  console.log(`  ${p.files} audio files, ${p.skipped.length} skipped (empty or unreadable)`);
  console.log(`  ${p.recordings} different songs — ${p.copiesMerged} files are copies of another`);
  console.log(`  ${p.existing} already in Pepper, ${p.toAdd} to add (about ${gb(p.estimatedBytes)}; ${gb(p.freeBytes)} free in the buckets)`);
  if (p.playlists.length) console.log(`  ${p.playlists.length} shared playlists: ${p.playlists.map((x) => `${x.name} (${x.songs})`).join(", ")}`);
  console.log(`  audio: ${p.encoder === "copy" ? "original files" : `AAC via ${p.encoder}`} · copies found by ${p.fingerprints ? "audio fingerprint + tags" : "file hash + tags"}`);
  console.log("");
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}`);
  process.exit(1);
});
