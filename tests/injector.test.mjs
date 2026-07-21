import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getAdapter } from "../src/adapters/index.mjs";
import { markSecondaryTargets, waitForTargets, watchTheme } from "../src/runtime/injector.mjs";

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

test("secondary targets are skipped only while a primary window exists", () => {
  const isCompatible = (item) => item.result?.compatible === true;
  const main = { targetId: "main", url: "app://-/index.html", result: { compatible: true } };
  const overlay = {
    targetId: "overlay",
    url: "app://-/index.html?initialRoute=%2Fhidden-surface",
    result: { compatible: false, missing: [{ scope: "adapter", name: "root", selectors: ["main"] }] },
  };

  // Probe semantics: an incompatible sibling of a compatible main window is
  // informational, matching how applyTheme themes one and skips the other.
  const demoted = markSecondaryTargets([main, overlay], isCompatible);
  assert.equal(demoted[0].skipped, undefined);
  assert.equal(demoted[1].skipped, true);
  assert.deepEqual(demoted[1].result.missing, overlay.result.missing);

  // With zero compatible targets nothing is demoted: a broken main window
  // must keep failing loudly.
  const broken = markSecondaryTargets([overlay], isCompatible);
  assert.equal(broken[0].skipped, undefined);

  // Verify semantics: a themed window stays primary even if its landmarks
  // broke after apply, so regressions on installed windows are never skipped.
  const installedButBroken = { targetId: "themed", result: { compatible: false, installed: true, pass: false } };
  const verified = markSecondaryTargets(
    [installedButBroken, overlay],
    (item) => item.result?.compatible === true || item.result?.installed === true,
  );
  assert.equal(verified[0].skipped, undefined);
  assert.equal(verified[1].skipped, true);
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
