import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../src/adapters/index.mjs";
import { discoverApp, launchApp } from "../src/runtime/launcher.mjs";

test("custom app path accepts a macOS app bundle or executable", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-app-path-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const appPath = path.join(directory, "Custom WorkBuddy.app");
  const executable = path.join(appPath, "Contents", "MacOS", "Electron");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, "test executable");

  const adapter = getAdapter("workbuddy");
  assert.deepEqual(await discoverApp(adapter, "darwin", appPath), {
    appId: "workbuddy",
    appPath,
    executable,
  });
  assert.deepEqual(await discoverApp(adapter, "darwin", executable), {
    appId: "workbuddy",
    appPath: path.dirname(executable),
    executable,
  });
});

test("custom app path does not fall back to default discovery", async () => {
  const adapter = getAdapter("workbuddy");
  assert.equal(await discoverApp(adapter, "darwin", "/missing/WorkBuddy.app"), null);
});

test("launcher reports an occupied custom CDP port before spawning", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-port-conflict-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, "WorkBuddy");
  await fs.writeFile(executable, "test executable");

  const server = http.createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;

  await assert.rejects(
    launchApp({ adapter: getAdapter("workbuddy"), appPath: executable, port, timeoutMs: 500 }),
    (error) => {
      assert.equal(error.code, "CODEDROBE_PORT_OCCUPIED");
      assert.equal(error.port, port);
      assert.match(error.message, new RegExp(`Port ${port} is already occupied`));
      return true;
    },
  );
});
