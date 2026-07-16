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

test("Codex verification keeps only current cross-route landmarks", () => {
  const adapter = getAdapter("codex");
  assert.deepEqual(adapter.lastVerified.darwin, {
    appVersion: "26.707.72221",
    build: "5307",
    verifiedAt: "2026-07-16",
  });
  assert.deepEqual(adapter.verification.rootAny, ["main.main-surface"]);
  assert.deepEqual(adapter.verification.required, [
    { name: "sidebar", any: ["aside.app-shell-left-panel"] },
    { name: "composer", any: [".composer-surface-chrome"] },
  ]);
  assert.doesNotMatch(JSON.stringify(adapter.verification), /"main"|"aside"|contenteditable|textarea/);
});

test("WorkBuddy target matcher accepts its actual local renderer and rejects unrelated pages", () => {
  const adapter = getAdapter("workbuddy");
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "WorkBuddy",
    url: "file:///Applications/WorkBuddy.app/Contents/Resources/app.asar/renderer/index.html",
  }), true);
  assert.equal(adapter.matchTarget({ type: "page", url: "vscode-file://workbench/index.html" }), true);
  assert.equal(adapter.matchTarget({ type: "page", url: "workbuddy://desktop/home" }), true);
  assert.equal(adapter.matchTarget({ type: "page", url: "devtools://devtools/bundled/inspector.html", title: "WorkBuddy" }), false);
  assert.equal(adapter.matchTarget({ type: "page", url: "file:///tmp/unrelated/index.html" }), false);
});

test("WorkBuddy verification uses selectors observed in the real renderer", () => {
  const adapter = getAdapter("workbuddy");
  assert.deepEqual(adapter.lastVerified.darwin, { appVersion: "5.2.6", build: "5.2.6", verifiedAt: "2026-07-16" });
  assert.match(adapter.verification.rootAny.join(" "), /teams-container/);
  assert.match(adapter.verification.required.find((item) => item.name === "sidebar").any.join(" "), /conversation-sidebar/);
  assert.match(adapter.verification.required.find((item) => item.name === "workspace").any.join(" "), /teams-main-content/);
  assert.match(adapter.verification.required.find((item) => item.name === "composer").any.join(" "), /role='textbox'/);
  assert.doesNotMatch(JSON.stringify(adapter.verification), /monaco-workbench/);
});

test("adapter registration validates and prevents duplicate ids", () => {
  assert.throws(() => registerAdapter({ id: "broken" }), /matchTarget/);
  assert.throws(() => registerAdapter({ id: "codex", matchTarget() {} }), /already registered/);
});
