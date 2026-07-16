import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  THEME_EXTENSION,
  buildThemePackage,
  readThemePackage,
  resolveThemeTarget,
  validateThemePackage,
  writeThemePackage,
} from "../src/theme/package.mjs";

const exampleManifest = new URL("../examples/dream/theme.json", import.meta.url);

test("builds one portable theme for multiple app targets", async () => {
  const { bundle, serialized } = await buildThemePackage(exampleManifest.pathname);
  assert.equal(bundle.format, "codedrobe-theme");
  assert.equal(bundle.theme.id, "dream");
  assert.deepEqual(Object.keys(bundle.targets), ["codex", "workbuddy"]);
  assert.match(bundle.targets.codex.css, /codedrobe-host-codex/);
  assert.match(bundle.targets.workbuddy.css, /codedrobe-host-workbuddy/);
  assert.ok(serialized.endsWith("\n"));
});

test("writes, reads, and resolves a .codedrobe-theme package", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-theme-"));
  const output = path.join(directory, `dream${THEME_EXTENSION}`);
  await writeThemePackage(exampleManifest.pathname, output);
  const bundle = await readThemePackage(output);
  const selected = resolveThemeTarget(bundle, "workbuddy");
  assert.equal(selected.theme.version, "1.0.0");
  assert.match(selected.css, /monaco-workbench/);
  await assert.rejects(() => writeThemePackage(exampleManifest.pathname, output), /already exists/);
});

test("rejects external CSS resources and executable-looking package variants", () => {
  const base = {
    format: "codedrobe-theme",
    schemaVersion: 1,
    theme: { id: "unsafe", displayName: "Unsafe", version: "1.0.0" },
    targets: { codex: { css: "@import url('https://example.com/theme.css');" } },
  };
  assert.throws(() => validateThemePackage(base), /external CSS resource/);
  assert.throws(() => validateThemePackage({ ...base, format: "codex-theme" }), /Unsupported theme format/);
});

test("rejects a theme that does not support the selected app", async () => {
  const { bundle } = await buildThemePackage(exampleManifest.pathname);
  assert.throws(() => resolveThemeTarget(bundle, "unknown-ai"), /does not support app/);
});
