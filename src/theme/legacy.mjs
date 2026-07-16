import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_THEME_PACKAGE_BYTES,
  THEME_EXTENSION,
  THEME_FORMAT,
  THEME_SCHEMA_VERSION,
  validateThemePackage,
} from "./package.mjs";

export const LEGACY_THEME_FORMAT = "codex-theme";
export const LEGACY_THEME_EXTENSION = ".codex-theme";
export const LEGACY_THEME_SCHEMA_VERSION = 1;

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const REMOTE_CSS = /@import\s|url\(\s*["']?(?!data:)/i;
const SAFE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

export function validateLegacyThemePackage(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error("Legacy theme package must be a JSON object.");
  }
  if (bundle.format !== LEGACY_THEME_FORMAT || bundle.schemaVersion !== LEGACY_THEME_SCHEMA_VERSION) {
    throw new Error("Unsupported legacy .codex-theme format or schemaVersion.");
  }
  if (!bundle.manifest || typeof bundle.manifest !== "object" || Array.isArray(bundle.manifest)) {
    throw new Error("Legacy theme package requires a manifest object.");
  }
  if (bundle.manifest.schemaVersion !== LEGACY_THEME_SCHEMA_VERSION) {
    throw new Error("Unsupported legacy manifest schemaVersion.");
  }
  assertString(bundle.manifest.id, "manifest.id");
  assertString(bundle.manifest.displayName, "manifest.displayName");
  assertString(bundle.manifest.version, "manifest.version");
  assertString(bundle.manifest.css, "manifest.css");
  assertString(bundle.css, "css");
  if (!SAFE_ID.test(bundle.manifest.id)) throw new Error(`Invalid legacy theme id '${bundle.manifest.id}'.`);
  if (bundle.manifest.css !== "theme.css") throw new Error("Legacy manifest.css must be the portable theme.css entry.");
  if (REMOTE_CSS.test(bundle.css)) throw new Error("Legacy theme contains an external CSS resource.");
  for (const field of ["copy", "baseTheme"]) {
    const value = bundle.manifest[field];
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
      throw new Error(`Legacy manifest.${field} must be an object.`);
    }
  }

  if (bundle.manifest.art && !bundle.art) {
    throw new Error("Legacy theme manifest references artwork that is missing from the package.");
  }
  if (!bundle.manifest.art && bundle.art) {
    throw new Error("Legacy theme contains artwork that is not declared by manifest.art.");
  }
  if (bundle.art !== undefined) {
    if (!bundle.art || typeof bundle.art !== "object" || Array.isArray(bundle.art)) {
      throw new Error("Legacy theme art must be an object.");
    }
    assertString(bundle.art.filename, "art.filename");
    assertString(bundle.art.mimeType, "art.mimeType");
    assertString(bundle.art.base64, "art.base64");
    if (path.basename(bundle.art.filename) !== bundle.art.filename) {
      throw new Error("Legacy art.filename must be a safe basename.");
    }
    if (bundle.manifest.art !== bundle.art.filename) {
      throw new Error("Legacy manifest.art must match art.filename.");
    }
    if (!SAFE_IMAGE_TYPES.has(bundle.art.mimeType)) {
      throw new Error(`Unsupported legacy artwork MIME type '${bundle.art.mimeType}'.`);
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bundle.art.base64)) {
      throw new Error("Legacy art.base64 must contain valid Base64 data.");
    }
  }
  return bundle;
}

export function convertLegacyThemePackage(legacyBundle) {
  const legacy = validateLegacyThemePackage(legacyBundle);
  const { manifest } = legacy;
  const options = {
    legacy: {
      format: LEGACY_THEME_FORMAT,
      schemaVersion: LEGACY_THEME_SCHEMA_VERSION,
      ...(legacy.exportedAt ? { exportedAt: legacy.exportedAt } : {}),
    },
    ...(manifest.baseTheme ? { baseTheme: manifest.baseTheme } : {}),
  };
  return validateThemePackage({
    format: THEME_FORMAT,
    schemaVersion: THEME_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    theme: {
      id: manifest.id,
      displayName: manifest.displayName,
      version: manifest.version,
      ...(manifest.copy ? { copy: manifest.copy } : {}),
    },
    targets: {
      codex: {
        css: legacy.css,
        options,
      },
    },
    ...(legacy.art ? {
      assets: {
        art: {
          filename: legacy.art.filename,
          mimeType: legacy.art.mimeType,
          base64: legacy.art.base64,
        },
      },
    } : {}),
  });
}

export async function readLegacyThemePackage(filename) {
  if (path.extname(filename) !== LEGACY_THEME_EXTENSION) {
    throw new Error(`Legacy theme packages must use the ${LEGACY_THEME_EXTENSION} extension.`);
  }
  const stat = await fs.stat(filename);
  if (stat.size > MAX_THEME_PACKAGE_BYTES) throw new Error("Legacy theme package exceeds the 30MB limit.");
  return validateLegacyThemePackage(JSON.parse(await fs.readFile(filename, "utf8")));
}

export async function convertLegacyThemeFile(inputFilename, outputFilename, { force = false } = {}) {
  const input = path.resolve(inputFilename);
  const output = path.resolve(outputFilename);
  if (path.extname(output) !== THEME_EXTENSION) {
    throw new Error(`Converted output filename must end with ${THEME_EXTENSION}.`);
  }
  if (!force) {
    try {
      await fs.access(output);
      throw new Error(`Output already exists: ${output}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const bundle = convertLegacyThemePackage(await readLegacyThemePackage(input));
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_THEME_PACKAGE_BYTES) {
    throw new Error("Converted theme package exceeds the 30MB limit.");
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, serialized, "utf8");
  return { input, output, bundle };
}
