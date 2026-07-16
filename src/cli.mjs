import path from "node:path";
import { getAdapter, listAdapters } from "./adapters/index.mjs";
import { discoverApp, findRunningPids, launchApp } from "./runtime/launcher.mjs";
import { applyTheme, captureScreenshot, probeApp, removeTheme, verifyTheme, watchTheme } from "./runtime/injector.mjs";
import { lintThemePackage, readThemePackage, resolveThemeTarget, writeThemePackage } from "./theme/package.mjs";
import { convertLegacyThemeFile } from "./theme/legacy.mjs";
import { checkForUpdate, detectPackageManager, formatCommand, getUpdateCommand, maybeNotifyUpdate, updateCodeDrobe } from "./update.mjs";
import { VERSION } from "./version.mjs";

const HELP = `CodeDrobe multi-app theming CLI

Usage:
  codedrobe apps [--json]
  codedrobe detect [--app <id>] [--app-path <path>] [--json]
  codedrobe launch --app <id> [--app-path <path>] [--port <port>] [--restart-existing] [--profile <path>]
  codedrobe probe --app <id> [--theme <file.codedrobe-theme>] [--port <port>] [--timeout-ms <milliseconds>]
  codedrobe apply --app <id> --theme <file.codedrobe-theme> [--app-path <path>] [--port <port>] [--watch] [--restart-existing]
  codedrobe verify --app <id> [--theme <file.codedrobe-theme>] [--port <port>] [--screenshot <png>]
  codedrobe restore --app <id> [--port <port>]
  codedrobe update [--check] [--json]
  codedrobe theme inspect <file.codedrobe-theme>
  codedrobe theme pack <manifest.json> --output <file.codedrobe-theme> [--force]
  codedrobe theme convert <file.codex-theme> --output <file.codedrobe-theme> [--force]

Safety:
  Existing apps are never restarted unless --restart-existing is provided.
  CDP is always bound to 127.0.0.1 by the launcher.
  --app-path accepts an app bundle, installation directory, or executable file.`;

function parseArguments(argv) {
  const options = {};
  const positional = [];
  const boolean = new Set(["json", "watch", "restart-existing", "no-launch", "force", "check", "help", "version"]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (boolean.has(key)) options[key] = true;
    else {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error(`Option --${key} requires a value.`);
      options[key] = next;
    }
  }
  return { positional, options };
}

function output(value, json = false) {
  if (json || typeof value !== "string") console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}

function parsePort(value, fallback) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid port '${value}'.`);
  return port;
}

function parseTimeout(value, fallback) {
  const timeoutMs = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 300000) {
    throw new Error(`Invalid timeout '${value}'. Use an integer from 250 to 300000 milliseconds.`);
  }
  return timeoutMs;
}

function requireOption(options, name) {
  if (!options[name]) throw new Error(`Missing required option --${name}.`);
  return options[name];
}

function summarizeAdapter(adapter) {
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    defaultPort: adapter.defaultPort,
    platforms: Object.keys(adapter.platforms),
    lastVerified: adapter.lastVerified ?? {},
  };
}

function ensurePassing(results, action) {
  const failures = results.filter((item) => item.result?.pass === false);
  if (failures.length) {
    const missing = failures.flatMap((item) => item.result?.missing ?? []);
    const detail = missing
      .map((item) => `${item.scope}${item.context ? `:${item.context}` : ""}:${item.name} (${item.selectors.join(" | ")})`)
      .join("; ");
    const error = new Error(`${action} verification failed for ${failures.length} renderer target(s)${detail ? `: ${detail}` : "."}`);
    error.code = "CODEDROBE_VERIFY_FAILED";
    error.missing = missing;
    error.results = results;
    throw error;
  }
}

function ensureCompatible(results, action) {
  const failures = results.filter((item) => item.result?.compatible === false);
  if (!failures.length) return;
  const missing = failures.flatMap((item) => item.result?.missing ?? []);
  const detail = missing
    .map((item) => `${item.scope}${item.context ? `:${item.context}` : ""}:${item.name} (${item.selectors.join(" | ")})`)
    .join("; ");
  const error = new Error(`${action} DOM preflight failed for ${failures.length} renderer target(s)${detail ? `: ${detail}` : "."}`);
  error.code = "CODEDROBE_DOM_INCOMPATIBLE";
  error.missing = missing;
  error.results = results;
  throw error;
}

async function runDetect(options) {
  if (options["app-path"] && !options.app) throw new Error("Option --app-path requires --app.");
  const selected = options.app ? [getAdapter(options.app)] : listAdapters();
  const results = [];
  for (const adapter of selected) {
    const installation = await discoverApp(adapter, process.platform, options["app-path"]);
    const runningPids = await findRunningPids(adapter, process.platform, installation?.executable).catch(() => []);
    results.push({
      ...summarizeAdapter(adapter),
      installed: Boolean(installation),
      appPath: installation?.appPath ?? null,
      executable: installation?.executable ?? null,
      running: runningPids.length > 0,
      runningProcessCount: runningPids.length,
    });
  }
  output(options.app ? results[0] : results, options.json);
}

async function loadTargetTheme(themeFilename, appId) {
  const bundle = await readThemePackage(path.resolve(themeFilename));
  return { bundle, targetTheme: resolveThemeTarget(bundle, appId) };
}

async function runApply(options) {
  const adapter = getAdapter(requireOption(options, "app"));
  const port = parsePort(options.port, adapter.defaultPort);
  const { targetTheme } = await loadTargetTheme(requireOption(options, "theme"), adapter.id);
  if (!options["no-launch"]) {
    await launchApp({
      adapter,
      port,
      appPath: options["app-path"],
      profilePath: options.profile,
      restartExisting: Boolean(options["restart-existing"]),
    });
  }
  const results = await applyTheme({ adapter, targetTheme, port });
  output({ action: "apply", appId: adapter.id, port, theme: targetTheme.theme, targets: results }, options.json);
  ensurePassing(results, "Theme application");
  if (options.watch) {
    await watchTheme({
      adapter,
      targetTheme,
      port,
      onEvent: (event) => output(event, options.json),
    });
  }
}

async function runProbe(options) {
  const adapter = getAdapter(requireOption(options, "app"));
  const port = parsePort(options.port, adapter.defaultPort);
  const timeoutMs = parseTimeout(options["timeout-ms"], 5000);
  const targetTheme = options.theme ? (await loadTargetTheme(options.theme, adapter.id)).targetTheme : null;
  if (!options.json) {
    console.error(`[codedrobe] Probing ${adapter.displayName} on 127.0.0.1:${port} (timeout ${timeoutMs}ms). Probe does not launch the app.`);
  }
  let results;
  try {
    results = await probeApp({ adapter, targetTheme, port, timeoutMs });
  } catch (cause) {
    const error = new Error(`${cause.message}\nProbe only inspects an existing CDP session. Start it first with: codedrobe launch --app ${adapter.id} --port ${port}`);
    error.code = cause.code;
    error.cause = cause;
    throw error;
  }
  output({ action: "probe", appId: adapter.id, port, theme: targetTheme?.theme ?? null, targets: results }, options.json);
  ensureCompatible(results, `${adapter.displayName}`);
}

async function runVerify(options) {
  const adapter = getAdapter(requireOption(options, "app"));
  const port = parsePort(options.port, adapter.defaultPort);
  const targetTheme = options.theme ? (await loadTargetTheme(options.theme, adapter.id)).targetTheme : null;
  const results = await verifyTheme({ adapter, targetTheme, port });
  const screenshot = options.screenshot
    ? await captureScreenshot({ adapter, port, output: options.screenshot })
    : null;
  output({ action: "verify", appId: adapter.id, port, screenshot, targets: results }, options.json);
  ensurePassing(results, "Theme");
}

async function runThemeCommand(positional, options) {
  const action = positional[1];
  const filename = positional[2];
  if (action === "inspect") {
    if (!filename) throw new Error("Theme inspect requires a .codedrobe-theme file.");
    const bundle = await readThemePackage(path.resolve(filename));
    output({
      format: bundle.format,
      schemaVersion: bundle.schemaVersion,
      theme: bundle.theme,
      targets: Object.keys(bundle.targets),
      hasArt: Boolean(bundle.assets?.art),
      exportedAt: bundle.exportedAt,
      warnings: lintThemePackage(bundle),
    }, options.json);
    return;
  }
  if (action === "pack") {
    if (!filename) throw new Error("Theme pack requires a source manifest JSON file.");
    const outputFilename = requireOption(options, "output");
    const result = await writeThemePackage(filename, outputFilename, { force: Boolean(options.force) });
    output({
      action: "theme-pack",
      output: result.output,
      theme: result.bundle.theme,
      targets: Object.keys(result.bundle.targets),
      warnings: lintThemePackage(result.bundle),
    }, options.json);
    return;
  }
  if (action === "convert") {
    if (!filename) throw new Error("Theme convert requires a legacy .codex-theme file.");
    const outputFilename = requireOption(options, "output");
    const result = await convertLegacyThemeFile(filename, outputFilename, { force: Boolean(options.force) });
    output({
      action: "theme-convert",
      input: result.input,
      output: result.output,
      theme: result.bundle.theme,
      targets: Object.keys(result.bundle.targets),
      warnings: lintThemePackage(result.bundle),
    }, options.json);
    return;
  }
  throw new Error("Theme command must be 'inspect', 'pack', or 'convert'.");
}

function formatUpdateStatus(status, command) {
  if (!status.updateAvailable) return `CodeDrobe ${status.current} is up to date.`;
  return `CodeDrobe ${status.latest} is available (current: ${status.current}).\nRun: ${command}`;
}

async function runUpdate(options) {
  const packageManager = detectPackageManager();
  const updateCommand = formatCommand(getUpdateCommand(packageManager));
  if (options.check) {
    const status = await checkForUpdate({ force: true, timeoutMs: 10_000 });
    output(options.json ? { action: "update-check", ...status, packageManager, command: updateCommand } : formatUpdateStatus(status, updateCommand), options.json);
    return;
  }
  const result = await updateCodeDrobe({ packageManager, quiet: Boolean(options.json), checkOptions: { timeoutMs: 10_000 } });
  if (options.json) {
    output({ action: "update", ...result }, true);
    return;
  }
  if (!result.updated) output(`CodeDrobe ${result.current} is already up to date.`);
  else output(`Installed CodeDrobe ${result.latest} globally with ${result.packageManager}. Restart codedrobe to use the new version.`);
}

async function dispatchCli(positional, options) {
  const command = positional[0];
  if (command === "version" || options.version) {
    output(VERSION);
    return;
  }
  if (!command || command === "help" || options.help) {
    output(HELP);
    return;
  }
  if (command === "apps") {
    output(listAdapters().map(summarizeAdapter), options.json);
    return;
  }
  if (command === "detect") return runDetect(options);
  if (command === "theme") return runThemeCommand(positional, options);
  if (command === "update") return runUpdate(options);

  const adapter = getAdapter(requireOption(options, "app"));
  const port = parsePort(options.port, adapter.defaultPort);
  if (command === "launch") {
    const result = await launchApp({
      adapter,
      port,
      appPath: options["app-path"],
      profilePath: options.profile,
      restartExisting: Boolean(options["restart-existing"]),
    });
    output(result, options.json);
    return;
  }
  if (command === "probe") return runProbe(options);
  if (command === "apply") return runApply(options);
  if (command === "verify") return runVerify(options);
  if (command === "restore" || command === "remove") {
    const results = await removeTheme({ adapter, port });
    output({ action: "restore", appId: adapter.id, port, targets: results }, options.json);
    return;
  }
  throw new Error(`Unknown command '${command}'. Run 'codedrobe help'.`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const { positional, options } = parseArguments(argv);
  await dispatchCli(positional, options);
  const command = positional[0] || (options.version ? "version" : "help");
  await maybeNotifyUpdate({ command, json: Boolean(options.json) });
}

export { HELP };
