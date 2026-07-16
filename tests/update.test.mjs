import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  checkForUpdate,
  compareVersions,
  detectPackageManager,
  formatCommand,
  getUpdateCommand,
  maybeNotifyUpdate,
  shouldNotifyUpdate,
  updateCodeDrobe,
} from "../src/update.mjs";

test("compares stable and prerelease semantic versions", () => {
  assert.equal(compareVersions("0.1.1", "0.2.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
});

test("checks the npm registry and reuses a fresh cache", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-update-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cacheFile = path.join(directory, "update.json");
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    assert.match(url, /@codedrobe%2Fcore\/latest$/);
    return { ok: true, json: async () => ({ version: "0.2.0" }) };
  };
  const now = Date.parse("2026-07-16T10:00:00.000Z");

  const registry = await checkForUpdate({ cacheFile, currentVersion: "0.1.1", fetchImpl, now });
  assert.deepEqual(registry, {
    packageName: "@codedrobe/core",
    current: "0.1.1",
    latest: "0.2.0",
    updateAvailable: true,
    checkedAt: "2026-07-16T10:00:00.000Z",
    source: "registry",
  });

  const cached = await checkForUpdate({ cacheFile, currentVersion: "0.1.1", fetchImpl, now: now + 60_000 });
  assert.equal(cached.source, "cache");
  assert.equal(requests, 1);
});

test("selects npm, Bun, and pnpm global update commands", () => {
  assert.equal(detectPackageManager({ packageRoot: "/usr/local/lib/node_modules/@codedrobe/core", env: {}, versions: {} }), "npm");
  assert.equal(detectPackageManager({ packageRoot: "/usr/local/lib/node_modules/@codedrobe/core", env: {}, versions: { bun: "1.3.11" } }), "npm");
  assert.equal(detectPackageManager({ packageRoot: "/Users/me/.bun/install/global/node_modules/@codedrobe/core", env: {}, versions: {} }), "bun");
  assert.equal(detectPackageManager({ packageRoot: "/Users/me/pnpm/global/5/node_modules/@codedrobe/core", env: {}, versions: {} }), "pnpm");
  assert.equal(formatCommand(getUpdateCommand("npm")), "npm install --global @codedrobe/core@latest");
  assert.equal(formatCommand(getUpdateCommand("bun")), "bun add --global @codedrobe/core@latest");
  assert.equal(formatCommand(getUpdateCommand("pnpm")), "pnpm add --global @codedrobe/core@latest");
});

test("explicit update runs the selected package manager only when a newer version exists", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-self-update-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const result = await updateCodeDrobe({
    packageManager: "bun",
    runner: async (...args) => calls.push(args),
    checkOptions: {
      cacheFile: path.join(directory, "update.json"),
      currentVersion: "0.1.1",
      fetchImpl: async () => ({ ok: true, json: async () => ({ version: "0.2.0" }) }),
    },
  });
  assert.equal(result.updated, true);
  assert.deepEqual(calls, [["bun", ["add", "--global", "@codedrobe/core@latest"], { quiet: false }]]);
});

test("automatic notifications are limited to interactive global installations", () => {
  const base = {
    command: "apps",
    env: {},
    packageRoot: "/usr/local/lib/node_modules/@codedrobe/core",
    stderrIsTTY: true,
  };
  assert.equal(shouldNotifyUpdate(base), true);
  assert.equal(shouldNotifyUpdate({ ...base, json: true }), false);
  assert.equal(shouldNotifyUpdate({ ...base, env: { CI: "1" } }), false);
  assert.equal(shouldNotifyUpdate({ ...base, env: { NO_UPDATE_NOTIFIER: "1" } }), false);
  assert.equal(shouldNotifyUpdate({ ...base, command: "update" }), false);
  assert.equal(shouldNotifyUpdate({ ...base, packageRoot: "/project/node_modules/@codedrobe/core" }), false);
  assert.equal(shouldNotifyUpdate({ ...base, stderrIsTTY: false }), false);
});

test("automatic notification prints a cached update hint and ignores check failures", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-notifier-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const messages = [];
  const base = {
    command: "apps",
    env: {},
    packageRoot: "/usr/local/lib/node_modules/@codedrobe/core",
    stderr: (message) => messages.push(message),
    stderrIsTTY: true,
  };
  const status = await maybeNotifyUpdate({
    ...base,
    checkOptions: {
      cacheFile: path.join(directory, "update.json"),
      currentVersion: "0.1.1",
      fetchImpl: async () => ({ ok: true, json: async () => ({ version: "0.2.0" }) }),
    },
  });
  assert.equal(status.updateAvailable, true);
  assert.deepEqual(messages, ["[codedrobe] Update available 0.1.1 → 0.2.0. Run: npm install --global @codedrobe/core@latest"]);

  const failed = await maybeNotifyUpdate({
    ...base,
    checkOptions: {
      cacheFile: path.join(directory, "missing.json"),
      fetchImpl: async () => { throw new Error("offline"); },
    },
  });
  assert.equal(failed, null);
  assert.equal(messages.length, 1);
});
