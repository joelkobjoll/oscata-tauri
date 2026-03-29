import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(import.meta.dirname, "..");
const seedDbPath = path.join(rootDir, "src-tauri", "resources", "library.seed.db");

const SENSITIVE_CONFIG_KEYS = [
  "tmdb_api_key",
  "ftp_user",
  "ftp_pass",
  "emby_api_key",
  "plex_token",
  "smtp_pass",
];

const TABLES_SHOULD_BE_EMPTY = [
  "app_config",
  "web_users",
  "web_sessions",
  "web_invites",
  "web_otps",
  "download_state",
];

function fail(message) {
  console.error(`\n[seed-verify] ${message}\n`);
  process.exit(1);
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

  fail("Python 3 is required to verify bundled seed DB sanitation.");
}

function verifySeedDb(dbPath) {
  const script = `
import json
import sqlite3
import sys

path = sys.argv[1]
keys = [k for k in sys.argv[2].split(',') if k]
tables_to_check = [t for t in sys.argv[3].split(',') if t]

conn = sqlite3.connect(path)
cur = conn.cursor()
existing_tables = {
    row[0] for row in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
}

result = {
    "sensitive_rows": [],
    "table_counts": {},
    "missing_tables": [],
}

if "app_config" in existing_tables and keys:
    placeholders = ",".join(["?"] * len(keys))
    sql = f"SELECT key, value FROM app_config WHERE key IN ({placeholders})"
    result["sensitive_rows"] = cur.execute(sql, keys).fetchall()

for table in tables_to_check:
    if table in existing_tables:
      result["table_counts"][table] = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    else:
      result["missing_tables"].append(table)

conn.close()
print(json.dumps(result))
`;

  const raw = runPython(script, [
    dbPath,
    SENSITIVE_CONFIG_KEYS.join(","),
    TABLES_SHOULD_BE_EMPTY.join(","),
  ]);

  let parsed;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    fail("Could not parse seed DB verification output.");
  }

  const sensitiveRows = Array.isArray(parsed.sensitive_rows) ? parsed.sensitive_rows : [];
  const tableCounts = parsed.table_counts && typeof parsed.table_counts === "object"
    ? parsed.table_counts
    : {};

  if (sensitiveRows.length > 0) {
    const keys = sensitiveRows.map((row) => row[0]).join(", ");
    fail(`Bundled seed DB contains sensitive app_config keys: ${keys}`);
  }

  const nonEmptyTables = Object.entries(tableCounts)
    .filter(([, count]) => Number(count) > 0)
    .map(([table, count]) => `${table}=${count}`);

  if (nonEmptyTables.length > 0) {
    fail(`Bundled seed DB has non-empty sensitive/local tables: ${nonEmptyTables.join(", ")}`);
  }

  console.log("[seed-verify] OK: bundled seed DB is sanitized.");
}

function main() {
  if (!fs.existsSync(seedDbPath)) {
    fail(`Bundled seed DB not found at: ${seedDbPath}`);
  }

  verifySeedDb(seedDbPath);
}

main();
