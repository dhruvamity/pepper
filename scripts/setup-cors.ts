/**
 * Configure CORS on every configured bucket (R2 and each Backblaze account) so browsers can
 * upload directly (presigned PUT) and stream audio. Run once after adding a bucket:
 *
 *   npm run setup:cors -- https://your-app.vercel.app
 *
 * http://localhost:3000 is always included for local development.
 */
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // No .env.local — use the current environment.
}

async function main() {
  const { config } = await import("../src/lib/server/env");
  const { S3Provider } = await import("../src/lib/server/storage/s3");
  const origins = [...new Set([...process.argv.slice(2).filter((a) => /^https?:\/\//.test(a)), "http://localhost:3000"])].map((o) => o.replace(/\/$/, ""));
  if (!config.storage.s3.length) {
    console.error("No R2_* or B2_* credentials found in .env.local — nothing to configure.");
    process.exit(1);
  }
  console.log(`Allowing origins: ${origins.join(", ")}`);
  let failed = false;
  for (const cfg of config.storage.s3) {
    const p = new S3Provider(cfg);
    try {
      await p.setCors(origins);
      console.log(`✓ ${cfg.label} (${cfg.bucket}): CORS updated`);
    } catch (err) {
      failed = true;
      console.error(`✗ ${cfg.label} (${cfg.bucket}): ${(err as Error).message}`);
      if (cfg.kind === "b2") {
        console.error(
          "  In the Backblaze web UI: Buckets → your bucket → CORS Rules → allow your origins for the S3 Compatible API (GET, HEAD, PUT, all headers).",
        );
      } else {
        console.error("  In the Cloudflare dashboard: R2 → your bucket → Settings → CORS Policy, allow GET, HEAD, PUT with all headers.");
      }
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
