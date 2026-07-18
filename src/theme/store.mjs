import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveBaseUrl } from "../auth/api.mjs";
import { MAX_THEME_PACKAGE_BYTES, THEME_EXTENSION, validateThemePackage } from "./package.mjs";
import { LEGACY_THEME_FORMAT, convertLegacyThemePackage, validateLegacyThemePackage } from "./legacy.mjs";

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/i;

export class ThemeStoreError extends Error {
  constructor(message, code, { status = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function storeRequest(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (cause) {
    throw new ThemeStoreError(`Could not reach the CodeDrobe store: ${cause.message}`, "network_error");
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch { /* Non-JSON bodies fall through to the status-based error below. */ }
  if (!response.ok) {
    throw new ThemeStoreError(
      payload?.error?.message ?? `Store API responded with HTTP ${response.status}.`,
      payload?.error?.code ?? `http_${response.status}`,
      { status: response.status },
    );
  }
  return payload;
}

function compactTheme(value, baseUrl) {
  return {
    slug: value.slug,
    name: value.name ?? null,
    description: value.description ?? null,
    version: value.version ?? null,
    categories: Array.isArray(value.categories)
      ? value.categories.map((category) => category?.slug).filter(Boolean)
      : [],
    author: value.author?.handle ?? null,
    free: Boolean(value.price?.free),
    downloads: typeof value.downloadCount === "number" ? value.downloadCount : null,
    likes: typeof value.likeCount === "number" ? value.likeCount : null,
    storeUrl: `${baseUrl}/themes/${value.slug}`,
  };
}

/** Search the public store catalog. All parameters are optional. */
export async function searchThemes({
  query = "",
  appId = null,
  category = null,
  limit = 20,
  baseUrl = resolveBaseUrl(),
  fetchImpl = fetch,
} = {}) {
  const params = new URLSearchParams();
  if (query?.trim()) params.set("q", query.trim().slice(0, 80));
  if (appId) params.set("app", appId);
  if (category) params.set("category", category);
  const boundedLimit = Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 20;
  params.set("limit", String(boundedLimit));
  const payload = await storeRequest(fetchImpl, `${baseUrl}/api/v1/themes?${params}`);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return {
    baseUrl,
    total: typeof payload?.meta?.total === "number" ? payload.meta.total : rows.length,
    themes: rows.filter((row) => row && typeof row.slug === "string").map((row) => compactTheme(row, baseUrl)),
  };
}

/**
 * Download a free store theme as a local .codedrobe-theme file.
 *
 * Mirrors the desktop install pipeline: the byte size and SHA-256 must match
 * the store record (and the response digest header when present), and the
 * payload must validate as a theme package before anything is written.
 */
export async function downloadTheme({
  slug,
  output = null,
  force = false,
  baseUrl = resolveBaseUrl(),
  fetchImpl = fetch,
  home = os.homedir(),
} = {}) {
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    throw new ThemeStoreError(`Invalid theme slug '${slug}'.`, "invalid_slug");
  }
  const detail = await storeRequest(fetchImpl, `${baseUrl}/api/v1/themes/${encodeURIComponent(slug)}`);
  const theme = detail?.data;
  if (!theme || typeof theme.downloadUrl !== "string" || !theme.package) {
    throw new ThemeStoreError("The store returned an invalid theme record.", "invalid_record");
  }
  const storeUrl = `${baseUrl}/themes/${slug}`;
  if (theme.price && !theme.price.free) {
    // Purchases stay in the browser; the CLI never handles payment flows.
    throw new ThemeStoreError(
      `'${slug}' is a paid theme. Purchase it in the store first: ${storeUrl}`,
      "payment_required",
      { status: 402 },
    );
  }
  const expectedBytes = theme.package.sizeBytes;
  const expectedSha = String(theme.package.sha256 ?? "").toLowerCase();
  if (!Number.isInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > MAX_THEME_PACKAGE_BYTES) {
    throw new ThemeStoreError("The store package size is out of bounds.", "invalid_record");
  }

  const downloadUrl = new URL(theme.downloadUrl, baseUrl).toString();
  let response;
  try {
    response = await fetchImpl(downloadUrl, { headers: { accept: "application/octet-stream" } });
  } catch (cause) {
    throw new ThemeStoreError(`Theme download failed: ${cause.message}`, "network_error");
  }
  if (!response.ok) {
    throw new ThemeStoreError(`Theme download failed (HTTP ${response.status}).`, `http_${response.status}`, { status: response.status });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== expectedBytes) {
    throw new ThemeStoreError("The downloaded package size does not match the store record.", "integrity_mismatch");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const headerDigest = response.headers?.get?.("x-codedrobe-sha256")?.toLowerCase() ?? null;
  if (digest !== expectedSha || (headerDigest && digest !== headerDigest)) {
    throw new ThemeStoreError("The downloaded package failed its SHA-256 integrity check.", "integrity_mismatch");
  }

  // Early store uploads are legacy .codex-theme packages; convert them on the
  // way in so the written file is always ready for `codedrobe apply`.
  let bundle;
  let converted = false;
  let fileBytes = bytes;
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (parsed?.format === LEGACY_THEME_FORMAT) {
      bundle = convertLegacyThemePackage(validateLegacyThemePackage(parsed));
      fileBytes = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, "utf8");
      converted = true;
    } else {
      bundle = validateThemePackage(parsed);
    }
  } catch (cause) {
    throw new ThemeStoreError(`The downloaded package is not a valid theme: ${cause.message}`, "invalid_package");
  }

  // Downloads default into the CLI's home so they never litter the working
  // directory and skills find them at a predictable path.
  let filename = output
    ? path.resolve(output)
    : path.join(home, ".codedrobe", "themes", `${slug}-${bundle.theme.version}${THEME_EXTENSION}`);
  if (!filename.endsWith(THEME_EXTENSION)) filename += THEME_EXTENSION;
  if (!force) {
    try {
      await fs.access(filename);
      throw new ThemeStoreError(`'${filename}' already exists. Pass --force to overwrite it.`, "file_exists");
    } catch (error) {
      if (error instanceof ThemeStoreError) throw error;
      // Missing file — safe to write.
    }
  }
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, fileBytes);

  return {
    slug,
    themeId: bundle.theme.id,
    version: bundle.theme.version,
    displayName: bundle.theme.displayName,
    targets: Object.keys(bundle.targets),
    // Size and digest describe the verified store download; a converted legacy
    // package writes different (new-format) bytes to disk.
    sizeBytes: bytes.length,
    sha256: digest,
    convertedFromLegacy: converted,
    output: filename,
    storeUrl,
  };
}
