import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  convertLegacyThemeFile,
  convertLegacyThemePackage,
  validateLegacyThemePackage,
} from "../src/theme/legacy.mjs";
import { readThemePackage, resolveThemeTarget } from "../src/theme/package.mjs";

function legacyTheme(overrides = {}) {
  return {
    format: "codex-theme",
    schemaVersion: 1,
    exportedAt: "2026-07-15T00:00:00.000Z",
    manifest: {
      schemaVersion: 1,
      id: "legacy-dream",
      displayName: "Legacy Dream",
      version: "1.2.3",
      css: "theme.css",
      art: "cover.png",
      copy: { tagline: "Converted safely" },
      baseTheme: { mode: "light", accent: "#b65cff" },
    },
    css: ":root { color: #432; }",
    art: { filename: "cover.png", mimeType: "image/png", base64: "aGVsbG8=" },
    ...overrides,
  };
}

test("converts a legacy Codex package into a single-target CodeDrobe package", () => {
  const converted = convertLegacyThemePackage(legacyTheme());
  assert.equal(converted.format, "codedrobe-theme");
  assert.deepEqual(Object.keys(converted.targets), ["codex"]);
  assert.equal(converted.theme.copy.tagline, "Converted safely");
  assert.equal(converted.targets.codex.options.baseTheme.accent, "#b65cff");
  assert.equal(converted.targets.codex.options.rendererProfile, "codex-theme-v1");
  assert.equal(converted.assets.images.hero.filename, "cover.png");
  assert.match(resolveThemeTarget(converted, "codex").imageDataUrls.hero, /^data:image\/png;base64,/);
  assert.match(resolveThemeTarget(converted, "codex").css, /#432/);
});

test("writes a converted package and keeps overwrite protection", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-legacy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, "legacy.codex-theme");
  const output = path.join(directory, "legacy.codedrobe-theme");
  await fs.writeFile(input, JSON.stringify(legacyTheme()), "utf8");
  await convertLegacyThemeFile(input, output);
  const converted = await readThemePackage(output);
  assert.equal(converted.theme.id, "legacy-dream");
  await assert.rejects(() => convertLegacyThemeFile(input, output), /already exists/);
});

test("rejects unsafe legacy packages before conversion", () => {
  assert.throws(() => validateLegacyThemePackage(legacyTheme({ css: "@import 'https://example.com/x.css';" })), /external CSS/);
  const missingArt = legacyTheme();
  delete missingArt.art;
  assert.throws(() => validateLegacyThemePackage(missingArt), /artwork.*missing/);
  const mismatchedArt = legacyTheme();
  mismatchedArt.art.filename = "other.png";
  assert.throws(() => validateLegacyThemePackage(mismatchedArt), /manifest\.art must match/);
  const undeclaredArt = legacyTheme();
  undeclaredArt.manifest.art = null;
  assert.throws(() => validateLegacyThemePackage(undeclaredArt), /not declared/);
  const executableArt = legacyTheme();
  executableArt.art.mimeType = "image/svg+xml";
  assert.throws(() => validateLegacyThemePackage(executableArt), /MIME type/);
});
