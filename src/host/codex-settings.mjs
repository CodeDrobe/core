import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CODEX_MANAGED_SETTINGS = [
  "appearanceTheme",
  "appearanceLightCodeThemeId",
  "appearanceLightChromeTheme",
];

function tomlString(value) {
  return JSON.stringify(String(value));
}

export function buildCodexBaseThemeSettings(baseTheme = {}, platform = process.platform) {
  const fonts = baseTheme.fonts && typeof baseTheme.fonts === "object" ? baseTheme.fonts : {};
  const semantic = baseTheme.semanticColors && typeof baseTheme.semanticColors === "object"
    ? baseTheme.semanticColors
    : {};
  const isMac = platform === "darwin";
  const codeFont = isMac ? fonts.macCode : fonts.windowsCode;
  const uiFont = isMac ? fonts.macUi : fonts.windowsUi;
  const chromeParts = [
    `accent = ${tomlString(baseTheme.accent ?? "#B65CFF")}`,
    `contrast = ${Number.isFinite(baseTheme.contrast) ? baseTheme.contrast : 64}`,
    `fonts = { code = ${tomlString(codeFont ?? (isMac ? "SF Mono" : "Cascadia Code"))}, ui = ${tomlString(uiFont ?? (isMac ? "PingFang SC" : "Microsoft YaHei UI"))} }`,
    `ink = ${tomlString(baseTheme.ink ?? "#4A235F")}`,
    `opaqueWindows = ${baseTheme.opaqueWindows === false ? "false" : "true"}`,
    `semanticColors = { diffAdded = ${tomlString(semantic.diffAdded ?? "#BCE8CF")}, diffRemoved = ${tomlString(semantic.diffRemoved ?? "#F7B8CE")}, skill = ${tomlString(semantic.skill ?? "#C47BFF")} }`,
    `surface = ${tomlString(baseTheme.surface ?? "#FFF4FA")}`,
  ];
  return {
    appearanceTheme: `appearanceTheme = ${tomlString(baseTheme.mode ?? "light")}`,
    appearanceLightCodeThemeId: `appearanceLightCodeThemeId = ${tomlString(baseTheme.codeTheme ?? "codex")}`,
    appearanceLightChromeTheme: `appearanceLightChromeTheme = { ${chromeParts.join(", ")} }`,
  };
}

function desktopSection(content) {
  const match = /^\[desktop\]\s*\r?\n(?<body>.*?)(?=^\[|(?![\s\S]))/ms.exec(content);
  if (match) return { content, match };
  const next = `${content.trimEnd()}\n\n[desktop]\n`;
  return { content: next, match: /^\[desktop\]\s*\r?\n(?<body>.*?)(?=^\[|(?![\s\S]))/ms.exec(next) };
}

function replaceSectionBody(content, match, body) {
  const index = match.index + match[0].length - match.groups.body.length;
  return content.slice(0, index) + body + content.slice(index + match.groups.body.length);
}

function settingPattern(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\s*=.*(?:\\r?\\n|$)`, "gm");
}

function replaceUniqueSetting(body, key, line) {
  const withoutDuplicates = body.replace(settingPattern(key), "").trimEnd();
  return `${withoutDuplicates}${withoutDuplicates ? "\n" : ""}${line}\n`;
}

function managedChromeTablePattern() {
  return /^\[desktop\.appearanceLightChromeTheme(?:\.[^\]]+)?\]\s*\r?\n.*?(?=^\[|(?![\s\S]))/gms;
}

function removeManagedChromeTables(content) {
  return content.replace(managedChromeTablePattern(), "");
}

function extractManagedChromeTables(content) {
  return [...content.matchAll(managedChromeTablePattern())]
    .map((match) => match[0].trimEnd())
    .filter(Boolean)
    .join("\n\n");
}

function removeMisplacedRootSettings(content, keys) {
  const firstTable = content.search(/^\[/m);
  const rootEnd = firstTable === -1 ? content.length : firstTable;
  let root = content.slice(0, rootEnd);
  for (const key of keys) root = root.replace(settingPattern(key), "");
  return root + content.slice(rootEnd);
}

function mergeDesktopSections(content) {
  const pattern = /^\[desktop\]\s*\r?\n(?<body>.*?)(?=^\[|(?![\s\S]))/gms;
  const matches = [...content.matchAll(pattern)];
  if (matches.length <= 1) return content;
  const body = matches.map((match) => match.groups.body.trim()).filter(Boolean).join("\n");
  let result = "";
  let cursor = 0;
  for (const [index, match] of matches.entries()) {
    result += content.slice(cursor, match.index);
    if (index === 0) result += `[desktop]\n${body}${body ? "\n" : ""}`;
    cursor = match.index + match[0].length;
  }
  return result + content.slice(cursor);
}

export function applyCodexSettings(content, settings) {
  const keys = Object.keys(settings);
  const cleaned = mergeDesktopSections(removeMisplacedRootSettings(removeManagedChromeTables(content), keys));
  const section = desktopSection(cleaned);
  let body = section.match.groups.body;
  for (const [key, line] of Object.entries(settings)) body = replaceUniqueSetting(body, key, line);
  return replaceSectionBody(section.content, section.match, body);
}

export function restoreCodexSettings(current, backup, keys = CODEX_MANAGED_SETTINGS) {
  const savedChromeTables = extractManagedChromeTables(backup);
  const currentSection = desktopSection(mergeDesktopSections(
    removeMisplacedRootSettings(removeManagedChromeTables(current), keys),
  ));
  const backupMatch = /^\[desktop\]\s*\r?\n(?<body>.*?)(?=^\[|(?![\s\S]))/ms.exec(backup);
  let body = currentSection.match.groups.body;
  const savedBody = backupMatch?.groups.body ?? "";
  for (const key of keys) {
    const saved = [...savedBody.matchAll(settingPattern(key))].at(-1)?.[0]?.trimEnd();
    body = body.replace(settingPattern(key), "").trimEnd();
    if (key === "appearanceLightChromeTheme" && savedChromeTables) continue;
    if (saved) body = `${body}${body ? "\n" : ""}${saved}\n`;
  }
  const restored = replaceSectionBody(currentSection.content, currentSection.match, body);
  if (!savedChromeTables) return restored;
  return `${restored.trimEnd()}\n\n${savedChromeTables}\n`;
}

export function defaultCodexSettingsPaths({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  stateRoot = null,
} = {}) {
  let root = stateRoot;
  if (!root && platform === "darwin") root = path.join(home, "Library", "Application Support", "CodeDrobe");
  if (!root && platform === "win32") root = path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "CodeDrobe");
  if (!root) root = path.join(env.XDG_STATE_HOME || path.join(home, ".local", "state"), "codedrobe", "codex");
  return {
    configPath: path.join(home, ".codex", "config.toml"),
    backupPath: path.join(root, "config.before-codedrobe.toml"),
  };
}

async function writeAtomic(filename, content) {
  const directory = path.dirname(filename);
  const temporary = path.join(directory, `.${path.basename(filename)}.${process.pid}.${Date.now()}.tmp`);
  const mode = (await fs.stat(filename)).mode;
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", mode });
    await fs.rename(temporary, filename);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function publicResult(value) {
  const { rollback: _rollback, ...result } = value;
  return result;
}

export async function applyCodexBaseTheme({ targetTheme, platform = process.platform, options = {} }) {
  const baseTheme = targetTheme?.options?.baseTheme;
  if (!baseTheme) return { supported: true, applied: false, changed: false, restartRequired: false, rollback: async () => {} };
  if (typeof baseTheme !== "object" || Array.isArray(baseTheme)) {
    throw new Error("Codex baseTheme must be an object.");
  }
  const defaults = defaultCodexSettingsPaths({ platform, ...options });
  const configPath = path.resolve(options.configPath ?? defaults.configPath);
  const backupPath = path.resolve(options.backupPath ?? defaults.backupPath);
  const before = await fs.readFile(configPath, "utf8");
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  let backupCreated = false;
  try {
    await fs.copyFile(configPath, backupPath, fs.constants.COPYFILE_EXCL);
    backupCreated = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const updated = applyCodexSettings(before, buildCodexBaseThemeSettings(baseTheme, platform));
  if (updated !== before) await writeAtomic(configPath, updated);
  const transaction = {
    supported: true,
    applied: true,
    changed: updated !== before,
    restartRequired: updated !== before,
    configPath,
    backupPath,
    backupCreated,
    rollback: async () => {
      if (updated !== before) await writeAtomic(configPath, before);
      if (backupCreated) await fs.rm(backupPath, { force: true });
    },
  };
  return transaction;
}

export async function restoreCodexBaseTheme({ platform = process.platform, options = {} } = {}) {
  const defaults = defaultCodexSettingsPaths({ platform, ...options });
  const configPath = path.resolve(options.configPath ?? defaults.configPath);
  const backupPath = path.resolve(options.backupPath ?? defaults.backupPath);
  let backup;
  try {
    backup = await fs.readFile(backupPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { supported: true, restored: false, configPath, backupPath, reason: "missing-backup" };
    throw error;
  }
  const current = await fs.readFile(configPath, "utf8");
  const restored = restoreCodexSettings(current, backup);
  if (restored !== current) await writeAtomic(configPath, restored);
  await fs.rm(backupPath, { force: true });
  return { supported: true, restored: true, changed: restored !== current, configPath, backupPath };
}

export const codexHostSettings = {
  apply: applyCodexBaseTheme,
  restore: restoreCodexBaseTheme,
  publicResult,
};

export default codexHostSettings;
