import path from "node:path";
import { getAdapter, listAdapters } from "./adapters/index.mjs";
import { discoverApp, findRunningPids, launchApp } from "./runtime/launcher.mjs";
import { applyTheme, captureScreenshot, removeTheme, verifyTheme, watchTheme } from "./runtime/injector.mjs";
import { readThemePackage, resolveThemeTarget, writeThemePackage } from "./theme/package.mjs";
import { VERSION } from "./version.mjs";

const HELP = `CodeDrobe multi-app theming CLI

Usage:
  codedrobe apps [--json]
  codedrobe detect [--app <id>] [--json]
  codedrobe launch --app <id> [--port <port>] [--restart-existing] [--profile <path>]
  codedrobe apply --app <id> --theme <file.codedrobe-theme> [--port <port>] [--watch] [--restart-existing]
  codedrobe verify --app <id> [--theme <file.codedrobe-theme>] [--port <port>] [--screenshot <png>]
  codedrobe restore --app <id> [--port <port>]
  codedrobe theme inspect <file.codedrobe-theme>
  codedrobe theme pack <manifest.json> --output <file.codedrobe-theme> [--force]

Safety:
  Existing apps are never restarted unless --restart-existing is provided.
  CDP is always bound to 127.0.0.1 by the launcher.`;

function parseArguments(argv) {
  const options = {};
  const positional = [];
  const boolean = new Set(["json", "watch", "restart-existing", "no-launch", "force", "help", "version"]);
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
  };
}

function ensurePassing(results, action) {
  const failures = results.filter((item) => item.result?.pass === false);
  if (failures.length) {
    const error = new Error(`${action} verification failed for ${failures.length} renderer target(s).`);
    error.results = results;
    throw error;
  }
}

async function runDetect(options) {
  const selected = options.app ? [getAdapter(options.app)] : listAdapters();
  const results = [];
  for (const adapter of selected) {
    const [installation, runningPids] = await Promise.all([
      discoverApp(adapter),
      findRunningPids(adapter).catch(() => []),
    ]);
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
    }, options.json);
    return;
  }
  if (action === "pack") {
    if (!filename) throw new Error("Theme pack requires a source manifest JSON file.");
    const outputFilename = requireOption(options, "output");
    const result = await writeThemePackage(filename, outputFilename, { force: Boolean(options.force) });
    output({ action: "theme-pack", output: result.output, theme: result.bundle.theme, targets: Object.keys(result.bundle.targets) }, options.json);
    return;
  }
  throw new Error("Theme command must be 'inspect' or 'pack'.");
}

export async function runCli(argv = process.argv.slice(2)) {
  const { positional, options } = parseArguments(argv);
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

  const adapter = getAdapter(requireOption(options, "app"));
  const port = parsePort(options.port, adapter.defaultPort);
  if (command === "launch") {
    const result = await launchApp({
      adapter,
      port,
      profilePath: options.profile,
      restartExisting: Boolean(options["restart-existing"]),
    });
    output(result, options.json);
    return;
  }
  if (command === "apply") return runApply(options);
  if (command === "verify") return runVerify(options);
  if (command === "restore" || command === "remove") {
    const results = await removeTheme({ adapter, port });
    output({ action: "restore", appId: adapter.id, port, targets: results }, options.json);
    return;
  }
  throw new Error(`Unknown command '${command}'. Run 'codedrobe help'.`);
}

export { HELP };
