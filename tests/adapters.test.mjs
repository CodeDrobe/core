import test from "node:test";
import assert from "node:assert/strict";
import { getAdapter, listAdapters, registerAdapter } from "../src/adapters/index.mjs";

test("built-in adapters have unique ids and ports", () => {
  const adapters = listAdapters();
  assert.deepEqual(adapters.map((adapter) => adapter.id), ["codex", "workbuddy"]);
  assert.equal(new Set(adapters.map((adapter) => adapter.defaultPort)).size, adapters.length);
});

test("Codex target matcher accepts only app pages", () => {
  const adapter = getAdapter("codex");
  assert.equal(adapter.matchTarget({ type: "page", url: "app://codex/home" }), true);
  assert.equal(adapter.matchTarget({ type: "page", url: "file:///tmp/index.html" }), false);
  assert.equal(adapter.matchTarget({ type: "worker", url: "app://codex/worker" }), false);
});

test("WorkBuddy target matcher accepts local renderer schemes and rejects DevTools", () => {
  const adapter = getAdapter("workbuddy");
  assert.equal(adapter.matchTarget({ type: "page", url: "vscode-file://workbench/index.html" }), true);
  assert.equal(adapter.matchTarget({ type: "page", url: "workbuddy://desktop/home" }), true);
  assert.equal(adapter.matchTarget({ type: "page", url: "devtools://devtools/bundled/inspector.html", title: "WorkBuddy" }), false);
});

test("adapter registration validates and prevents duplicate ids", () => {
  assert.throws(() => registerAdapter({ id: "broken" }), /matchTarget/);
  assert.throws(() => registerAdapter({ id: "codex", matchTarget() {} }), /already registered/);
});
