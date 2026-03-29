import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function runPython(script, args = []) {
  const attempts = process.platform === "win32"
    ? [["py", ["-3", "-c", script, ...args]], ["python", ["-c", script, ...args]]]
    : [["python3", ["-c", script, ...args]], ["python", ["-c", script, ...args]]];

  for (const [bin, binArgs] of attempts) {
    const result = spawnSync(bin, binArgs, { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      return result.stdout.trim();
    }
  }
  fail("Python 3 is required to sanitize the bundled seed database.");
}

function sanitizeBundledSeedDb(databasePath) {
  const script = `
import sqlite3, sys
db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
cur = conn.cursor()
tables = {
    row[0] for row in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
}
for table in ("app_config", "web_users", "web_sessions", "web_invites", "web_otps", "download_state"):
    if table in tables:
        cur.execute(f"DELETE FROM {table}")
conn.commit()
conn.close()
print("sanitized")
`;
  runPython(script, [databasePath]);
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
  sanitizeBundledSeedDb(bundledSeedDbPath);

  console.log("[seed-db] bundled starter database updated and sanitized.");
}

main();
