import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(rootDir, "package.json");
const packageLockPath = path.join(rootDir, "package-lock.json");
const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
const tauriResourcesDir = path.join(rootDir, "src-tauri", "resources");
const bundledSeedDbPath = path.join(tauriResourcesDir, "library.seed.db");

const VALID_SEMVER = /^\d+\.\d+\.\d+$/;

function fail(message) {
  console.error(`\n[release] ${message}\n`);
  process.exit(1);
}

function run(command) {
  console.log(`[release] ${command}`);
  execSync(command, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
    shell: "/bin/bash",
  });
}

function parseArgs(argv) {
  let target = "patch";
  let build = false;
  let skipChecks = false;
  let dryRun = false;
  let seedDb = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--build") build = true;
    else if (arg === "--skip-checks") skipChecks = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--seed-db") seedDb = argv[i + 1] ?? null, i += 1;
    else if (!arg.startsWith("--")) target = arg;
  }

  return { target, build, skipChecks, dryRun, seedDb };
}

function bumpVersion(version, bump) {
  const [major, minor, patch] = version.split(".").map(Number);
  switch (bump) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default:
      if (VALID_SEMVER.test(bump)) return bump;
      fail(
        "Use `patch`, `minor`, `major`, or an explicit semver like `0.2.0`.",
      );
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function updateCargoToml(content, nextVersion) {
  return content.replace(
    /^version = "[^"]+"$/m,
    `version = "${nextVersion}"`,
  );
}

function main() {
  const { target, build, skipChecks, dryRun, seedDb } = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const packageLock = fs.existsSync(packageLockPath)
    ? JSON.parse(fs.readFileSync(packageLockPath, "utf8"))
    : null;
  const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");

  const currentVersion = packageJson.version;
  if (!VALID_SEMVER.test(currentVersion)) {
    fail(`Current package.json version is not simple semver: ${currentVersion}`);
  }

  const nextVersion = bumpVersion(currentVersion, target);

  console.log(`[release] current version: ${currentVersion}`);
  console.log(`[release] next version:    ${nextVersion}`);
  if (seedDb) {
    console.log(`[release] seed db:         ${seedDb}`);
  }

  if (dryRun) {
    console.log("[release] dry run only; no files changed.");
    return;
  }

  packageJson.version = nextVersion;
  writeJson(packageJsonPath, packageJson);

  if (packageLock) {
    packageLock.version = nextVersion;
    if (packageLock.packages?.[""]) {
      packageLock.packages[""].version = nextVersion;
    }
    writeJson(packageLockPath, packageLock);
  }

  fs.writeFileSync(cargoTomlPath, updateCargoToml(cargoToml, nextVersion));

  if (seedDb) {
    const sourceSeedDb = path.resolve(rootDir, seedDb);
    if (!fs.existsSync(sourceSeedDb)) {
      fail(`Seed DB not found: ${sourceSeedDb}`);
    }
    fs.mkdirSync(tauriResourcesDir, { recursive: true });
    fs.copyFileSync(sourceSeedDb, bundledSeedDbPath);
  }

  if (!skipChecks) {
    run("source ~/.nvm/nvm.sh && nvm use 22 --silent && npm run build");
    run("cargo check --manifest-path src-tauri/Cargo.toml");
  }

  if (build) {
    run("source ~/.nvm/nvm.sh && nvm use 22 --silent && npm run tauri build");
  }

  console.log("\n[release] done.");
  console.log(`[release] version updated to ${nextVersion}`);
}

main();
