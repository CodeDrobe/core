import fs from "node:fs/promises";
import path from "node:path";

export const THEME_FORMAT = "codedrobe-theme";
export const THEME_EXTENSION = ".codedrobe-theme";
export const THEME_SCHEMA_VERSION = 1;
export const MAX_THEME_PACKAGE_BYTES = 30 * 1024 * 1024;
export const MAX_THEME_IMAGES = 32;

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const SAFE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const REMOTE_CSS = /@import\s|url\(\s*["']?(?!data:)/i;
const MAX_VERIFICATION_REQUIREMENTS = 32;
const MAX_VERIFICATION_CONTEXTS = 16;
const MAX_SELECTORS_PER_REQUIREMENT = 16;
const MAX_SELECTOR_LENGTH = 1024;
const SELECTOR_WARNING_LENGTH = 180;
const MAX_LINT_WARNINGS = 100;
const MAX_LINT_SELECTOR_DISPLAY_LENGTH = 240;

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function mimeTypeFor(filename) {
  switch (path.extname(filename).toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".png": return "image/png";
    default: return null;
  }
}

function validateImageAsset(image, label) {
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    throw new Error(`${label} must be an image object.`);
  }
  assertString(image.filename, `${label}.filename`);
  assertString(image.mimeType, `${label}.mimeType`);
  assertString(image.base64, `${label}.base64`);
  if (path.basename(image.filename) !== image.filename) {
    throw new Error(`${label}.filename must be a safe basename.`);
  }
  if (!SAFE_IMAGE_TYPES.has(image.mimeType)) {
    throw new Error(`${label}.mimeType '${image.mimeType}' is not supported.`);
  }
  if (!BASE64.test(image.base64)) throw new Error(`${label}.base64 must contain valid Base64 data.`);
}

function resolvedImageAssets(bundle) {
  const images = { ...(bundle.assets?.images ?? {}) };
  if (bundle.assets?.art && !images.hero) images.hero = bundle.assets.art;
  return images;
}

function validateSelectorArray(selectors, label) {
  if (!Array.isArray(selectors) || !selectors.length) {
    throw new Error(`${label} must be a non-empty selector array.`);
  }
  if (selectors.length > MAX_SELECTORS_PER_REQUIREMENT) {
    throw new Error(`${label} exceeds ${MAX_SELECTORS_PER_REQUIREMENT} selectors.`);
  }
  for (const [selectorIndex, selector] of selectors.entries()) {
    assertString(selector, `${label}[${selectorIndex}]`);
    if (selector.length > MAX_SELECTOR_LENGTH || selector.includes("\0")) {
      throw new Error(`${label}[${selectorIndex}] is not a safe selector.`);
    }
  }
}

function validateRequirementList(requirements, label, names) {
  if (requirements === undefined) return 0;
  if (!Array.isArray(requirements) || !requirements.length) {
    throw new Error(`${label} must be a non-empty array when provided.`);
  }
  let count = 0;
  for (const [index, requirement] of requirements.entries()) {
    const itemLabel = `${label}[${index}]`;
    assertString(requirement?.name, `${itemLabel}.name`);
    if (!SAFE_ID.test(requirement.name)) throw new Error(`${itemLabel}.name must be a safe id.`);
    if (names.has(requirement.name)) throw new Error(`${label} contains duplicate requirement '${requirement.name}'.`);
    names.add(requirement.name);
    validateSelectorArray(requirement.any, `${itemLabel}.any`);
    count += 1;
  }
  return count;
}

function validateVerification(verification, label) {
  if (verification === undefined) return;
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    throw new Error(`${label} must be an object.`);
  }
  let requirementCount = 0;
  const names = new Set();
  requirementCount += validateRequirementList(verification.required, `${label}.required`, names);
  requirementCount += validateRequirementList(verification.recommended, `${label}.recommended`, names);

  if (verification.contexts !== undefined) {
    if (!Array.isArray(verification.contexts) || !verification.contexts.length) {
      throw new Error(`${label}.contexts must be a non-empty array when provided.`);
    }
    if (verification.contexts.length > MAX_VERIFICATION_CONTEXTS) {
      throw new Error(`${label}.contexts exceeds ${MAX_VERIFICATION_CONTEXTS} entries.`);
    }
    const contextNames = new Set();
    for (const [index, context] of verification.contexts.entries()) {
      const contextLabel = `${label}.contexts[${index}]`;
      assertString(context?.name, `${contextLabel}.name`);
      if (!SAFE_ID.test(context.name)) throw new Error(`${contextLabel}.name must be a safe id.`);
      if (contextNames.has(context.name)) throw new Error(`${label} contains duplicate context '${context.name}'.`);
      contextNames.add(context.name);
      if (!context.when || typeof context.when !== "object" || Array.isArray(context.when)) {
        throw new Error(`${contextLabel}.when must be an object.`);
      }
      validateSelectorArray(context.when.any, `${contextLabel}.when.any`);
      const names = new Set();
      const contextCount = validateRequirementList(context.required, `${contextLabel}.required`, names) +
        validateRequirementList(context.recommended, `${contextLabel}.recommended`, names);
      if (!contextCount) throw new Error(`${contextLabel} must declare required or recommended checks.`);
      requirementCount += contextCount;
    }
  }

  if (!requirementCount) {
    throw new Error(`${label} must declare required, recommended, or contextual checks.`);
  }
  if (requirementCount > MAX_VERIFICATION_REQUIREMENTS) {
    throw new Error(`${label} exceeds ${MAX_VERIFICATION_REQUIREMENTS} total requirements.`);
  }
}

function extractCssSelectorBlocks(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  let boundary = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      const prelude = source.slice(boundary, index).trim();
      if (prelude && !prelude.startsWith("@")) selectors.push(prelude);
      boundary = index + 1;
    } else if (character === "}") {
      boundary = index + 1;
    }
  }
  return selectors;
}

function lintSelector(selector, metadata) {
  const warnings = [];
  const displaySelector = selector.replace(/\s+/g, " ").trim().slice(0, MAX_LINT_SELECTOR_DISPLAY_LENGTH);
  const add = (code, message) => warnings.push({ code, ...metadata, selector: displaySelector, message });
  if (selector.length > SELECTOR_WARNING_LENGTH) {
    add("long-selector", `Selector is ${selector.length} characters long and may be coupled to DOM structure.`);
  }
  if (/:?(?:first|last|nth)-(?:child|of-type)\b/i.test(selector)) {
    add("positional-selector", "Positional selectors often break when the application inserts or reorders nodes.");
  }
  if ((selector.match(/>/g) ?? []).length >= 3) {
    add("deep-child-chain", "Deep direct-child chains are sensitive to wrapper changes.");
  }
  if (/\[(?:aria-label|title|placeholder)[*^$|~]?=\s*["'][^"']+["']\]/i.test(selector)) {
    add("localized-attribute", "Text-bearing accessibility attributes may change with locale or product copy.");
  }
  if (/\.[a-z_-][\w-]*__[a-z0-9_-]+__[a-z0-9_-]{5,}/i.test(selector)) {
    add("generated-class", "Generated class names are not stable application landmarks.");
  }
  return warnings;
}

function verificationSelectors(verification, prefix) {
  if (!verification) return [];
  const entries = [];
  const append = (requirements, location) => {
    for (const requirement of requirements ?? []) {
      for (const selector of requirement.any) entries.push({ selector, location: `${location}.${requirement.name}` });
    }
  };
  append(verification.required, `${prefix}.required`);
  append(verification.recommended, `${prefix}.recommended`);
  for (const context of verification.contexts ?? []) {
    for (const selector of context.when.any) entries.push({ selector, location: `${prefix}.contexts.${context.name}.when` });
    append(context.required, `${prefix}.contexts.${context.name}.required`);
    append(context.recommended, `${prefix}.contexts.${context.name}.recommended`);
  }
  return entries;
}

export function lintThemePackage(bundle) {
  validateThemePackage(bundle);
  const warnings = [];
  for (const [appId, target] of Object.entries(bundle.targets)) {
    for (const selector of extractCssSelectorBlocks(target.css)) {
      warnings.push(...lintSelector(selector, { appId, location: `targets.${appId}.css` }));
    }
    for (const entry of verificationSelectors(target.verification, `targets.${appId}.verification`)) {
      warnings.push(...lintSelector(entry.selector, { appId, location: entry.location }));
    }
  }
  const unique = new Map(warnings.map((warning) => [
    `${warning.code}\0${warning.appId}\0${warning.location}\0${warning.selector}`,
    warning,
  ]));
  return [...unique.values()].slice(0, MAX_LINT_WARNINGS);
}

function validateTarget(target, appId) {
  if (!SAFE_ID.test(appId)) throw new Error(`Invalid target app id '${appId}'.`);
  assertString(target?.css, `targets.${appId}.css`);
  if (REMOTE_CSS.test(target.css)) {
    throw new Error(`Target '${appId}' contains an external CSS resource.`);
  }
  if (target.options !== undefined && (!target.options || typeof target.options !== "object" || Array.isArray(target.options))) {
    throw new Error(`targets.${appId}.options must be an object.`);
  }
  if (target.options?.rendererProfile !== undefined) {
    assertString(target.options.rendererProfile, `targets.${appId}.options.rendererProfile`);
    if (!SAFE_ID.test(target.options.rendererProfile)) {
      throw new Error(`targets.${appId}.options.rendererProfile must be a safe id.`);
    }
  }
  if (target.options?.baseTheme !== undefined && (
    !target.options.baseTheme
    || typeof target.options.baseTheme !== "object"
    || Array.isArray(target.options.baseTheme)
  )) {
    throw new Error(`targets.${appId}.options.baseTheme must be an object.`);
  }
  validateVerification(target.verification, `targets.${appId}.verification`);
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
  if (bundle.theme.copy !== undefined && (!bundle.theme.copy || typeof bundle.theme.copy !== "object" || Array.isArray(bundle.theme.copy))) {
    throw new Error("theme.copy must be an object.");
  }
  if (!bundle.targets || typeof bundle.targets !== "object" || Array.isArray(bundle.targets)) {
    throw new Error("Theme package requires a targets object.");
  }
  const entries = Object.entries(bundle.targets);
  if (!entries.length) throw new Error("Theme package must support at least one app target.");
  for (const [appId, target] of entries) validateTarget(target, appId);

  if (bundle.assets !== undefined && (!bundle.assets || typeof bundle.assets !== "object" || Array.isArray(bundle.assets))) {
    throw new Error("assets must be an object.");
  }
  if (bundle.assets?.images !== undefined) {
    if (!bundle.assets.images || typeof bundle.assets.images !== "object" || Array.isArray(bundle.assets.images)) {
      throw new Error("assets.images must be an object.");
    }
    const images = Object.entries(bundle.assets.images);
    if (!images.length) throw new Error("assets.images must not be empty when provided.");
    if (images.length > MAX_THEME_IMAGES) throw new Error(`assets.images exceeds ${MAX_THEME_IMAGES} entries.`);
    for (const [name, image] of images) {
      if (!SAFE_ID.test(name)) throw new Error(`assets.images contains invalid image id '${name}'.`);
      validateImageAsset(image, `assets.images.${name}`);
    }
  }
  if (bundle.assets?.art) {
    validateImageAsset(bundle.assets.art, "assets.art");
    if (bundle.assets.images?.hero) {
      throw new Error("assets.art cannot be combined with assets.images.hero.");
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
  const imageAssets = resolvedImageAssets(bundle);
  const imageDataUrls = Object.fromEntries(Object.entries(imageAssets).map(([name, image]) => [
    name,
    `data:${image.mimeType};base64,${image.base64}`,
  ]));
  return {
    theme: bundle.theme,
    css: target.css,
    options: target.options ?? {},
    verification: target.verification ?? null,
    imageDataUrls,
    artDataUrl: imageDataUrls.hero ?? null,
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
    targets[appId] = {
      css,
      ...(target.options ? { options: target.options } : {}),
      ...(target.verification ? { verification: target.verification } : {}),
    };
  }

  if (source.images !== undefined && (!source.images || typeof source.images !== "object" || Array.isArray(source.images))) {
    throw new Error("images must be an object.");
  }
  if (source.art && source.images?.hero) {
    throw new Error("Source manifest art cannot be combined with images.hero.");
  }
  const sourceImages = {
    ...(source.art ? { hero: source.art } : {}),
    ...(source.images ?? {}),
  };
  if (Object.keys(sourceImages).length > MAX_THEME_IMAGES) {
    throw new Error(`Source manifest images exceeds ${MAX_THEME_IMAGES} entries.`);
  }
  const images = {};
  for (const [name, sourceFilename] of Object.entries(sourceImages)) {
    if (!SAFE_ID.test(name)) throw new Error(`Source manifest contains invalid image id '${name}'.`);
    assertString(sourceFilename, `images.${name}`);
    const imagePath = path.resolve(base, sourceFilename);
    const mimeType = mimeTypeFor(imagePath);
    if (!mimeType) throw new Error(`images.${name} uses an unsupported image file type.`);
    images[name] = {
      filename: path.basename(sourceFilename).replace(/[^a-z0-9._-]/gi, "-") || `${name}.png`,
      mimeType,
      base64: (await fs.readFile(imagePath)).toString("base64"),
    };
  }
  const assets = Object.keys(images).length ? { images } : null;

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
