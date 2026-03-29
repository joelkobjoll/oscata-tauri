import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const rootDir = path.resolve(import.meta.dirname, "..");
const bundledSeedDbPath = path.join(
  rootDir,
  "src-tauri",
  "resources",
  "library.seed.db",
);

function fail(message) {
  console.error(`\n[seed-sync] ${message}\n`);
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
  let seed = null;
  let target = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--from") {
      seed = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--to") {
      target = argv[i + 1] ?? null;
      i += 1;
    }
  }

  return { seed, target, dryRun };
}

function ensureSqlite3() {
  const probe = spawnSync("sqlite3", ["-version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    fail("sqlite3 CLI is required but was not found in PATH.");
  }
}

function runSqlite(databasePath, sql) {
  return execFileSync("sqlite3", [databasePath], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  }).trim();
}

function quoteForSql(value) {
  return value.replace(/'/g, "''");
}

function hasColumn(databasePath, tableName, columnName) {
  const pragmaSql = `PRAGMA table_info(${tableName});`;
  const output = runSqlite(databasePath, pragmaSql);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => {
      const cells = line.split("|");
      return cells[1] === columnName;
    });
}

function main() {
  ensureSqlite3();

  const { seed, target, dryRun } = parseArgs(process.argv.slice(2));
  const seedPath = path.resolve(rootDir, seed ?? bundledSeedDbPath);
  const targetPath = path.resolve(rootDir, target ?? defaultAppDbPath());

  console.log(`[seed-sync] seed:   ${seedPath}`);
  console.log(`[seed-sync] target: ${targetPath}`);

  if (!fs.existsSync(seedPath)) {
    fail("Seed database not found. Use --from <path> to provide it.");
  }
  if (!fs.existsSync(targetPath)) {
    fail("Target database not found. Use --to <path> to provide it.");
  }

  const targetHasImdb = hasColumn(targetPath, "media_items", "imdb_id");
  if (!targetHasImdb) {
    if (dryRun) {
      console.log(
        "[seed-sync] target missing imdb_id column; dry run will report 0 updates.",
      );
      console.log("[seed-sync] dry run enabled; no changes applied.");
      return;
    }
    runSqlite(targetPath, "ALTER TABLE media_items ADD COLUMN imdb_id TEXT;");
    console.log(
      "[seed-sync] added missing imdb_id column to target media_items table.",
    );
  }

  const attachSeed = quoteForSql(seedPath);
  const sourceColumnsSql = `
ATTACH '${attachSeed}' AS seed;
PRAGMA seed.table_info(media_items);
DETACH seed;
`;
  const sourceColumns = runSqlite(targetPath, sourceColumnsSql);
  const sourceHasImdb = sourceColumns
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => line.split("|")[1] === "imdb_id");
  if (!sourceHasImdb) {
    console.log(
      "[seed-sync] seed database has no imdb_id column; nothing to backfill.",
    );
    return;
  }

  const pendingSql = `
ATTACH '${attachSeed}' AS seed;
SELECT COUNT(*)
FROM media_items local
JOIN seed.media_items src ON src.ftp_path = local.ftp_path
WHERE (local.imdb_id IS NULL OR TRIM(local.imdb_id) = '')
  AND src.imdb_id IS NOT NULL
  AND TRIM(src.imdb_id) <> '';
DETACH seed;
`;

  const pending =
    Number.parseInt(runSqlite(targetPath, pendingSql) || "0", 10) || 0;
  console.log(`[seed-sync] rows needing imdb_id backfill: ${pending}`);

  if (dryRun || pending === 0) {
    if (dryRun) {
      console.log("[seed-sync] dry run enabled; no changes applied.");
    }
    return;
  }

  const backupPath = `${targetPath}.bak.${Date.now()}`;
  fs.copyFileSync(targetPath, backupPath);
  console.log(`[seed-sync] backup created: ${backupPath}`);

  const updateSql = `
ATTACH '${attachSeed}' AS seed;
BEGIN;
UPDATE media_items AS local
SET imdb_id = (
  SELECT src.imdb_id
  FROM seed.media_items src
  WHERE src.ftp_path = local.ftp_path
)
WHERE (local.imdb_id IS NULL OR TRIM(local.imdb_id) = '')
  AND EXISTS (
    SELECT 1
    FROM seed.media_items src
    WHERE src.ftp_path = local.ftp_path
      AND src.imdb_id IS NOT NULL
      AND TRIM(src.imdb_id) <> ''
  );
SELECT changes();
COMMIT;
DETACH seed;
`;

  const updated =
    Number.parseInt(runSqlite(targetPath, updateSql) || "0", 10) || 0;
  console.log(`[seed-sync] rows updated: ${updated}`);
}

main();
