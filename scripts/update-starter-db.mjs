import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const tauriResourcesDir = path.join(rootDir, "src-tauri", "resources");
const bundledSeedDbPath = path.join(tauriResourcesDir, "library.seed.db");

function fail(message) {
  console.error(`\n[seed-db] ${message}\n`);
  process.exit(1);
}

function defaultAppDbPath() {
  switch (process.platform) {
    case "darwin":
      return path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "oscata-tauri",
        "library.db",
      );
    case "win32":
      return path.join(
        process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
        "oscata-tauri",
        "library.db",
      );
    default: {
      const dataHome =
        process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
      return path.join(dataHome, "oscata-tauri", "library.db");
    }
  }
}

function parseArgs(argv) {
  let source = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--from") source = argv[i + 1] ?? null, i += 1;
    else if (!arg.startsWith("--")) source = arg;
  }

  return { source, dryRun };
}

function main() {
  const { source, dryRun } = parseArgs(process.argv.slice(2));
  const sourcePath = path.resolve(rootDir, source ?? defaultAppDbPath());

  console.log(`[seed-db] source: ${sourcePath}`);
  console.log(`[seed-db] target: ${bundledSeedDbPath}`);

  if (!fs.existsSync(sourcePath)) {
    fail("Source database not found. Pass a path or create/export the app database first.");
  }

  if (dryRun) {
    console.log("[seed-db] dry run only; no files changed.");
    return;
  }

  fs.mkdirSync(tauriResourcesDir, { recursive: true });
  fs.copyFileSync(sourcePath, bundledSeedDbPath);

  console.log("[seed-db] bundled starter database updated.");
}

main();
