import fs from "node:fs/promises";
import path from "node:path";
import { getAdapter, listAdapters } from "./adapters/index.mjs";
import { discoverApp, findRunningPids, launchApp, resolveDebugPorts } from "./runtime/launcher.mjs";
import { DOM_SNAPSHOT_DEFAULT_MAX_NODES, DOM_SNAPSHOT_MAX_NODES } from "./runtime/dom-snapshot.mjs";
import { captureScreenshot, findTargets, probeApp, snapshotDom, verifyTheme, watchTheme } from "./runtime/injector.mjs";
import { applySkin, restoreSkin } from "./runtime/skin.mjs";
import { lintThemePackage, readThemePackage, resolveThemeTarget, writeThemePackage } from "./theme/package.mjs";
import { publishThemePackage } from "./theme/publish.mjs";
import { downloadTheme, searchThemes } from "./theme/store.mjs";
import { convertLegacyThemeFile } from "./theme/legacy.mjs";
import { checkForUpdate, detectPackageManager, formatCommand, getUpdateCommand, maybeNotifyUpdate, updateCodeDrobe } from "./update.mjs";
import { runAuthCommand } from "./auth/commands.mjs";
import { VERSION } from "./version.mjs";

const TAGLINE = "CodeDrobe multi-app theming CLI";

// Structured command registry: the single source of truth for both the general
// help screen and per-command help (codedrobe <command> --help).
const COMMAND_GROUPS = [
  {
    title: "Apps",
    commands: [
      { id: "apps", usage: "apps [--json]", summary: "List supported apps and their default CDP ports." },
      { id: "detect", usage: "detect [--app <id>] [--app-path <path>] [--json]", summary: "Locate installed apps and whether they are running." },
      { id: "launch", usage: "launch --app <id> [--app-path <path>] [--port <port>] [--restart-existing] [--profile <path>]", summary: "Launch an app with the CDP debugging endpoint enabled." },
    ],
  },
  {
    title: "Theme runtime",
    commands: [
      {
        id: "apply",
        usage: "apply --app <id> --theme <file.codedrobe-theme> [--app-path <path>] [--port <port>] [--profile <path>] [--watch] [--restart-existing] [--no-launch]",
        summary: "Apply a theme to an app, launching it if needed.",
        examples: ["codedrobe apply --app codex --theme dream.codedrobe-theme"],
      },
      { id: "restore", usage: "restore --app <id> [--port <port>]", summary: "Remove CodeDrobe theming and restore the native look. Alias: remove." },
      { id: "verify", usage: "verify --app <id> [--theme <file.codedrobe-theme>] [--port <port>] [--screenshot <png>]", summary: "Check whether a theme is correctly applied." },
      { id: "probe", usage: "probe --app <id> [--theme <file.codedrobe-theme>] [--port <port>] [--timeout-ms <milliseconds>]", summary: "Inspect a running app's DOM compatibility without mutating it." },
      { id: "dom snapshot", usage: "dom snapshot --app <id> [--port <port>] [--output <json>] [--max-nodes <count>] [--include-hidden] [--timeout-ms <milliseconds>]", summary: "Capture a privacy-preserving DOM structure snapshot." },
    ],
  },
  {
    title: "Theme packages",
    commands: [
      { id: "theme inspect", usage: "theme inspect <file.codedrobe-theme>", summary: "Print package metadata and lint warnings." },
      { id: "theme pack", usage: "theme pack <manifest.json> --output <file.codedrobe-theme> [--force]", summary: "Pack a theme.json project into a portable package." },
      { id: "theme convert", usage: "theme convert <file.codex-theme> --output <file.codedrobe-theme> [--force]", summary: "Convert a legacy .codex-theme file into the new format." },
      {
        id: "theme publish",
        usage: "theme publish <file.codedrobe-theme> [--submit] [--slug <slug>] [--json]",
        summary: "Publish a package to the CodeDrobe store (requires sign-in).",
        examples: [
          "codedrobe theme pack theme.json --output dream.codedrobe-theme",
          "codedrobe theme publish dream.codedrobe-theme --submit",
        ],
      },
      {
        id: "theme search",
        usage: "theme search [query] [--app <id>] [--category <slug>] [--limit <count>] [--json]",
        summary: "Search the CodeDrobe store catalog.",
        examples: ["codedrobe theme search 复古 --app codex"],
      },
      {
        id: "theme download",
        usage: "theme download <slug> [--output <file.codedrobe-theme>] [--force] [--json]",
        summary: "Download a store theme (to ~/.codedrobe/themes by default) with size and SHA-256 verification.",
        examples: [
          "codedrobe theme download qq-2007",
          "codedrobe apply --app codex --theme ~/.codedrobe/themes/qq-2007-0.1.1.codedrobe-theme",
        ],
      },
    ],
  },
  {
    title: "Account",
    commands: [
      { id: "auth login", usage: "auth login [--scopes <s1,s2>] [--no-open] [--json]", summary: "Sign in via device authorization." },
      { id: "auth status", usage: "auth status [--json]", summary: "Show the current sign-in state." },
      { id: "auth logout", usage: "auth logout [--json]", summary: "Sign out and clear stored credentials." },
    ],
  },
  {
    title: "Maintenance",
    commands: [
      { id: "update", usage: "update [--check] [--json]", summary: "Update the CodeDrobe CLI to the latest version." },
    ],
  },
];

const GLOBAL_OPTIONS = [
  { flag: "-h, --help", summary: "Show help. Append to any command for command-specific help." },
  { flag: "-v, --version", summary: "Print the CLI version." },
  { flag: "--json", summary: "Emit machine-readable JSON (on commands that support it)." },
];

const EXAMPLES = [
  "codedrobe apply --app codex --theme dream.codedrobe-theme",
  "codedrobe theme pack theme.json --output dream.codedrobe-theme",
  "codedrobe theme publish dream.codedrobe-theme --submit",
  "codedrobe restore --app codex",
];

const ENVIRONMENT = [
  { name: "CODEDROBE_API_BASE", summary: "Target a non-production CodeDrobe deployment (default https://codedrobe.app)." },
  { name: "CODEDROBE_CREDENTIALS_FILE", summary: "Override the credentials path (default ~/.codedrobe/credentials.json, 0600)." },
];

const SAFETY = [
  "Existing apps are never restarted unless --restart-existing is provided.",
  "CDP is always bound to 127.0.0.1 by the launcher.",
  "DOM snapshots exclude text, input values, accessible names, links, and media sources.",
  "--app-path accepts an app bundle, installation directory, or executable file.",
  "Auth stores a rotating refresh token in ~/.codedrobe/credentials.json (0600).",
];

function flatCommands() {
  return COMMAND_GROUPS.flatMap((group) => group.commands);
}

const TOP_LEVEL_COMMANDS = new Set([
  ...flatCommands().map((command) => command.id.split(" ")[0]),
  "remove", "help", "version",
]);

function padColumn(rows) {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
}

function renderGeneralHelp() {
  const lines = [TAGLINE, "", "Usage:", "  codedrobe <command> [options]", ""];
  for (const group of COMMAND_GROUPS) {
    lines.push(`${group.title}:`);
    lines.push(...padColumn(group.commands.map((command) => [command.id, command.summary])));
    lines.push("");
  }
  lines.push("Global options:");
  lines.push(...padColumn(GLOBAL_OPTIONS.map((option) => [option.flag, option.summary])));
  lines.push("", "Examples:");
  lines.push(...EXAMPLES.map((example) => `  ${example}`));
  lines.push("", "Environment:");
  lines.push(...padColumn(ENVIRONMENT.map((variable) => [variable.name, variable.summary])));
  lines.push("", "Safety:");
  lines.push(...SAFETY.map((note) => `  ${note}`));
  return lines.join("\n");
}

function renderCommandHelp(command) {
  const lines = [command.summary, "", "Usage:", `  codedrobe ${command.usage}`];
  if (command.examples?.length) {
    lines.push("", "Examples:");
    lines.push(...command.examples.map((example) => `  ${example}`));
  }
  return lines.join("\n");
}

function renderGroupHelp(name, commands) {
  const lines = [`codedrobe ${name} commands`, "", "Usage:"];
  lines.push(...commands.map((command) => `  codedrobe ${command.usage}`));
  return lines.join("\n");
}

/** Resolve `codedrobe <tokens> --help` to focused help, or null for the general screen. */
function helpForTokens(tokens) {
  if (!tokens.length) return null;
  const commands = flatCommands();
  const twoWord = tokens.slice(0, 2).join(" ");
  const oneWord = tokens[0];
  const exact = commands.find((command) => command.id === twoWord)
    ?? commands.find((command) => command.id === oneWord);
  if (exact) return renderCommandHelp(exact);
  const group = commands.filter((command) => command.id === oneWord || command.id.startsWith(`${oneWord} `));
  if (group.length) return renderGroupHelp(oneWord, group);
  return null;
}

const HELP = renderGeneralHelp();

function parseArguments(argv) {
  const options = {};
  const positional = [];
  const boolean = new Set(["json", "watch", "restart-existing", "no-launch", "force", "check", "help", "version", "include-hidden", "no-open", "submit"]);
  const shortFlags = { "-h": "help", "-v": "version" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (shortFlags[value]) {
      options[shortFlags[value]] = true;
      continue;
    }
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

/**
 * Hosts that force an ephemeral debug port publish the live port through
 * DevToolsActivePort. An explicit --port always wins; a file port is only
 * trusted while it serves targets matching the adapter, because the files
 * outlive the processes that wrote them.
 */
async function resolveSessionPort(options, adapter) {
  if (options.port !== undefined) return parsePort(options.port, adapter.defaultPort);
  for (const filePort of await resolveDebugPorts(adapter, process.platform)) {
    try {
      if ((await findTargets(adapter, filePort)).length) return filePort;
    } catch { /* Try the next candidate, then the adapter default port. */ }
  }
  return adapter.defaultPort;
}

function parseTimeout(value, fallback) {
  const timeoutMs = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 300000) {
    throw new Error(`Invalid timeout '${value}'. Use an integer from 250 to 300000 milliseconds.`);
  }
  return timeoutMs;
}

function parseMaxNodes(value) {
  const maxNodes = value === undefined ? DOM_SNAPSHOT_DEFAULT_MAX_NODES : Number(value);
  if (!Number.isInteger(maxNodes) || maxNodes < 50 || maxNodes > DOM_SNAPSHOT_MAX_NODES) {
    throw new Error(`Invalid max nodes '${value}'. Use an integer from 50 to ${DOM_SNAPSHOT_MAX_NODES}.`);
  }
  return maxNodes;
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
  const port = await resolveSessionPort(options, adapter);
  const { targetTheme } = await loadTargetTheme(requireOption(options, "theme"), adapter.id);
  const result = await applySkin({
    adapter,
    targetTheme,
    port,
    launch: !options["no-launch"],
    appPath: options["app-path"],
    profilePath: options.profile,
    restartExisting: Boolean(options["restart-existing"]),
  });
  output(result, options.json);
  if (options.watch) {
    await watchTheme({
      adapter,
      targetTheme,
      // Follow the port the skin actually applied on: launch may have found
      // the app on a host-chosen debug port instead of the requested one.
      port: result.port ?? port,
      onEvent: (event) => output(event, options.json),
    });
  }
}

async function runProbe(options) {
  const adapter = getAdapter(requireOption(options, "app"));
  const port = await resolveSessionPort(options, adapter);
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

async function runDomCommand(positional, options) {
  if (positional[1] !== "snapshot") throw new Error("DOM command must be 'snapshot'.");
  const adapter = getAdapter(requireOption(options, "app"));
  const port = await resolveSessionPort(options, adapter);
  const timeoutMs = parseTimeout(options["timeout-ms"], 5000);
  const maxNodes = parseMaxNodes(options["max-nodes"]);
  if (!options.json) {
    console.error(`[codedrobe] Reading ${adapter.displayName} DOM on 127.0.0.1:${port} (timeout ${timeoutMs}ms). Snapshot does not launch or mutate the app.`);
  }
  let targets;
  try {
    targets = await snapshotDom({
      adapter,
      port,
      timeoutMs,
      maxNodes,
      includeHidden: Boolean(options["include-hidden"]),
    });
  } catch (cause) {
    const error = new Error(`${cause.message}\nDOM snapshot only inspects an existing CDP session. Start it first with: codedrobe launch --app ${adapter.id} --port ${port}`);
    error.code = cause.code;
    error.cause = cause;
    throw error;
  }
  const result = {
    action: "dom-snapshot",
    appId: adapter.id,
    port,
    targets,
  };
  if (!options.output) {
    output(result, true);
    return;
  }
  const filename = path.resolve(options.output);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const nodeCount = targets.reduce((sum, item) => sum + (item.result?.nodes?.length ?? 0), 0);
  const truncated = targets.some((item) => item.result?.summary?.truncated);
  output(options.json ? { ...result, output: filename } : {
    action: result.action,
    appId: result.appId,
    port,
    output: filename,
    targetCount: targets.length,
    nodeCount,
    truncated,
  }, options.json);
}

async function runVerify(options) {
  const adapter = getAdapter(requireOption(options, "app"));
  const port = await resolveSessionPort(options, adapter);
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
    const imageNames = Object.keys(bundle.assets?.images ?? {});
    if (bundle.assets?.art && !imageNames.includes("hero")) imageNames.unshift("hero");
    output({
      format: bundle.format,
      schemaVersion: bundle.schemaVersion,
      theme: bundle.theme,
      targets: Object.keys(bundle.targets),
      images: imageNames,
      imageCount: imageNames.length,
      hasArt: imageNames.includes("hero"),
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
  if (action === "publish") {
    if (!filename) throw new Error("Theme publish requires a .codedrobe-theme file.");
    if (!options.json) {
      console.error(`[codedrobe] Publishing ${path.basename(filename)} to the CodeDrobe store…`);
    }
    const result = await publishThemePackage({
      filename,
      submit: Boolean(options.submit),
      slug: options.slug ?? null,
    });
    output(options.json ? { action: "theme-publish", ...result } : {
      action: "theme-publish",
      result: result.action,
      theme: { id: result.theme?.id ?? null, slug: result.theme?.slug ?? null, status: result.theme?.status ?? null },
      version: { id: result.version?.id ?? null, version: result.version?.version ?? null, status: result.version?.status ?? null },
      review: result.review,
      categories: result.categories,
      warnings: result.warnings,
      storeUrl: result.storeUrl,
    }, options.json);
    return;
  }
  if (action === "search") {
    const result = await searchThemes({
      query: filename ?? "",
      appId: options.app ?? null,
      category: options.category ?? null,
      limit: options.limit === undefined ? 20 : Number(options.limit),
    });
    if (options.json) {
      output({ action: "theme-search", ...result }, true);
      return;
    }
    if (!result.themes.length) {
      output("No themes matched.");
      return;
    }
    const lines = result.themes.map((theme) => {
      const name = theme.name?.zh || theme.name?.en || theme.slug;
      const categories = theme.categories.length ? ` [${theme.categories.join(", ")}]` : "";
      const author = theme.author ? ` by ${theme.author}` : "";
      return `${theme.slug} — ${name}${theme.version ? ` (v${theme.version})` : ""}${categories}${author}`;
    });
    output(`${lines.join("\n")}\n\nShowing ${result.themes.length} of ${result.total}. Install with: codedrobe theme download <slug>`);
    return;
  }
  if (action === "download") {
    if (!filename) throw new Error("Theme download requires a store theme slug.");
    const result = await downloadTheme({
      slug: filename,
      output: options.output ?? null,
      force: Boolean(options.force),
    });
    output(options.json ? { action: "theme-download", ...result } : {
      action: "theme-download",
      ...result,
      next: `codedrobe apply --app <app-id> --theme ${result.output}`,
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
  throw new Error("Theme command must be 'inspect', 'pack', 'convert', 'publish', 'search', or 'download'.");
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
  // `--help`/`-h` after a command, or `help <command>`, shows focused help.
  if (options.help) {
    output((command && helpForTokens(positional)) || HELP);
    return;
  }
  if (!command || command === "help") {
    output(helpForTokens(positional.slice(1)) || HELP);
    return;
  }
  if (!TOP_LEVEL_COMMANDS.has(command)) {
    throw new Error(`Unknown command '${command}'. Run 'codedrobe --help' to list commands.`);
  }
  if (command === "apps") {
    output(listAdapters().map(summarizeAdapter), options.json);
    return;
  }
  if (command === "detect") return runDetect(options);
  if (command === "dom") return runDomCommand(positional, options);
  if (command === "theme") return runThemeCommand(positional, options);
  if (command === "update") return runUpdate(options);
  if (command === "auth") return runAuthCommand(positional.slice(1), options);

  const adapter = getAdapter(requireOption(options, "app"));
  if (command === "launch") {
    // launchApp resolves host-published debug ports itself, so only the
    // explicit request is forwarded here.
    const result = await launchApp({
      adapter,
      port: parsePort(options.port, adapter.defaultPort),
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
    output(await restoreSkin({ adapter, port: await resolveSessionPort(options, adapter) }), options.json);
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

/** Resolve focused help text for a command, e.g. commandHelp(["theme", "publish"]). */
export function commandHelp(tokens) {
  return helpForTokens(tokens);
}

export { HELP };
