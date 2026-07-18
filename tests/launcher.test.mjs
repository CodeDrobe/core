import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "../src/adapters/index.mjs";
import { discoverApp, launchApp, resolveDebugPort, resolveDebugPorts } from "../src/runtime/launcher.mjs";

function portFileAdapter(portFile) {
  return {
    id: "portfile-test",
    displayName: "PortFile Test",
    defaultPort: 9440,
    // launchApp resolves port files for process.platform, so the config must
    // live under the platform the test actually runs on (CI is Linux).
    platforms: { [process.platform]: { devToolsActivePortFile: portFile } },
    matchTarget(target) {
      return target?.type === "page" && /portfile-test/.test(String(target.url ?? ""));
    },
  };
}

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

test("resolveDebugPort reads the DevToolsActivePort file and rejects garbage", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-port-file-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const portFile = path.join(directory, "DevToolsActivePort");

  const adapter = portFileAdapter(portFile);
  assert.equal(await resolveDebugPort(adapter, process.platform), null, "missing file resolves to null");

  await fs.writeFile(portFile, "51234\n/devtools/browser/abc-def\n");
  assert.equal(await resolveDebugPort(adapter, process.platform), 51234);

  await fs.writeFile(portFile, "not-a-port\n");
  assert.equal(await resolveDebugPort(adapter, process.platform), null, "garbage resolves to null");

  await fs.writeFile(portFile, "80\n");
  assert.equal(await resolveDebugPort(adapter, process.platform), null, "privileged ports are rejected");

  assert.equal(await resolveDebugPort(getAdapter("workbuddy"), "darwin"), null, "adapters without a port file resolve to null");
});

test("resolveDebugPorts reads every configured edition file and dedupes", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-port-files-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cnFile = path.join(directory, "cn", "DevToolsActivePort");
  const globalFile = path.join(directory, "global", "DevToolsActivePort");
  await fs.mkdir(path.dirname(cnFile), { recursive: true });
  await fs.mkdir(path.dirname(globalFile), { recursive: true });

  const adapter = {
    id: "portfiles-test",
    displayName: "PortFiles Test",
    defaultPort: 9441,
    platforms: { darwin: { devToolsActivePortFile: [cnFile, globalFile] } },
    matchTarget: () => false,
  };
  assert.deepEqual(await resolveDebugPorts(adapter, "darwin"), [], "missing files resolve to an empty list");

  await fs.writeFile(globalFile, "52001\n/devtools/browser/xyz\n");
  assert.deepEqual(await resolveDebugPorts(adapter, "darwin"), [52001], "later candidates still resolve when earlier files are absent");

  await fs.writeFile(cnFile, "52001\n/devtools/browser/abc\n");
  assert.deepEqual(await resolveDebugPorts(adapter, "darwin"), [52001], "duplicate ports are deduped");

  await fs.writeFile(cnFile, "52000\n/devtools/browser/abc\n");
  assert.deepEqual(await resolveDebugPorts(adapter, "darwin"), [52000, 52001]);
});

test("macOS discovery derives per-edition executables from the bundle name", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-derived-exe-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const appPath = path.join(directory, "Custom Edition.app");
  const executable = path.join(appPath, "Contents", "MacOS", "Custom Edition");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, "test executable");

  const adapter = {
    id: "derived-exe-test",
    displayName: "Derived Exe Test",
    defaultPort: 9442,
    platforms: {
      darwin: {
        appCandidates: [appPath],
        // Points at another edition's binary; the bundle-derived name must win.
        executableRelative: "Contents/MacOS/Other Edition",
      },
    },
    matchTarget: () => false,
  };
  assert.deepEqual(await discoverApp(adapter, "darwin"), {
    appId: "derived-exe-test",
    appPath,
    executable,
  });
});

test("launcher finds an already-running app on its self-published debug port", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-port-file-ready-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const server = http.createServer((request, response) => {
    if (request.url === "/json/list") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify([
        { id: "1", type: "page", title: "PortFile Test", url: "file:///portfile-test/index.html", webSocketDebuggerUrl: "ws://127.0.0.1/1" },
      ]));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const livePort = server.address().port;

  const portFile = path.join(directory, "DevToolsActivePort");
  await fs.writeFile(portFile, `${livePort}\n/devtools/browser/abc-def\n`);

  // The requested default port serves nothing; the port file points at the
  // live endpoint, so launch must report ready on the discovered port.
  const result = await launchApp({ adapter: portFileAdapter(portFile), timeoutMs: 2000 });
  assert.equal(result.alreadyReady, true);
  assert.equal(result.port, livePort);
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
