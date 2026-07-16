import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { getAdapter } from "../src/adapters/index.mjs";
import { buildApplyExpression, buildRemoveExpression, buildVerifyExpression } from "../src/runtime/renderer-payload.mjs";

class ClassList extends Set {
  add(...names) {
    for (const name of names) super.add(name);
    return this;
  }
  remove(...names) { for (const name of names) this.delete(name); }
  contains(name) { return this.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.has(name) : Boolean(force);
    if (enabled) this.add(name); else this.delete(name);
    return enabled;
  }
}

class Style {
  values = new Map();
  get length() { return this.values.size; }
  item(index) { return [...this.values.keys()][index] ?? ""; }
  setProperty(name, value) { this.values.set(name, value); }
  removeProperty(name) { this.values.delete(name); }
  getPropertyValue(name) { return this.values.get(name) ?? ""; }
}

class Element {
  constructor(document, tag = "div") {
    this.document = document;
    this.tag = tag;
    this.id = "";
    this.dataset = {};
    this.style = new Style();
    this.classList = new ClassList();
    this.parentElement = null;
    this.childrenBySelector = new Map();
    this.textContent = "";
  }
  setAttribute() {}
  set innerHTML(_value) {
    for (const selector of [".dream-brand-title", ".dream-brand-subtitle", ".dream-signature", ".dream-ribbon-emoji"]) {
      this.childrenBySelector.set(selector, new Element(this.document));
    }
  }
  querySelector(selector) { return this.childrenBySelector.get(selector) ?? null; }
  appendChild(child) {
    child.parentElement = this;
    if (child.id) this.document.ids.set(child.id, child);
    return child;
  }
  remove() {
    if (this.id) this.document.ids.delete(this.id);
    this.parentElement = null;
  }
  getBoundingClientRect() { return { left: 80, top: 0, width: 1120, height: 800 }; }
}

function browserContext() {
  const ids = new Map();
  const revokedUrls = [];
  let objectUrlSequence = 0;
  const document = { ids };
  const root = new Element(document, "html");
  root.scrollWidth = 1200;
  root.clientWidth = 1200;
  const body = new Element(document, "body");
  const head = new Element(document, "head");
  const shell = new Element(document, "main");
  const home = new Element(document, "main");
  const sidebar = new Element(document, "aside");
  const composer = new Element(document, "div");
  document.documentElement = root;
  document.body = body;
  document.head = head;
  document.createElement = (tag) => new Element(document, tag);
  document.getElementById = (id) => ids.get(id) ?? null;
  document.querySelector = (selector) => {
    if (selector === "main.main-surface" || selector === "main") return shell;
    if (selector === "aside.app-shell-left-panel") return sidebar;
    if (selector === ".composer-surface-chrome") return composer;
    if (selector === '[role="main"]:has([data-testid="home-icon"])') return home;
    if (selector === '[role="main"].dream-home') return home.classList.contains("dream-home") ? home : null;
    return null;
  };
  document.querySelectorAll = (selector) => {
    if (selector === '[role="main"].dream-home' || selector === ".dream-home") {
      return home.classList.contains("dream-home") ? [home] : [];
    }
    if (selector === ".dream-home-shell") {
      return [shell, ids.get("codedrobe-codex-skin-chrome")].filter((node) => node?.classList.contains("dream-home-shell"));
    }
    return [];
  };
  const context = {
    document,
    window: {},
    innerWidth: 1200,
    innerHeight: 800,
    getComputedStyle: (node) => ({
      display: "block",
      visibility: "visible",
      pointerEvents: node?.id === "codedrobe-codex-skin-chrome" ? "none" : "auto",
    }),
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    atob: globalThis.atob,
    Blob: globalThis.Blob,
    URL: {
      createObjectURL: () => `blob:codedrobe-image-${++objectUrlSequence}`,
      revokeObjectURL: (url) => revokedUrls.push(url),
    },
  };
  return { context, root, home, ids, revokedUrls };
}

test("Codex legacy renderer profile restores old classes, copy, art, verification, and cleanup", () => {
  const adapter = getAdapter("codex");
  const targetTheme = {
    theme: {
      id: "legacy-dream",
      displayName: "Legacy Dream",
      version: "1.0.0",
      copy: { brandTitle: "Dream title", tagline: "Dream tagline", ribbon: "🌹" },
    },
    css: ":root.codedrobe-codex-skin { color: #432; } #codedrobe-codex-skin-chrome { pointer-events: none; }",
    options: { rendererProfile: "codex-theme-v1" },
    verification: null,
    imageDataUrls: {
      hero: "data:image/png;base64,aGVsbG8=",
      logo: "data:image/png;base64,d29ybGQ=",
    },
    artDataUrl: "data:image/png;base64,aGVsbG8=",
  };
  const { context, root, home, ids, revokedUrls } = browserContext();
  const oldStyle = context.document.createElement("style");
  oldStyle.id = "codedrobe-codex-skin-style";
  context.document.head.appendChild(oldStyle);
  let oldRuntimeStopped = false;
  context.window.__CODEDROBE_CODEX_SKIN_STATE__ = {
    cleanup() { oldRuntimeStopped = true; },
  };

  vm.runInNewContext(buildApplyExpression({ adapter, targetTheme }), context);
  assert.equal(oldRuntimeStopped, true);
  assert.equal(ids.has("codedrobe-codex-skin-style"), false);
  assert.equal(context.window.__CODEDROBE_CODEX_SKIN_STATE__, undefined);
  assert.equal(root.classList.contains("codedrobe-host-codex"), true);
  assert.equal(root.classList.contains("codedrobe-codex-skin"), true);
  assert.equal(root.style.getPropertyValue("--dream-art"), 'url("blob:codedrobe-image-1")');
  assert.equal(root.style.getPropertyValue("--codedrobe-image-hero"), 'url("blob:codedrobe-image-1")');
  assert.equal(root.style.getPropertyValue("--codedrobe-image-logo"), 'url("blob:codedrobe-image-2")');
  assert.equal(home.classList.contains("dream-home"), true);
  const chrome = ids.get("codedrobe-codex-skin-chrome");
  assert.ok(chrome);
  assert.equal(chrome.querySelector(".dream-brand-title").textContent, "Dream title");
  assert.equal(chrome.querySelector(".dream-ribbon-emoji").textContent, "🌹");

  const verified = vm.runInNewContext(buildVerifyExpression(adapter, targetTheme.theme, null, targetTheme), context);
  assert.equal(verified.pass, true);
  assert.equal(verified.profile.id, "codex-theme-v1");
  assert.equal(verified.profile.homeMarked, true);
  assert.deepEqual(JSON.parse(JSON.stringify(verified.images)), ["hero", "logo"]);

  vm.runInNewContext(buildRemoveExpression(adapter), context);
  assert.equal(root.classList.contains("codedrobe-host-codex"), false);
  assert.equal(root.classList.contains("codedrobe-codex-skin"), false);
  assert.equal(home.classList.contains("dream-home"), false);
  assert.equal(ids.has("codedrobe-codex-skin-chrome"), false);
  assert.equal(root.style.getPropertyValue("--codedrobe-image-hero"), "");
  assert.equal(root.style.getPropertyValue("--codedrobe-image-logo"), "");
  assert.deepEqual(revokedUrls, ["blob:codedrobe-image-1", "blob:codedrobe-image-2"]);
});

test("Codex removal cleans a renderer that is still owned by the old Skill runtime", () => {
  const adapter = getAdapter("codex");
  const { context, root, ids } = browserContext();
  root.classList.add("codedrobe-codex-skin");
  root.style.setProperty("--codedrobe-image-logo", 'url("blob:old-logo")');
  const oldStyle = context.document.createElement("style");
  oldStyle.id = "codedrobe-codex-skin-style";
  context.document.head.appendChild(oldStyle);
  let disconnected = false;
  context.window.__CODEDROBE_CODEX_SKIN_STATE__ = {
    observer: { disconnect() { disconnected = true; } },
    timer: 1,
    scheduler: { timeout: 1 },
  };

  vm.runInNewContext(buildRemoveExpression(adapter), context);

  assert.equal(disconnected, true);
  assert.equal(root.classList.contains("codedrobe-codex-skin"), false);
  assert.equal(ids.has("codedrobe-codex-skin-style"), false);
  assert.equal(root.style.getPropertyValue("--codedrobe-image-logo"), "");
  assert.equal(context.window.__CODEDROBE_CODEX_SKIN_STATE__, undefined);
});
