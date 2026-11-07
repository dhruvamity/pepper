/** Production-browser QA in a disposable copy; never reads .env or touches cloud data. */
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "pepper-e2e-"));
const app = join(workspace, "app");
await mkdir(app);
const env = Object.fromEntries(["HOME", "TMPDIR", "TEMP", "SystemRoot", "PLAYWRIGHT_BROWSERS_PATH"].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, {
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
  NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PEPPER_DB: "local",
  PEPPER_DATA_DIR: join(workspace, "data"), PEPPER_ALLOW_DEMO_LOGIN: "true",
  ENRICH_GENRES: "false", ENRICH_LYRICS: "false", ENRICH_ARTIST_IMAGES: "false",
});
const run = (args, cwd, childEnv = env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${args[0]} exited ${code}`)));
});
let server;
let passed = false;
try {
  for (const name of ["src", "public", "scripts", "package.json", "package-lock.json", "tsconfig.json", "next.config.ts"])
    await cp(join(root, name), join(app, name), { recursive: true });
  // The test build uses system fonts so it does not fetch Google's font assets.
  const layoutFile = join(app, "src/app/layout.tsx");
  const layout = (await readFile(layoutFile, "utf8"))
    .replace('import { Figtree } from "next/font/google";\n', "")
    .replace(/const figtree = Figtree\([\s\S]*?\n\}\);\n/, 'const figtree = { variable: "" };\n');
  await writeFile(layoutFile, layout);
  const cssFile = join(app, "src/app/globals.css");
  const css = (await readFile(cssFile, "utf8")).replace('--font-sans: var(--font-figtree), "Helvetica Neue", Helvetica, Arial, sans-serif;', '--font-sans: "Helvetica Neue", Helvetica, Arial, sans-serif;');
  await writeFile(cssFile, css);
  // APFS clone is fast and keeps Turbopack's dependency root within the isolated app.
  const cloned = process.platform === "darwin" && spawnSync("cp", ["-cR", join(root, "node_modules"), join(app, "node_modules")]).status === 0;
  if (!cloned) await cp(join(root, "node_modules"), join(app, "node_modules"), { recursive: true });
  await run(["node_modules/next/dist/bin/next", "build"], app);
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { cwd: app, env, stdio: ["ignore", "pipe", "inherit"] });
  const origin = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Server startup timed out")), 30_000);
    server.on("error", reject);
    server.on("exit", (code) => reject(new Error(`Server exited ${code}`)));
    server.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match && output.includes("Ready")) { clearTimeout(timeout); resolve(match[0]); }
    });
  });
  console.log(`Isolated test app: ${origin}; artifacts: ${workspace}`);
  await run(["node_modules/@playwright/test/cli.js", "test"], root, {
    ...env, PEPPER_E2E_ORIGIN: origin, PEPPER_E2E_OUTPUT: join(workspace, "results"),
    ...((process.env.PEPPER_E2E_BROWSER || (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined))
      ? { PEPPER_E2E_BROWSER: process.env.PEPPER_E2E_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}),
  });
  passed = true;
} finally {
  server?.kill("SIGTERM");
  if (passed && !process.env.PEPPER_E2E_KEEP) await rm(workspace, { recursive: true, force: true });
  else console.log(`Kept test workspace: ${workspace}`);
}
