import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../src/adapters/index.mjs";
import { applyCodexBaseTheme } from "../src/host/codex-settings.mjs";
import { applySkin, restoreSkin } from "../src/runtime/skin.mjs";

const original = `model = "gpt"\n\n[desktop]\nappearanceTheme = "dark"\nunrelated = true\n`;
const targetTheme = {
  theme: { id: "legacy-dream", displayName: "Legacy Dream", version: "1.0.0" },
  css: ":root.codedrobe-codex-skin { color: #432; }",
  options: {
    rendererProfile: "codex-theme-v1",
    baseTheme: { mode: "light", accent: "#b65cff" },
  },
  verification: null,
  artDataUrl: null,
};

async function emptyCdpServer(t) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return server.address().port;
}

async function readyCdpServer(t) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify([{
      id: "ready-target",
      type: "page",
      title: "Ready",
      url: "app://-/index.html",
      webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/page/ready-target",
    }]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return server.address().port;
}

test("skin application requires an explicit restart when live host settings changed", async (t) => {
  let rolledBack = false;
  const port = await readyCdpServer(t);
  const adapter = {
    id: "restart-test",
    displayName: "Restart Test",
    defaultPort: port,
    platforms: {},
    matchTarget: () => true,
    hostSettings: {
      async apply() {
        return {
          supported: true,
          applied: true,
          changed: true,
          restartRequired: true,
          async rollback() { rolledBack = true; },
        };
      },
      async restore() { return { supported: true, restored: false }; },
    },
  };

  await assert.rejects(
    applySkin({ adapter, targetTheme, port }),
    (error) => {
      assert.equal(error.code, "CODEDROBE_RESTART_REQUIRED");
      assert.equal(error.port, port);
      return true;
    },
  );
  assert.equal(rolledBack, true);
});

test("skin application rolls back Codex host settings when renderer injection fails", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-skin-rollback-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.toml");
  const backupPath = path.join(directory, "state", "config.before-codedrobe.toml");
  await fs.writeFile(configPath, original, "utf8");
  const port = await emptyCdpServer(t);

  await assert.rejects(
    applySkin({
      adapter: getAdapter("codex"),
      targetTheme,
      port,
      launch: false,
      timeoutMs: 250,
      hostOptions: { configPath, backupPath },
    }),
    (error) => error.code === "CODEDROBE_TARGET_TIMEOUT",
  );

  assert.equal(await fs.readFile(configPath, "utf8"), original);
  await assert.rejects(() => fs.access(backupPath), /ENOENT/);
});

test("skin restore recovers Codex settings even when no renderer is available", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-skin-restore-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.toml");
  const backupPath = path.join(directory, "state", "config.before-codedrobe.toml");
  await fs.writeFile(configPath, original, "utf8");
  await applyCodexBaseTheme({
    targetTheme,
    platform: "darwin",
    options: { configPath, backupPath },
  });
  const port = await emptyCdpServer(t);

  const result = await restoreSkin({
    adapter: getAdapter("codex"),
    port,
    timeoutMs: 250,
    hostOptions: { configPath, backupPath },
  });

  assert.equal(result.renderer.restored, false);
  assert.equal(result.host.restored, true);
  const restored = await fs.readFile(configPath, "utf8");
  assert.match(restored, /appearanceTheme = "dark"/);
  assert.match(restored, /unrelated = true/);
  assert.doesNotMatch(restored, /appearanceTheme = "light"/);
  assert.doesNotMatch(restored, /appearanceLightChromeTheme/);
  await assert.rejects(() => fs.access(backupPath), /ENOENT/);
});
