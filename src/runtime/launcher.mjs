import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { findTargets } from "./injector.mjs";

const execFileAsync = promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function expandPath(value) {
  return value
    .replace(/^~(?=\/|$)/, os.homedir())
    .replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
}

async function isExecutable(filename) {
  try {
    const stats = await fs.stat(filename);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function discoverCustom(adapter, config, appPath, platform) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const resolved = path.resolve(expandPath(appPath));
  const relativeExecutables = [];
  if (config.executableRelative) relativeExecutables.push(config.executableRelative);
  for (const candidate of config.executableCandidates ?? []) {
    relativeExecutables.push(pathApi.basename(candidate));
  }
  relativeExecutables.push(...(config.processNames ?? []));

  for (const relative of [...new Set(relativeExecutables)]) {
    const executable = pathApi.join(resolved, relative);
    if (await isExecutable(executable)) {
      return { appId: adapter.id, appPath: resolved, executable };
    }
  }
  if (await isExecutable(resolved)) {
    return { appId: adapter.id, appPath: pathApi.dirname(resolved), executable: resolved };
  }
  return null;
}

async function discoverMac(adapter, config) {
  const candidates = config.appCandidates.map(expandPath);
  if (config.bundleId) {
    try {
      const { stdout } = await execFileAsync("mdfind", [`kMDItemCFBundleIdentifier == "${config.bundleId}"`]);
      candidates.push(...stdout.split(/\r?\n/).filter(Boolean));
    } catch { /* Candidate paths still work when Spotlight is unavailable. */ }
  }
  for (const appPath of [...new Set(candidates)]) {
    const executable = path.join(appPath, config.executableRelative);
    if (await isExecutable(executable)) return { appId: adapter.id, appPath, executable };
  }
  return null;
}

async function discoverWindows(adapter, config) {
  if (config.appxPackage) {
    const script = `(Get-AppxPackage ${config.appxPackage} | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation`;
    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
      const appPath = stdout.trim();
      if (appPath) {
        const executable = path.join(appPath, config.executableRelative);
        if (await isExecutable(executable)) return { appId: adapter.id, appPath, executable };
      }
    } catch { /* Fall through to explicit candidates. */ }
  }
  for (const candidate of config.executableCandidates ?? []) {
    const executable = expandPath(candidate);
    if (await isExecutable(executable)) return { appId: adapter.id, appPath: path.dirname(executable), executable };
  }
  return null;
}

export async function discoverApp(adapter, platform = process.platform, appPath = null) {
  const config = adapter.platforms[platform];
  if (!config) return null;
  if (appPath) return discoverCustom(adapter, config, appPath, platform);
  if (platform === "darwin") return discoverMac(adapter, config);
  if (platform === "win32") return discoverWindows(adapter, config);
  return null;
}

export async function findRunningPids(adapter, platform = process.platform, executablePath = null) {
  const config = adapter.platforms[platform];
  if (!config) return [];
  if (platform === "darwin") {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="]);
    const markers = [...(config.processMarkers ?? []), executablePath].filter(Boolean);
    return stdout.split(/\r?\n/).flatMap((line) => {
      const match = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (!match || !markers.some((marker) => match[2].includes(marker))) return [];
      return [Number(match[1])];
    });
  }
  if (platform === "win32") {
    const names = JSON.stringify([
      ...(config.processNames ?? []),
      ...(executablePath ? [path.win32.basename(executablePath)] : []),
    ]);
    const script = `$names = ConvertFrom-Json '${names.replaceAll("'", "''")}'; Get-Process | Where-Object { $names -contains ($_.Name + '.exe') -or $names -contains $_.Name } | Select-Object -ExpandProperty Id`;
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return stdout.split(/\r?\n/).map(Number).filter(Number.isInteger);
  }
  return [];
}

async function stopExisting(adapter, pids, platform = process.platform, executablePath = null) {
  const config = adapter.platforms[platform];
  if (platform === "darwin" && config.bundleId) {
    await execFileAsync("osascript", ["-e", `tell application id "${config.bundleId}" to quit`]).catch(() => {});
  } else if (platform === "win32" && pids.length) {
    const script = `Stop-Process -Id ${pids.join(",")} -Force -ErrorAction SilentlyContinue`;
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]).catch(() => {});
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await findRunningPids(adapter, platform, executablePath)).length) return;
    await delay(250);
  }
  if (platform !== "win32") {
    for (const pid of pids) {
      try { process.kill(pid, "SIGTERM"); } catch { /* Process already exited. */ }
    }
  }
}

export async function launchApp({ adapter, port = adapter.defaultPort, appPath = null, profilePath = null, restartExisting = false, timeoutMs = 30000 }) {
  try {
    const targets = await findTargets(adapter, port);
    if (targets.length) return { appId: adapter.id, port, alreadyReady: true, targets: targets.length };
  } catch { /* Launch when the endpoint is absent. */ }

  const discovered = await discoverApp(adapter, process.platform, appPath);
  if (!discovered) {
    if (appPath) {
      throw new Error(`${adapter.displayName} executable was not found from --app-path '${path.resolve(expandPath(appPath))}'.`);
    }
    throw new Error(`${adapter.displayName} is not installed or could not be discovered.`);
  }

  const runningPids = await findRunningPids(adapter, process.platform, discovered.executable);
  if (runningPids.length) {
    if (!restartExisting) {
      throw new Error(`${adapter.displayName} is already running without CodeDrobe on port ${port}. Close it or pass --restart-existing.`);
    }
    await stopExisting(adapter, runningPids, process.platform, discovered.executable);
  }

  const args = [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`];
  if (profilePath) {
    const resolved = path.resolve(profilePath);
    await fs.mkdir(resolved, { recursive: true });
    args.push(`--user-data-dir=${resolved}`);
  }
  const child = spawn(discovered.executable, args, { detached: true, stdio: "ignore" });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await findTargets(adapter, port);
      if (targets.length) {
        return { appId: adapter.id, port, executable: discovered.executable, pid: child.pid, targets: targets.length };
      }
    } catch { /* Wait for the CDP endpoint. */ }
    await delay(400);
  }
  throw new Error(`${adapter.displayName} did not expose a matching CDP target on port ${port}.`);
}
