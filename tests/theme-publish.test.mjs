import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { credentialsEntryFromTokens } from "../src/auth/api.mjs";
import { saveCredentials } from "../src/auth/credentials.mjs";
import { THEME_EXTENSION, writeThemePackage } from "../src/theme/package.mjs";
import { ThemePublishError, publishThemePackage, slugCandidateFromThemeId } from "../src/theme/publish.mjs";

const BASE = "https://store.example";

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fetchQueue(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (!queue.length) throw new Error(`Unexpected fetch: ${url}`);
    return queue.shift();
  };
  impl.calls = calls;
  return impl;
}

async function makeTempDir(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function seedLogin(t) {
  const home = await makeTempDir(t, "codedrobe-publish-home-");
  const entry = credentialsEntryFromTokens(
    { accessToken: "cdbat_publish", refreshToken: "cdbrt_publish", expiresIn: 900, scope: "theme:write theme:submit" },
    { scopes: ["theme:write", "theme:submit"] },
  );
  await saveCredentials(BASE, entry, { home });
  return { home };
}

async function makePackage(t, { id = "dream_theme", catalog, copy } = {}) {
  const directory = await makeTempDir(t, "codedrobe-publish-pkg-");
  await fs.writeFile(path.join(directory, "theme.css"), ":root { color: #123; }", "utf8");
  await fs.writeFile(path.join(directory, "theme.json"), JSON.stringify({
    schemaVersion: 1,
    id,
    displayName: "Dream Theme",
    version: "1.0.0",
    ...(catalog ? { catalog } : {}),
    ...(copy ? { copy } : {}),
    targets: { codex: { css: "theme.css" } },
  }), "utf8");
  const output = path.join(directory, `${id}${THEME_EXTENSION}`);
  await writeThemePackage(path.join(directory, "theme.json"), output);
  return output;
}

const STUDIO_THEME = { id: "theme_1", slug: "dream-theme", status: "draft" };
const STUDIO_VERSION = { id: "version_1", version: "1.0.0", status: "draft" };

test("package theme id maps to the marketplace slug candidate", () => {
  assert.equal(slugCandidateFromThemeId("Dream_Theme"), "dream-theme");
});

test("publishes a new theme with catalog categories in the multipart form", async (t) => {
  const credentialOptions = await seedLogin(t);
  const filename = await makePackage(t, {
    catalog: {
      name: { en: "Dream Theme", zh: "梦境主题" },
      description: { en: "A dreamy skin.", zh: "梦境皮肤。" },
      categories: ["retro", "artistic"],
    },
  });
  const fetchImpl = fetchQueue([
    jsonResponse({ data: { theme: STUDIO_THEME, version: STUDIO_VERSION } }, 201),
  ]);

  const result = await publishThemePackage({ filename, baseUrl: BASE, fetchImpl, credentialOptions });

  assert.equal(result.action, "created");
  assert.equal(result.theme.slug, "dream-theme");
  assert.equal(result.storeUrl, `${BASE}/themes/dream-theme`);
  assert.deepEqual(result.categories, ["retro", "artistic"]);

  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.equal(call.url, `${BASE}/api/v1/studio/themes/from-package`);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.authorization, "Bearer cdbat_publish");
  const form = call.init.body;
  assert.ok(form instanceof FormData);
  const file = form.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, `dream_theme${THEME_EXTENSION}`);
  assert.equal(file.type, "application/json");
  assert.equal(form.get("categorySlugs"), JSON.stringify(["retro", "artistic"]));
  assert.equal(form.get("primaryCategory"), "retro");
});

test("uncategorized packages default to 'other' and describe themselves with the tagline", async (t) => {
  const credentialOptions = await seedLogin(t);
  const filename = await makePackage(t, { copy: { tagline: "找回 2007 年的蓝色桌面" } });
  const fetchImpl = fetchQueue([
    jsonResponse({ data: { theme: STUDIO_THEME, version: STUDIO_VERSION } }, 201),
  ]);

  const result = await publishThemePackage({ filename, baseUrl: BASE, fetchImpl, credentialOptions });

  assert.deepEqual(result.categories, ["other"]);
  assert.equal(result.categoriesDefaulted, true);
  const form = fetchImpl.calls[0].init.body;
  assert.equal(form.get("categorySlugs"), JSON.stringify(["other"]));
  assert.equal(form.get("primaryCategory"), "other");
  // CJK taglines route to the Chinese description; the name is never reused.
  assert.equal(form.get("descriptionZh"), "找回 2007 年的蓝色桌面");
  assert.equal(form.get("descriptionEn"), null);
});

test("declared catalog descriptions are never overridden by the tagline", async (t) => {
  const credentialOptions = await seedLogin(t);
  const filename = await makePackage(t, {
    catalog: { description: { en: "Curated description." }, categories: ["retro"] },
    copy: { tagline: "should not be sent" },
  });
  const fetchImpl = fetchQueue([
    jsonResponse({ data: { theme: STUDIO_THEME, version: STUDIO_VERSION } }, 201),
  ]);

  const result = await publishThemePackage({ filename, baseUrl: BASE, fetchImpl, credentialOptions });

  assert.equal(result.categoriesDefaulted, false);
  const form = fetchImpl.calls[0].init.body;
  assert.equal(form.get("descriptionEn"), null);
  assert.equal(form.get("descriptionZh"), null);
});

test("updating a theme with a blank description backfills it from the package", async (t) => {
  const credentialOptions = await seedLogin(t);
  const filename = await makePackage(t, {
    catalog: { description: { en: "A fresh coat of paint.", zh: "焕然一新的界面。" } },
  });
  const fetchImpl = fetchQueue([
    jsonResponse({ error: { code: "slug_taken", message: "Theme slug is already in use." } }, 409),
    // Existing theme already has categories, so only the blank description backfills.
    jsonResponse({ data: { themes: [{ id: "theme_9", slug: "dream-theme", categories: [{ slug: "retro" }], description: { en: null, zh: null } }], nextCursor: null } }),
    jsonResponse({ data: { version: { id: "version_2", version: "1.0.0", status: "draft" } } }, 201),
    jsonResponse({ data: { theme: { id: "theme_9", slug: "dream-theme", categories: [{ slug: "retro" }] } } }),
  ]);

  await publishThemePackage({ filename, baseUrl: BASE, fetchImpl, credentialOptions });

  const patch = fetchImpl.calls[3];
  assert.equal(patch.init.method, "PATCH");
  const payload = JSON.parse(patch.init.body);
  assert.deepEqual(payload.description, { en: "A fresh coat of paint.", zh: "焕然一新的界面。" });
  // Existing categories are left untouched.
  assert.equal(payload.categorySlugs, undefined);
});

test("updating a theme that already has a description leaves it untouched", async (t) => {
  const credentialOptions = await seedLogin(t);
  const filename = await makePackage(t, { catalog: { description: { en: "New prose." }, categories: ["retro"] } });
  const fetchImpl = fetchQueue([
    jsonResponse({ error: { code: "slug_taken", message: "Theme slug is already in use." } }, 409),
    jsonResponse({ data: { themes: [{ id: "theme_9", slug: "dream-theme", categories: [{ slug: "retro" }], description: { en: "Existing prose.", zh: null } }], nextCursor: null } }),
    jsonResponse({ data: { version: { id: "version_2", version: "1.0.0", status: "draft" } } }, 201),
  ]);

  await publishThemePackage({ filename, baseUrl: BASE, fetchImpl, credentialOptions });

  // Both category and description are already present, so no PATCH is issued.
  assert.equal(fetchImpl.calls.length, 3);
});

test("slug conflicts on the author's own theme publish a new version instead", async (t) => {
  const credentialOptions = await seedLogin(t);
  const filename = await makePackage(t);
  const fetchImpl = fetchQueue([
    jsonResponse({ error: { code: "slug_taken", message: "Theme slug is already in use." } }, 409),
    jsonResponse({ data: { themes: [{ id: "theme_9", slug: "dream-theme", status: "published", categories: [{ slug: "retro" }] }], nextCursor: null } }),
    jsonResponse({ data: { version: { id: "version_2", version: "1.0.0", status: "draft" } } }, 201),
  ]);

  const result = await publishThemePackage({ filename, baseUrl: BASE, fetchImpl, credentialOptions });

  assert.equal(result.action, "updated");
  assert.equal(result.theme.id, "theme_9");
  assert.equal(result.version.id, "version_2");
  assert.equal(fetchImpl.calls[1].url, `${BASE}/api/v1/studio/themes`);
  assert.equal(fetchImpl.calls[2].url, `${BASE}/api/v1/studio/themes/theme_9/versions/from-package`);
  // Category assignments belong to the existing theme; version uploads must not resend them.
  assert.equal(fetchImpl.calls[2].init.body.get("categorySlugs"), null);
  // The theme already has categories, so no backfill PATCH is issued.
  assert.equal(fetchImpl.calls.length, 3);
});

test("updating an uncategorized theme backfills the default 'other' category", async (t) => {
  const credentialOptions = await seedLogin(t);
  const filename = await makePackage(t);
  const fetchImpl = fetchQueue([
    jsonResponse({ error: { code: "slug_taken", message: "Theme slug is already in use." } }, 409),
    jsonResponse({ data: { themes: [{ id: "theme_9", slug: "dream-theme", status: "draft", categories: [] }], nextCursor: null } }),
    jsonResponse({ data: { version: { id: "version_2", version: "1.0.0", status: "draft" } } }, 201),
    jsonResponse({ data: { theme: { id: "theme_9", slug: "dream-theme", status: "draft", categories: [{ slug: "other" }] } } }),
  ]);

  const result = await publishThemePackage({ filename, baseUrl: BASE, fetchImpl, credentialOptions });

  assert.equal(result.action, "updated");
  const patch = fetchImpl.calls[3];
  assert.equal(patch.url, `${BASE}/api/v1/studio/themes/theme_9`);
  assert.equal(patch.init.method, "PATCH");
  assert.equal(patch.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(patch.init.body), { categorySlugs: ["other"], primaryCategory: "other" });
});

test("slug taken by another creator fails with guidance instead of retrying", async (t) => {
  const credentialOptions = await seedLogin(t);
  const filename = await makePackage(t);
  const fetchImpl = fetchQueue([
    jsonResponse({ error: { code: "slug_taken", message: "Theme slug is already in use." } }, 409),
    jsonResponse({ data: { themes: [], nextCursor: null } }),
  ]);

  await assert.rejects(
    publishThemePackage({ filename, baseUrl: BASE, fetchImpl, credentialOptions }),
    (error) => {
      assert.ok(error instanceof ThemePublishError);
      assert.equal(error.code, "slug_taken");
      assert.match(error.message, /--slug/);
      return true;
    },
  );
});

test("--submit chains the review submission after the upload", async (t) => {
  const credentialOptions = await seedLogin(t);
  const filename = await makePackage(t);
  const fetchImpl = fetchQueue([
    jsonResponse({ data: { theme: STUDIO_THEME, version: STUDIO_VERSION } }, 201),
    jsonResponse({
      data: {
        theme: { ...STUDIO_THEME, status: "review" },
        version: { ...STUDIO_VERSION, status: "review" },
        review: { status: "queued" },
      },
    }),
  ]);

  const result = await publishThemePackage({ filename, submit: true, baseUrl: BASE, fetchImpl, credentialOptions });

  assert.equal(result.action, "created+submitted");
  assert.equal(result.theme.status, "review");
  assert.deepEqual(result.review, { status: "queued" });
  assert.equal(
    fetchImpl.calls[1].url,
    `${BASE}/api/v1/studio/themes/theme_1/versions/version_1/submit`,
  );
});

test("server errors surface their studio code and message", async (t) => {
  const credentialOptions = await seedLogin(t);
  const filename = await makePackage(t);
  const fetchImpl = fetchQueue([
    jsonResponse({ error: { code: "version_exists", message: "Theme version already exists." } }, 409),
  ]);

  await assert.rejects(
    publishThemePackage({ filename, baseUrl: BASE, fetchImpl, credentialOptions }),
    (error) => error instanceof ThemePublishError
      && error.code === "version_exists"
      && error.status === 409,
  );
});

test("invalid catalog categories fail during packing before any upload", async (t) => {
  await assert.rejects(
    makePackage(t, { catalog: { categories: ["Retro Vibes!"] } }),
    /lowercase slugs/,
  );
  await assert.rejects(
    makePackage(t, { catalog: { categories: [] } }),
    /non-empty array/,
  );
  await assert.rejects(
    makePackage(t, { catalog: { categories: ["retro", "retro"] } }),
    /duplicates/,
  );
});
