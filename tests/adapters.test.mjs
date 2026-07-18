import test from "node:test";
import assert from "node:assert/strict";
import { getAdapter, listAdapters, registerAdapter } from "../src/adapters/index.mjs";

test("built-in adapters have unique ids and ports", () => {
  const adapters = listAdapters();
  assert.deepEqual(adapters.map((adapter) => adapter.id), ["codex", "workbuddy", "qoderwork", "traework"]);
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
  // Only the root landmark blocks: the sidebar collapses and other panels are
  // route-dependent, so every other landmark is warning-level.
  assert.equal(adapter.verification.required, undefined);
  assert.deepEqual(adapter.verification.recommended, [
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
  // Only the root landmark blocks; panels hide per view/window so all other
  // landmarks are warning-level.
  assert.equal(adapter.verification.required, undefined);
  assert.match(adapter.verification.recommended.find((item) => item.name === "sidebar").any.join(" "), /conversation-sidebar/);
  assert.match(adapter.verification.recommended.find((item) => item.name === "workspace").any.join(" "), /teams-main-content/);
  assert.match(adapter.verification.recommended.find((item) => item.name === "composer").any.join(" "), /role='textbox'/);
  assert.doesNotMatch(JSON.stringify(adapter.verification), /monaco-workbench/);
});

test("QoderWork target matcher accepts the main renderer and rejects auxiliary windows", () => {
  const adapter = getAdapter("qoderwork");
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "QoderWork",
    url: "file:///Applications/QoderWork%20CN.app/Contents/Resources/app.asar/out/renderer/index.html",
  }), true);
  // The app rewrites the window id between hash and query forms at runtime.
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "QoderWork",
    url: "file:///Applications/QoderWork%20CN.app/Contents/Resources/app.asar/out/renderer/index.html#windowId=main",
  }), true);
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "QoderWork",
    url: "file:///Applications/QoderWork%20CN.app/Contents/Resources/app.asar/out/renderer/index.html?windowId=main",
  }), true);
  assert.equal(adapter.matchTarget({ type: "page", title: "QoderWork", url: "" }), true);
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "QoderWork",
    url: "file:///Applications/QoderWork%20CN.app/Contents/Resources/app.asar/out/renderer/quickpick.html",
  }), false);
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "QoderWork",
    url: "file:///Applications/QoderWork%20CN.app/Contents/Resources/app.asar/out/renderer/artifact-preview.html",
  }), false);
  // Global-edition paths (macOS without the CN suffix, and Windows).
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "QoderWork",
    url: "file:///Applications/QoderWork.app/Contents/Resources/app.asar/out/renderer/index.html?windowId=main",
  }), true);
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "QoderWork",
    url: "file:///C:/Users/dev/AppData/Local/Programs/QoderWork/resources/app.asar/out/renderer/index.html",
  }), true);
  assert.equal(adapter.matchTarget({ type: "page", url: "devtools://devtools/bundled/inspector.html", title: "QoderWork" }), false);
  assert.equal(adapter.matchTarget({ type: "page", url: "file:///tmp/unrelated/index.html" }), false);
  assert.equal(adapter.matchTarget({ type: "worker", title: "QoderWork", url: "" }), false);
});

test("QoderWork covers both editions on macOS and Windows", () => {
  const adapter = getAdapter("qoderwork");
  assert.deepEqual(adapter.platforms.darwin.bundleIds, ["com.qoder.work.cn", "com.qoder.work"]);
  assert.ok(adapter.platforms.darwin.appCandidates.includes("/Applications/QoderWork.app"));
  // The host forces remote-debugging-port=0 in every edition, so the live
  // port must be read from each edition's DevToolsActivePort file.
  assert.deepEqual(adapter.platforms.darwin.devToolsActivePortFile, [
    "~/Library/Application Support/QoderWork CN/DevToolsActivePort",
    "~/Library/Application Support/QoderWork/DevToolsActivePort",
  ]);
  assert.ok(adapter.platforms.win32.executableCandidates.some((item) => item.endsWith("QoderWork.exe")));
  assert.ok(adapter.platforms.win32.uninstallKeys.includes("com.qoder.work"));
  assert.ok(Array.isArray(adapter.platforms.win32.devToolsActivePortFile));
  // Only the CN macOS edition has passed a real-app verification.
  assert.deepEqual(Object.keys(adapter.lastVerified), ["darwin"]);
});

test("QoderWork verification keeps only cross-route landmarks", () => {
  const adapter = getAdapter("qoderwork");
  assert.deepEqual(adapter.lastVerified.darwin, { appVersion: "0.9.12", build: "0.9.12", verifiedAt: "2026-07-19" });
  assert.match(adapter.verification.rootAny.join(" "), /agents-layout-root/);
  // Only the root landmark blocks; panels hide per view/window so all other
  // landmarks are warning-level.
  assert.equal(adapter.verification.required, undefined);
  assert.match(adapter.verification.recommended.find((item) => item.name === "sidebar").any.join(" "), /agents-sidebar/);
  assert.match(adapter.verification.recommended.find((item) => item.name === "workspace").any.join(" "), /agents-content-area/);
  assert.ok(adapter.verification.recommended.find((item) => item.name === "composer"));
});

test("TRAE SOLO covers both editions on macOS and Windows", () => {
  const adapter = getAdapter("traework");
  assert.deepEqual(adapter.platforms.darwin.bundleIds, ["com.trae.solo.app", "cn.trae.solo.app"]);
  assert.ok(adapter.platforms.darwin.appCandidates.includes("/Applications/TRAE SOLO CN.app"));
  assert.ok(adapter.platforms.win32.executableCandidates.some((item) => item.endsWith("TRAE SOLO CN.exe")));
  // Inno Setup uninstall keys are the product.json AppId GUIDs plus "_is1".
  assert.ok(adapter.platforms.win32.uninstallKeys.every((key) => /^\{[0-9A-F-]+\}_is1$/.test(key)));
  assert.equal(adapter.platforms.win32.uninstallKeys.length, 8);
  // Only the global macOS edition has passed a real-app verification.
  assert.deepEqual(Object.keys(adapter.lastVerified), ["darwin"]);
});

test("TRAE SOLO target matcher accepts only the solo-lite shell", () => {
  const adapter = getAdapter("traework");
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "TRAE Work",
    url: "vscode-file://vscode-app/Applications/TRAE%20SOLO.app/Contents/Resources/app/out/vs/code/electron-browser/solo/solo-lite.html",
  }), true);
  // CN edition on macOS and a Windows install path.
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "TRAE Work",
    url: "vscode-file://vscode-app/Applications/TRAE%20SOLO%20CN.app/Contents/Resources/app/out/vs/code/electron-browser/solo/solo-lite.html",
  }), true);
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "TRAE Work",
    url: "vscode-file://vscode-app/C%3A/Users/dev/AppData/Local/Programs/TRAE%20SOLO%20CN/resources/app/out/vs/code/electron-browser/solo/solo-lite.html",
  }), true);
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "Process Explorer",
    url: "vscode-file://vscode-app/Applications/TRAE%20SOLO.app/Contents/Resources/app/out/vs/code/electron-browser/icubeProcessExplorer/icubeProcessExplorer.html",
  }), false);
  assert.equal(adapter.matchTarget({
    type: "page",
    title: "TRAE Work",
    url: "vscode-file://vscode-app/Applications/TRAE%20SOLO.app/Contents/Resources/app/out/vs/code/electron-browser/filePreview/file-preview.html",
  }), false);
  assert.equal(adapter.matchTarget({ type: "page", url: "devtools://devtools/bundled/inspector.html", title: "TRAE Work" }), false);
  assert.equal(adapter.matchTarget({ type: "page", url: "file:///tmp/unrelated/index.html" }), false);
  assert.equal(adapter.matchTarget({ type: "iframe", url: "vscode-file://vscode-app/x/electron-browser/solo/solo-lite.html" }), false);
});

test("TRAE SOLO verification keeps only cross-route solo-lite landmarks", () => {
  const adapter = getAdapter("traework");
  assert.deepEqual(adapter.lastVerified.darwin, { appVersion: "0.1.36", build: "ce5758dc", verifiedAt: "2026-07-19" });
  // Home routes render .panel-container; conversations render
  // .solo-lite-layout — the root any-list must cover both.
  assert.deepEqual(adapter.verification.rootAny, ["#root .panel-container", "#root .solo-lite-layout", "#root"]);
  // Only the root landmark blocks; panels hide per view/window so all other
  // landmarks are warning-level.
  assert.equal(adapter.verification.required, undefined);
  assert.match(adapter.verification.recommended.find((item) => item.name === "sidebar").any.join(" "), /task-list-base/);
  assert.match(adapter.verification.recommended.find((item) => item.name === "workspace").any.join(" "), /solo-lite-layout/);
  assert.match(adapter.verification.recommended.find((item) => item.name === "composer").any.join(" "), /chat-input-v2-input-box-editable/);
  // The Monaco workbench never hosts the solo UI; keep it out of landmarks.
  assert.doesNotMatch(JSON.stringify(adapter.verification), /monaco-workbench/);
});

test("adapter registration validates and prevents duplicate ids", () => {
  assert.throws(() => registerAdapter({ id: "broken" }), /matchTarget/);
  assert.throws(() => registerAdapter({ id: "codex", matchTarget() {} }), /already registered/);
});
