import fs from "node:fs/promises";
import path from "node:path";

export const THEME_FORMAT = "codedrobe-theme";
export const THEME_EXTENSION = ".codedrobe-theme";
export const THEME_SCHEMA_VERSION = 1;
export const MAX_THEME_PACKAGE_BYTES = 30 * 1024 * 1024;

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const REMOTE_CSS = /@import\s|url\(\s*["']?(?!data:)/i;

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function mimeTypeFor(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    default: return "image/png";
  }
}

function validateTarget(target, appId) {
  if (!SAFE_ID.test(appId)) throw new Error(`Invalid target app id '${appId}'.`);
  assertString(target?.css, `targets.${appId}.css`);
  if (REMOTE_CSS.test(target.css)) {
    throw new Error(`Target '${appId}' contains an external CSS resource.`);
  }
}

export function validateThemePackage(bundle) {
  if (!bundle || typeof bundle !== "object") throw new Error("Theme package must be a JSON object.");
  if (bundle.format !== THEME_FORMAT) throw new Error(`Unsupported theme format '${bundle.format ?? "missing"}'.`);
  if (bundle.schemaVersion !== THEME_SCHEMA_VERSION) {
    throw new Error(`Unsupported theme schemaVersion '${bundle.schemaVersion ?? "missing"}'.`);
  }
  assertString(bundle.theme?.id, "theme.id");
  assertString(bundle.theme?.displayName, "theme.displayName");
  assertString(bundle.theme?.version, "theme.version");
  if (!SAFE_ID.test(bundle.theme.id)) throw new Error(`Invalid theme id '${bundle.theme.id}'.`);
  if (!bundle.targets || typeof bundle.targets !== "object" || Array.isArray(bundle.targets)) {
    throw new Error("Theme package requires a targets object.");
  }
  const entries = Object.entries(bundle.targets);
  if (!entries.length) throw new Error("Theme package must support at least one app target.");
  for (const [appId, target] of entries) validateTarget(target, appId);

  if (bundle.assets?.art) {
    assertString(bundle.assets.art.filename, "assets.art.filename");
    assertString(bundle.assets.art.mimeType, "assets.art.mimeType");
    assertString(bundle.assets.art.base64, "assets.art.base64");
    if (path.basename(bundle.assets.art.filename) !== bundle.assets.art.filename) {
      throw new Error("assets.art.filename must be a safe basename.");
    }
  }
  return bundle;
}

export async function readThemePackage(filename) {
  if (path.extname(filename) !== THEME_EXTENSION) {
    throw new Error(`Theme packages must use the ${THEME_EXTENSION} extension.`);
  }
  const stat = await fs.stat(filename);
  if (stat.size > MAX_THEME_PACKAGE_BYTES) throw new Error("Theme package exceeds the 30MB limit.");
  const bundle = JSON.parse(await fs.readFile(filename, "utf8"));
  return validateThemePackage(bundle);
}

export function resolveThemeTarget(bundle, appId) {
  validateThemePackage(bundle);
  const target = bundle.targets[appId];
  if (!target) {
    throw new Error(`Theme '${bundle.theme.id}' does not support app '${appId}'.`);
  }
  const art = bundle.assets?.art;
  return {
    theme: bundle.theme,
    css: target.css,
    options: target.options ?? {},
    artDataUrl: art ? `data:${art.mimeType};base64,${art.base64}` : null,
  };
}

export async function buildThemePackage(manifestFilename) {
  const manifestPath = path.resolve(manifestFilename);
  const base = path.dirname(manifestPath);
  const source = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (source.schemaVersion !== THEME_SCHEMA_VERSION) {
    throw new Error(`Unsupported source manifest schemaVersion '${source.schemaVersion ?? "missing"}'.`);
  }
  const targets = {};
  for (const [appId, target] of Object.entries(source.targets ?? {})) {
    assertString(target?.css, `targets.${appId}.css`);
    const css = await fs.readFile(path.resolve(base, target.css), "utf8");
    targets[appId] = { css, ...(target.options ? { options: target.options } : {}) };
  }

  let assets;
  if (source.art) {
    const artPath = path.resolve(base, source.art);
    const filename = path.basename(source.art).replace(/[^a-z0-9._-]/gi, "-") || "art.png";
    assets = {
      art: {
        filename,
        mimeType: mimeTypeFor(artPath),
        base64: (await fs.readFile(artPath)).toString("base64"),
      },
    };
  }

  const bundle = validateThemePackage({
    format: THEME_FORMAT,
    schemaVersion: THEME_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    theme: {
      id: source.id,
      displayName: source.displayName,
      version: source.version,
      ...(source.copy ? { copy: source.copy } : {}),
    },
    targets,
    ...(assets ? { assets } : {}),
  });
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_THEME_PACKAGE_BYTES) {
    throw new Error("Theme package exceeds the 30MB limit.");
  }
  return { bundle, serialized };
}

export async function writeThemePackage(manifestFilename, outputFilename, { force = false } = {}) {
  const output = path.resolve(outputFilename);
  if (path.extname(output) !== THEME_EXTENSION) {
    throw new Error(`Output filename must end with ${THEME_EXTENSION}.`);
  }
  if (!force) {
    try {
      await fs.access(output);
      throw new Error(`Output already exists: ${output}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const result = await buildThemePackage(manifestFilename);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, result.serialized, "utf8");
  return { output, bundle: result.bundle };
}
