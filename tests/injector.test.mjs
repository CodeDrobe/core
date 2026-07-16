import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getAdapter } from "../src/adapters/index.mjs";
import { waitForTargets, watchTheme } from "../src/runtime/injector.mjs";

test("target wait respects a short timeout and returns structured diagnostics", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const startedAt = Date.now();

  await assert.rejects(
    waitForTargets(getAdapter("workbuddy"), address.port, 300),
    (error) => {
      assert.equal(error.code, "CODEDROBE_TARGET_TIMEOUT");
      assert.equal(error.port, address.port);
      assert.equal(error.timeoutMs, 300);
      assert.match(error.message, /within 300ms/);
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 1000);
});

test("theme watcher can be owned and stopped by an AbortSignal", async () => {
  const controller = new AbortController();
  controller.abort();
  const adapter = getAdapter("codex");
  const startedAt = Date.now();

  await watchTheme({
    adapter,
    targetTheme: {
      theme: { id: "signal-test", displayName: "Signal test", version: "1.0.0" },
      css: "",
      options: {},
      verification: null,
      artDataUrl: null,
    },
    port: adapter.defaultPort,
    signal: controller.signal,
  });

  assert.ok(Date.now() - startedAt < 250);
});
