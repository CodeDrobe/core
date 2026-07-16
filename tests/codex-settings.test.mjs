import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyCodexBaseTheme,
  applyCodexSettings,
  buildCodexBaseThemeSettings,
  defaultCodexSettingsPaths,
  restoreCodexBaseTheme,
  restoreCodexSettings,
} from "../src/host/codex-settings.mjs";

const original = `model = "gpt"\n\n[desktop]\nunrelated = true\nappearanceTheme = "dark"\n\n[other]\nkeep = "yes"\n`;
const targetTheme = {
  options: {
    baseTheme: {
      mode: "light",
      codeTheme: "codex",
      accent: "#b65cff",
      contrast: 72,
      fonts: { macCode: "SF Mono", macUi: "PingFang SC" },
      semanticColors: { diffAdded: "#bce8cf", diffRemoved: "#f7b8ce", skill: "#c47bff" },
    },
  },
};

test("Codex settings keep the legacy CodeDrobe backup location for migration", () => {
  assert.equal(
    defaultCodexSettingsPaths({ platform: "darwin", home: "/Users/example" }).backupPath,
    "/Users/example/Library/Application Support/CodeDrobe/config.before-codedrobe.toml",
  );
  assert.equal(
    defaultCodexSettingsPaths({ platform: "win32", home: "C:\\Users\\example", env: { LOCALAPPDATA: "C:\\Local" } }).backupPath,
    path.join("C:\\Local", "CodeDrobe", "config.before-codedrobe.toml"),
  );
});

test("Codex settings update only managed desktop keys and restore them", () => {
  const settings = buildCodexBaseThemeSettings(targetTheme.options.baseTheme, "darwin");
  const duplicated = original.replace(
    'appearanceTheme = "dark"',
    'appearanceTheme = "dark"\nappearanceTheme = "light"\nappearanceLightCodeThemeId = "old"',
  );
  const applied = applyCodexSettings(duplicated, settings);
  for (const key of Object.keys(settings)) {
    assert.equal((applied.match(new RegExp(`^${key}\\s*=`, "gm")) ?? []).length, 1);
  }
  assert.match(applied, /unrelated = true/);
  assert.match(applied, /\[other\]\nkeep = "yes"/);
  assert.match(applied, /accent = "#b65cff"/);

  const restored = restoreCodexSettings(applied, original);
  assert.match(restored, /appearanceTheme = "dark"/);
  assert.doesNotMatch(restored, /appearanceLightCodeThemeId/);
  assert.doesNotMatch(restored, /appearanceLightChromeTheme/);
  assert.match(restored, /unrelated = true/);
  assert.match(restored, /\[other\]\nkeep = "yes"/);
});

test("Codex settings preserve unrelated tables and expanded Chrome theme tables", () => {
  const expanded = `appearanceTheme = "misplaced"\n\n[desktop]\nappearanceTheme = "dark"\nunrelated = true\n\n[desktop.appearanceLightChromeTheme]\naccent = "#123456"\ncontrast = 55\n\n[desktop.appearanceLightChromeTheme.fonts]\ncode = "Original Mono"\nui = "Original UI"\n\n[other]\nappearanceTheme = "other-table-value"\nkeep = "yes"\n`;
  const settings = buildCodexBaseThemeSettings(targetTheme.options.baseTheme, "darwin");
  const applied = applyCodexSettings(expanded, settings);

  assert.doesNotMatch(applied, /^appearanceTheme = "misplaced"/m);
  assert.doesNotMatch(applied, /^\[desktop\.appearanceLightChromeTheme/m);
  assert.match(applied, /\[other\]\nappearanceTheme = "other-table-value"\nkeep = "yes"/);

  const restored = restoreCodexSettings(applied, expanded);
  assert.match(restored, /\[desktop\.appearanceLightChromeTheme\]\naccent = "#123456"\ncontrast = 55/);
  assert.match(restored, /\[desktop\.appearanceLightChromeTheme\.fonts\]\ncode = "Original Mono"\nui = "Original UI"/);
  assert.match(restored, /\[other\]\nappearanceTheme = "other-table-value"\nkeep = "yes"/);
  assert.match(restored, /appearanceTheme = "dark"/);
  assert.doesNotMatch(restored, /appearanceLightChromeTheme = \{/);
});

test("Codex base theme apply is transactional and restore consumes the backup", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-codex-settings-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.toml");
  const backupPath = path.join(directory, "state", "config.before-codedrobe.toml");
  await fs.writeFile(configPath, original, "utf8");

  const transaction = await applyCodexBaseTheme({
    targetTheme,
    platform: "darwin",
    options: { configPath, backupPath },
  });
  assert.equal(transaction.applied, true);
  assert.equal(transaction.backupCreated, true);
  assert.equal(await fs.readFile(backupPath, "utf8"), original);
  assert.match(await fs.readFile(configPath, "utf8"), /appearanceTheme = "light"/);

  await transaction.rollback();
  assert.equal(await fs.readFile(configPath, "utf8"), original);
  await assert.rejects(() => fs.access(backupPath), /ENOENT/);

  await applyCodexBaseTheme({ targetTheme, platform: "darwin", options: { configPath, backupPath } });
  const result = await restoreCodexBaseTheme({ platform: "darwin", options: { configPath, backupPath } });
  assert.equal(result.restored, true);
  assert.match(await fs.readFile(configPath, "utf8"), /appearanceTheme = "dark"/);
  assert.match(await fs.readFile(configPath, "utf8"), /unrelated = true/);
  await assert.rejects(() => fs.access(backupPath), /ENOENT/);
});

test("Codex settings keep the desktop table terminated when the backup has no managed keys", () => {
  const pristine = `model = "gpt"\n\n[desktop]\nunrelated = true\ndock-icon-preference = "codex-system"\n\n[desktop.open-in-target-preferences]\nglobal = "cursor"\n`;
  const settings = buildCodexBaseThemeSettings(targetTheme.options.baseTheme, "darwin");
  const applied = applyCodexSettings(pristine, settings);
  const restored = restoreCodexSettings(applied, pristine);

  assert.match(restored, /^dock-icon-preference = "codex-system"$/m);
  assert.match(restored, /^\[desktop\.open-in-target-preferences\]$/m);
  assert.match(restored, /\[desktop\.open-in-target-preferences\]\nglobal = "cursor"/);
});
