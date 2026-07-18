import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { THEME_EXTENSION, writeThemePackage } from "../src/theme/package.mjs";
import { ThemeStoreError, downloadTheme, searchThemes } from "../src/theme/store.mjs";

const BASE = "https://store.example";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  };
}

function bytesResponse(bytes, { sha256 = null, status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    headers: { get: (name) => (name === "x-codedrobe-sha256" ? sha256 : null) },
  };
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

async function makePackageBytes(t, id = "dream_theme") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "theme.css"), ":root { color: #123; }", "utf8");
  await fs.writeFile(path.join(directory, "theme.json"), JSON.stringify({
    schemaVersion: 1,
    id,
    displayName: "Dream Theme",
    version: "1.0.0",
    targets: { codex: { css: "theme.css" } },
  }), "utf8");
  const output = path.join(directory, `${id}${THEME_EXTENSION}`);
  await writeThemePackage(path.join(directory, "theme.json"), output);
  const bytes = await fs.readFile(output);
  return { directory, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function themeRecord({ bytes, sha256 }, overrides = {}) {
  return {
    id: "theme_1",
    slug: "dream-theme",
    name: { en: "Dream Theme", zh: "梦境主题" },
    version: "1.0.0",
    categories: [{ slug: "retro", primary: true }],
    author: { handle: "anhao" },
    downloadUrl: "/api/v1/themes/dream-theme/download",
    price: { free: true, currency: "usd", unitAmount: 0 },
    package: { sizeBytes: bytes.length, sha256 },
    ...overrides,
  };
}

test("search builds the catalog query and returns compact rows", async () => {
  const fetchImpl = fetchQueue([
    jsonResponse({ data: [themeRecord({ bytes: Buffer.alloc(10), sha256: "0".repeat(64) })], meta: { total: 7 } }),
  ]);

  const result = await searchThemes({ query: " 复古 ", appId: "codex", category: "retro", limit: 5, baseUrl: BASE, fetchImpl });

  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, "/api/v1/themes");
  assert.equal(url.searchParams.get("q"), "复古");
  assert.equal(url.searchParams.get("app"), "codex");
  assert.equal(url.searchParams.get("category"), "retro");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(result.total, 7);
  assert.deepEqual(result.themes[0].categories, ["retro"]);
  assert.equal(result.themes[0].author, "anhao");
  assert.equal(result.themes[0].storeUrl, `${BASE}/themes/dream-theme`);
});

test("download verifies size and sha256 then writes a valid package", async (t) => {
  const pkg = await makePackageBytes(t);
  const output = path.join(pkg.directory, "downloaded.codedrobe-theme");
  const fetchImpl = fetchQueue([
    jsonResponse({ data: themeRecord(pkg) }),
    bytesResponse(pkg.bytes, { sha256: pkg.sha256 }),
  ]);

  const result = await downloadTheme({ slug: "dream-theme", output, baseUrl: BASE, fetchImpl });

  assert.equal(fetchImpl.calls[1].url, `${BASE}/api/v1/themes/dream-theme/download`);
  assert.equal(result.themeId, "dream_theme");
  assert.equal(result.version, "1.0.0");
  assert.equal(result.sha256, pkg.sha256);
  assert.deepEqual(result.targets, ["codex"]);
  assert.equal(await fs.readFile(result.output, "utf8"), pkg.bytes.toString("utf8"));
});

test("legacy .codex-theme store packages are converted to the current format", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-store-legacy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const legacyBytes = Buffer.from(JSON.stringify({
    format: "codex-theme",
    schemaVersion: 1,
    exportedAt: "2026-07-15T00:00:00.000Z",
    manifest: {
      schemaVersion: 1,
      id: "legacy-dream",
      displayName: "Legacy Dream",
      version: "1.2.3",
      css: "theme.css",
      copy: { tagline: "Converted safely" },
      baseTheme: { mode: "light", accent: "#b65cff" },
    },
    css: ":root { color: #432; }",
  }), "utf8");
  const sha256 = createHash("sha256").update(legacyBytes).digest("hex");
  const output = path.join(directory, "legacy.codedrobe-theme");
  const fetchImpl = fetchQueue([
    jsonResponse({ data: themeRecord({ bytes: legacyBytes, sha256 }, { slug: "legacy-dream" }) }),
    bytesResponse(legacyBytes, { sha256 }),
  ]);

  const result = await downloadTheme({ slug: "legacy-dream", output, baseUrl: BASE, fetchImpl });

  assert.equal(result.convertedFromLegacy, true);
  assert.equal(result.themeId, "legacy-dream");
  const written = JSON.parse(await fs.readFile(result.output, "utf8"));
  assert.equal(written.format, "codedrobe-theme");
  assert.deepEqual(Object.keys(written.targets), ["codex"]);
});

test("downloads default into ~/.codedrobe/themes", async (t) => {
  const pkg = await makePackageBytes(t);
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-store-home-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const fetchImpl = fetchQueue([
    jsonResponse({ data: themeRecord(pkg) }),
    bytesResponse(pkg.bytes, { sha256: pkg.sha256 }),
  ]);

  const result = await downloadTheme({ slug: "dream-theme", baseUrl: BASE, fetchImpl, home });

  assert.equal(result.output, path.join(home, ".codedrobe", "themes", `dream-theme-1.0.0${THEME_EXTENSION}`));
  await fs.access(result.output);
});

test("download rejects a package whose digest does not match the record", async (t) => {
  const pkg = await makePackageBytes(t);
  const tampered = Buffer.from(pkg.bytes.toString("utf8").replace("#123", "#666"), "utf8");
  const fetchImpl = fetchQueue([
    jsonResponse({ data: themeRecord({ bytes: tampered, sha256: pkg.sha256 }) }),
    bytesResponse(tampered, { sha256: pkg.sha256 }),
  ]);

  await assert.rejects(
    downloadTheme({ slug: "dream-theme", output: path.join(pkg.directory, "x.codedrobe-theme"), baseUrl: BASE, fetchImpl }),
    (error) => error instanceof ThemeStoreError && error.code === "integrity_mismatch",
  );
});

test("paid themes are refused with the store purchase link", async (t) => {
  const pkg = await makePackageBytes(t);
  const fetchImpl = fetchQueue([
    jsonResponse({ data: themeRecord(pkg, { price: { free: false, currency: "cny", unitAmount: 1200 } }) }),
  ]);

  await assert.rejects(
    downloadTheme({ slug: "dream-theme", baseUrl: BASE, fetchImpl }),
    (error) => {
      assert.equal(error.code, "payment_required");
      assert.match(error.message, /themes\/dream-theme/);
      return true;
    },
  );
});

test("download refuses to overwrite an existing file unless forced", async (t) => {
  const pkg = await makePackageBytes(t);
  const output = path.join(pkg.directory, "existing.codedrobe-theme");
  await fs.writeFile(output, "occupied", "utf8");
  const fetchImpl = fetchQueue([
    jsonResponse({ data: themeRecord(pkg) }),
    bytesResponse(pkg.bytes, { sha256: pkg.sha256 }),
    jsonResponse({ data: themeRecord(pkg) }),
    bytesResponse(pkg.bytes, { sha256: pkg.sha256 }),
  ]);

  await assert.rejects(
    downloadTheme({ slug: "dream-theme", output, baseUrl: BASE, fetchImpl }),
    (error) => error.code === "file_exists" && /--force/.test(error.message),
  );
  const forced = await downloadTheme({ slug: "dream-theme", output, force: true, baseUrl: BASE, fetchImpl });
  assert.equal(await fs.readFile(forced.output, "utf8"), pkg.bytes.toString("utf8"));
});

test("store errors surface their code and message", async () => {
  const fetchImpl = fetchQueue([
    jsonResponse({ error: { code: "not_found", message: "Theme not found." } }, 404),
  ]);
  await assert.rejects(
    downloadTheme({ slug: "missing-theme", baseUrl: BASE, fetchImpl }),
    (error) => error instanceof ThemeStoreError && error.code === "not_found" && error.status === 404,
  );
});
