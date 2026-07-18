import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { findTargets } from "./injector.mjs";

const execFileAsync = promisify(execFile);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function isPortOccupied(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (occupied) => {
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

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

function relativeExecutableNames(config) {
  const names = [];
  if (config.executableRelative) names.push(config.executableRelative);
  for (const candidate of config.executableCandidates ?? []) names.push(path.win32.basename(candidate));
  names.push(...(config.processNames ?? []));
  return [...new Set(names)];
}

async function queryRegistryValue(key, valueName) {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", key, "/v", valueName]);
    const pattern = new RegExp(`${valueName}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)`, "i");
    return pattern.exec(stdout)?.[1]?.trim().replace(/^"|"$/g, "") || null;
  } catch {
    return null;
  }
}

/**
 * Installers write their location to the registry uninstall keys, which is the
 * only reliable way to find installs on non-default drives or custom folders.
 */
async function discoverWindowsRegistry(adapter, config) {
  const executableNames = relativeExecutableNames(config);
  for (const keyName of config.uninstallKeys ?? []) {
    for (const hive of ["HKCU", "HKLM"]) {
      for (const view of ["", "\\WOW6432Node"]) {
        const key = `${hive}\\SOFTWARE${view}\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${keyName}`;
        const location = await queryRegistryValue(key, "InstallLocation");
        if (location) {
          for (const relative of executableNames) {
            const executable = path.win32.join(location, relative);
            if (await isExecutable(executable)) return { appId: adapter.id, appPath: location, executable };
          }
        }
        const icon = await queryRegistryValue(key, "DisplayIcon");
        if (icon) {
          const executable = icon.split(",")[0].trim();
          if (/\.exe$/i.test(executable) && await isExecutable(executable)) {
            return { appId: adapter.id, appPath: path.win32.dirname(executable), executable };
          }
        }
      }
    }
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
  return discoverWindowsRegistry(adapter, config);
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
    // tasklist is an order of magnitude faster than spawning PowerShell, which
    // matters because restart flows poll this while waiting for processes to die.
    const withExe = (name) => (/\.exe$/i.test(name) ? name : `${name}.exe`).toLowerCase();
    const names = new Set([
      ...(config.processNames ?? []),
      ...(executablePath ? [path.win32.basename(executablePath)] : []),
    ].map(withExe));
    if (!names.size) return [];
    const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"]);
    return stdout.split(/\r?\n/).flatMap((line) => {
      const match = /^"([^"]+)","(\d+)"/.exec(line);
      if (!match || !names.has(match[1].toLowerCase())) return [];
      return [Number(match[2])];
    });
  }
  return [];
}

async function stopExisting(adapter, pids, platform = process.platform, executablePath = null) {
  const config = adapter.platforms[platform];
  if (platform === "darwin" && config.bundleId) {
    await execFileAsync("osascript", ["-e", `tell application id "${config.bundleId}" to quit`]).catch(() => {});
  } else if (platform === "win32" && pids.length) {
    // /T also stops child process trees (gpu/network/renderer helpers) so the
    // CDP port is actually released before relaunching.
    await execFileAsync("taskkill.exe", ["/F", "/T", ...pids.flatMap((pid) => ["/PID", String(pid)])]).catch(() => {});
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
  let readyTargets = [];
  try {
    readyTargets = await findTargets(adapter, port);
    if (readyTargets.length && !restartExisting) {
      return { appId: adapter.id, port, alreadyReady: true, targets: readyTargets.length };
    }
  } catch { /* Launch when the endpoint is absent. */ }

  if (!readyTargets.length && await isPortOccupied(port)) {
    const error = new Error(`Port ${port} is already occupied by another process.`);
    error.code = "CODEDROBE_PORT_OCCUPIED";
    error.port = port;
    throw error;
  }

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
      const error = new Error(`${adapter.displayName} is already running without CodeDrobe on port ${port}. Close it or pass --restart-existing.`);
      error.code = "CODEDROBE_RESTART_REQUIRED";
      error.appId = adapter.id;
      error.port = port;
      throw error;
    }
    await stopExisting(adapter, runningPids, process.platform, discovered.executable);
  }

  // The OS can take a moment to release the listener after the process dies.
  const releaseDeadline = Date.now() + 3000;
  let portStillOccupied = await isPortOccupied(port);
  while (portStillOccupied && Date.now() < releaseDeadline) {
    await delay(250);
    portStillOccupied = await isPortOccupied(port);
  }
  if (portStillOccupied) {
    const error = new Error(`Port ${port} is still occupied after stopping ${adapter.displayName}.`);
    error.code = "CODEDROBE_PORT_OCCUPIED";
    error.port = port;
    throw error;
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
