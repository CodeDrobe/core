import fs from "node:fs/promises";
import path from "node:path";
import { getAccessToken, resolveBaseUrl } from "../auth/api.mjs";
import { lintThemePackage, readThemePackage } from "./package.mjs";

const STUDIO_THEMES_PATH = "/api/v1/studio/themes";

export class ThemePublishError extends Error {
  constructor(message, code, { status = null, fields = null } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

/** Mirrors the server's package-id → slug candidate mapping. */
export function slugCandidateFromThemeId(themeId) {
  return String(themeId).trim().toLowerCase().replace(/_/g, "-");
}

const FALLBACK_CATEGORY = "other";
const CJK_PATTERN = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

/** Uncategorized themes default to the `other` shelf so review can reclassify them. */
function catalogCategories(bundle) {
  const declared = bundle.theme?.catalog?.categories ?? [];
  return declared.length ? { categories: declared, defaulted: false } : { categories: [FALLBACK_CATEGORY], defaulted: true };
}

function localizedText(value) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return { en: null, zh: null };
    return CJK_PATTERN.test(text) ? { en: null, zh: text } : { en: text, zh: null };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const en = typeof value.en === "string" && value.en.trim() ? value.en.trim() : null;
    const zh = typeof value.zh === "string" && value.zh.trim() ? value.zh.trim() : null;
    return { en, zh };
  }
  return { en: null, zh: null };
}

/**
 * The store description this package should carry: catalog.description if
 * declared, otherwise `theme.copy.tagline` (a one-line pitch most themes have).
 * The theme name is never reused — a listing that repeats its own title reads
 * worse than an empty description. Mirrors the server's extractPackageCatalog.
 */
function effectiveDescription(bundle) {
  const catalog = bundle.theme?.catalog;
  if (catalog?.description !== undefined) return localizedText(catalog.description);
  const tagline = bundle.theme?.copy?.tagline;
  if (typeof tagline === "string" && tagline.trim()) {
    const value = tagline.trim();
    return CJK_PATTERN.test(value) ? { en: null, zh: value } : { en: value, zh: null };
  }
  return { en: null, zh: null };
}

/** Only the tagline fallback is sent on create; the server reads catalog.description itself. */
function fallbackDescription(bundle) {
  if (bundle.theme?.catalog?.description !== undefined) return null;
  const description = effectiveDescription(bundle);
  return description.en || description.zh ? description : null;
}

async function studioRequest(fetchImpl, baseUrl, accessToken, pathname, { method = "GET", body, json } = {}) {
  const headers = { authorization: `Bearer ${accessToken}` };
  let payloadBody = body;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    payloadBody = JSON.stringify(json);
  }
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${pathname}`, {
      method,
      body: payloadBody,
      headers,
    });
  } catch (cause) {
    throw new ThemePublishError(`Could not reach ${baseUrl}: ${cause.message}`, "network_error");
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch { /* Non-JSON bodies fall through to the status-based error below. */ }
  if (!response.ok) {
    throw new ThemePublishError(
      payload?.error?.message ?? `Studio API responded with HTTP ${response.status}.`,
      payload?.error?.code ?? `http_${response.status}`,
      { status: response.status, fields: payload?.error?.fields ?? null },
    );
  }
  return payload?.data ?? null;
}

function packageForm(bytes, filename, { slug = null, categories = [], description = null } = {}) {
  const form = new FormData();
  // Packages are serialized JSON; the studio rejects other MIME types (415).
  form.set("file", new File([bytes], filename, { type: "application/json" }));
  if (slug) form.set("slug", slug);
  if (categories.length) {
    form.set("categorySlugs", JSON.stringify(categories));
    form.set("primaryCategory", categories[0]);
  }
  if (description?.en) form.set("descriptionEn", description.en);
  if (description?.zh) form.set("descriptionZh", description.zh);
  return form;
}

async function findOwnThemeBySlug(fetchImpl, baseUrl, accessToken, slug) {
  const data = await studioRequest(fetchImpl, baseUrl, accessToken, STUDIO_THEMES_PATH);
  return (data?.themes ?? []).find((theme) => theme.slug === slug) ?? null;
}

/**
 * Publishes a packed .codedrobe-theme file to the CodeDrobe store studio.
 *
 * Creates the theme on first publish; on a `slug_taken` conflict it retries as a
 * new version of the caller's own theme with that slug. Category slugs ride in
 * `theme.catalog.categories` (first entry is the primary category); the server
 * owns the taxonomy and rejects unknown slugs.
 */
export async function publishThemePackage({
  filename,
  submit = false,
  slug = null,
  baseUrl = resolveBaseUrl(),
  fetchImpl = fetch,
  credentialOptions = {},
}) {
  const resolved = path.resolve(filename);
  const bundle = await readThemePackage(resolved);
  const warnings = lintThemePackage(bundle);
  const { categories, defaulted: categoriesDefaulted } = catalogCategories(bundle);
  const description = fallbackDescription(bundle);
  const bytes = await fs.readFile(resolved);
  const packageFilename = path.basename(resolved);
  const accessToken = await getAccessToken({ baseUrl, fetchImpl, credentialOptions });

  const targetSlug = (slug ?? slugCandidateFromThemeId(bundle.theme.id)).toLowerCase();
  let action = "created";
  let theme;
  let version;
  try {
    const created = await studioRequest(fetchImpl, baseUrl, accessToken, `${STUDIO_THEMES_PATH}/from-package`, {
      method: "POST",
      body: packageForm(bytes, packageFilename, { slug, categories, description }),
    });
    theme = created?.theme ?? null;
    version = created?.version ?? null;
  } catch (error) {
    if (error.code !== "slug_taken") throw error;
    const existing = await findOwnThemeBySlug(fetchImpl, baseUrl, accessToken, targetSlug);
    if (!existing) {
      throw new ThemePublishError(
        `Theme slug '${targetSlug}' already belongs to another creator. Pick a different one with --slug.`,
        "slug_taken",
        { status: 409 },
      );
    }
    const updated = await studioRequest(
      fetchImpl,
      baseUrl,
      accessToken,
      `${STUDIO_THEMES_PATH}/${encodeURIComponent(existing.id)}/versions/from-package`,
      { method: "POST", body: packageForm(bytes, packageFilename) },
    );
    action = "updated";
    theme = existing;
    version = updated?.version ?? null;
    // versions/from-package only uploads the package; name/description/categories
    // are theme-level. Backfill the ones the existing theme is missing so an
    // uncategorized or blank theme still lands on a shelf with prose (and can be
    // submitted). Fields that already have a value keep whatever was chosen on
    // the web — the package never clobbers them.
    const patch = {};
    if (!(existing.categories?.length)) {
      patch.categorySlugs = categories;
      patch.primaryCategory = categories[0];
    }
    const existingDescription = existing.description ?? {};
    if (!existingDescription.en && !existingDescription.zh) {
      const description = effectiveDescription(bundle);
      if (description.en || description.zh) patch.description = description;
    }
    if (Object.keys(patch).length) {
      const patched = await studioRequest(
        fetchImpl,
        baseUrl,
        accessToken,
        `${STUDIO_THEMES_PATH}/${encodeURIComponent(existing.id)}`,
        { method: "PATCH", json: patch },
      );
      theme = patched?.theme ?? theme;
    }
  }

  let review = null;
  if (submit) {
    if (!theme?.id || !version?.id) {
      throw new ThemePublishError("Studio response is missing theme or version ids; cannot submit.", "unexpected_response");
    }
    const submitted = await studioRequest(
      fetchImpl,
      baseUrl,
      accessToken,
      `${STUDIO_THEMES_PATH}/${encodeURIComponent(theme.id)}/versions/${encodeURIComponent(version.id)}/submit`,
      { method: "POST" },
    );
    theme = submitted?.theme ?? theme;
    version = submitted?.version ?? version;
    review = submitted?.review ?? null;
  }

  return {
    action: submit ? `${action}+submitted` : action,
    baseUrl,
    theme,
    version,
    review,
    categories,
    categoriesDefaulted,
    warnings,
    storeUrl: theme?.slug ? `${baseUrl}/themes/${theme.slug}` : null,
  };
}
