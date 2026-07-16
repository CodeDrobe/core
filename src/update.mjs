import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./version.mjs";

export const PACKAGE_NAME = "@codedrobe/core";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`Invalid semantic version '${value}'.`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumber = /^\d+$/.test(left[index]) ? Number(left[index]) : null;
    const rightNumber = /^\d+$/.test(right[index]) ? Number(right[index]) : null;
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return Math.sign(left[key] - right[key]);
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function getUpdateCacheFile({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.CODEDROBE_UPDATE_CACHE) return path.resolve(env.CODEDROBE_UPDATE_CACHE);
  if (env.CODEDROBE_CACHE_DIR) return path.resolve(env.CODEDROBE_CACHE_DIR, "update-check.json");
  if (platform === "darwin") return path.join(home, "Library", "Caches", "codedrobe", "update-check.json");
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(base, "CodeDrobe", "Cache", "update-check.json");
  }
  return path.join(env.XDG_CACHE_HOME || path.join(home, ".cache"), "codedrobe", "update-check.json");
}

async function readFreshCache(cacheFile, now, maxAgeMs) {
  try {
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    const checkedAt = Date.parse(cached.checkedAt);
    if (
      cached.packageName !== PACKAGE_NAME
      || typeof cached.latest !== "string"
      || !Number.isFinite(checkedAt)
      || now - checkedAt < 0
      || now - checkedAt >= maxAgeMs
    ) return null;
    parseVersion(cached.latest);
    return cached;
  } catch {
    return null;
  }
}

async function writeCache(cacheFile, value) {
  const temporary = `${cacheFile}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, cacheFile);
  } catch {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function normalizeRegistry(registry) {
  let parsed;
  try {
    parsed = new URL(registry || DEFAULT_REGISTRY);
  } catch {
    throw new Error(`Invalid npm registry URL '${registry}'.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported npm registry protocol '${parsed.protocol}'.`);
  }
  return parsed.href.replace(/\/+$/, "");
}

export async function checkForUpdate({
  cacheFile = getUpdateCacheFile(),
  currentVersion = VERSION,
  fetchImpl = globalThis.fetch,
  force = false,
  maxAgeMs = UPDATE_CHECK_INTERVAL_MS,
  now = Date.now(),
  registry = process.env.npm_config_registry || DEFAULT_REGISTRY,
  timeoutMs = 5_000,
} = {}) {
  parseVersion(currentVersion);
  if (!force) {
    const cached = await readFreshCache(cacheFile, now, maxAgeMs);
    if (cached) {
      return {
        packageName: PACKAGE_NAME,
        current: currentVersion,
        latest: cached.latest,
        updateAvailable: compareVersions(currentVersion, cached.latest) < 0,
        checkedAt: cached.checkedAt,
        source: "cache",
      };
    }
  }

  if (typeof fetchImpl !== "function") throw new Error("This runtime does not provide fetch().");
  const registryBase = normalizeRegistry(registry);
  const packagePath = PACKAGE_NAME.replace("/", "%2F");
  const response = await fetchImpl(`${registryBase}/${packagePath}/latest`, {
    headers: { accept: "application/json", "user-agent": `codedrobe/${currentVersion}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}.`);
  const manifest = await response.json();
  if (!manifest || typeof manifest.version !== "string") throw new Error("npm registry response does not contain a version.");
  parseVersion(manifest.version);

  const checkedAt = new Date(now).toISOString();
  await writeCache(cacheFile, { schemaVersion: 1, packageName: PACKAGE_NAME, latest: manifest.version, checkedAt });
  return {
    packageName: PACKAGE_NAME,
    current: currentVersion,
    latest: manifest.version,
    updateAvailable: compareVersions(currentVersion, manifest.version) < 0,
    checkedAt,
    source: "registry",
  };
}

export function detectPackageManager({ env = process.env, packageRoot = PACKAGE_ROOT, versions = process.versions } = {}) {
  const normalizedRoot = packageRoot.replaceAll("\\", "/").toLowerCase();
  const userAgent = String(env.npm_config_user_agent || "").toLowerCase();
  if (normalizedRoot.includes("/.bun/install/global/")) return "bun";
  if (normalizedRoot.includes("/pnpm/global/") || normalizedRoot.includes("/.pnpm-global/")) return "pnpm";
  if (normalizedRoot.includes("/lib/node_modules/@codedrobe/core") || normalizedRoot.includes("/npm/node_modules/@codedrobe/core")) return "npm";
  if (userAgent.startsWith("bun/") || versions.bun) return "bun";
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  return "npm";
}

export function getUpdateCommand(packageManager = detectPackageManager()) {
  if (packageManager === "bun") return { command: "bun", args: ["add", "--global", `${PACKAGE_NAME}@latest`] };
  if (packageManager === "pnpm") return { command: "pnpm", args: ["add", "--global", `${PACKAGE_NAME}@latest`] };
  return { command: "npm", args: ["install", "--global", `${PACKAGE_NAME}@latest`] };
}

export function formatCommand({ command, args }) {
  return [command, ...args].join(" ");
}

async function runPackageManager(command, args, { quiet = false } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: quiet ? "ignore" : "inherit", shell: false });
    child.once("error", (error) => reject(new Error(`Unable to run ${command}: ${error.message}`)));
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} update failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

export async function updateCodeDrobe({
  checkOptions = {},
  packageManager = detectPackageManager(),
  quiet = false,
  runner = runPackageManager,
} = {}) {
  const status = await checkForUpdate({ ...checkOptions, force: true });
  const updateCommand = getUpdateCommand(packageManager);
  if (!status.updateAvailable) return { ...status, packageManager, command: formatCommand(updateCommand), updated: false };
  await runner(updateCommand.command, updateCommand.args, { quiet });
  return { ...status, packageManager, command: formatCommand(updateCommand), updated: true };
}

function environmentFlag(value) {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase?.() !== "false";
}

export function isGlobalInstallation(packageRoot = PACKAGE_ROOT) {
  const normalized = packageRoot.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("/lib/node_modules/@codedrobe/core")
    || normalized.includes("/npm/node_modules/@codedrobe/core")
    || normalized.includes("/.bun/install/global/")
    || normalized.includes("/pnpm/global/")
    || normalized.includes("/.pnpm-global/");
}

export function shouldNotifyUpdate({
  command,
  env = process.env,
  json = false,
  packageRoot = PACKAGE_ROOT,
  stderrIsTTY = process.stderr.isTTY,
} = {}) {
  if (!stderrIsTTY || json || !isGlobalInstallation(packageRoot)) return false;
  if (["help", "version", "update"].includes(command)) return false;
  if (environmentFlag(env.CI) || environmentFlag(env.NO_UPDATE_NOTIFIER) || environmentFlag(env.CODEDROBE_DISABLE_UPDATE_CHECK)) return false;
  return true;
}

export async function maybeNotifyUpdate({
  checkOptions = {},
  command,
  env = process.env,
  json = false,
  packageRoot = PACKAGE_ROOT,
  stderr = console.error,
  stderrIsTTY = process.stderr.isTTY,
} = {}) {
  if (!shouldNotifyUpdate({ command, env, json, packageRoot, stderrIsTTY })) return null;
  try {
    const status = await checkForUpdate({ timeoutMs: 1_500, ...checkOptions });
    if (status.updateAvailable) {
      const updateCommand = getUpdateCommand(detectPackageManager({ env, packageRoot }));
      stderr(`[codedrobe] Update available ${status.current} → ${status.latest}. Run: ${formatCommand(updateCommand)}`);
    }
    return status;
  } catch {
    return null;
  }
}
