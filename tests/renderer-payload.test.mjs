import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { getAdapter } from "../src/adapters/index.mjs";
import { buildApplyExpression, buildProbeExpression, buildRemoveExpression, buildVerifyExpression } from "../src/runtime/renderer-payload.mjs";

const targetTheme = {
  theme: { id: "dream", displayName: "Dream", version: "1.0.0" },
  css: ":root.codedrobe-host-workbuddy { color: #432; }",
  verification: {
    required: [{ name: "chat-surface", any: [".chat-container", ".wb-cb-chat"] }],
    recommended: [{ name: "chat-toolbar", any: [".chat-toolbar"] }],
    contexts: [{
      name: "active-chat",
      when: { any: [".chat-route"] },
      required: [{ name: "message-list", any: [".message-list"] }],
    }],
  },
  artDataUrl: null,
};

test("renderer payload is namespaced by app and theme", () => {
  const adapter = getAdapter("workbuddy");
  const expression = buildApplyExpression({ adapter, targetTheme });
  assert.match(expression, /codedrobe-host-workbuddy/);
  assert.match(expression, /codedrobe-theme-style-/);
  assert.match(expression, /__CODEDROBE__/);
  assert.doesNotMatch(expression, /__CODEDROBE_CODEX_SKIN_STATE__/);
});

test("remove and verify expressions use the selected adapter", () => {
  const adapter = getAdapter("codex");
  assert.match(buildRemoveExpression(adapter), /codex/);
  assert.match(buildVerifyExpression(adapter, targetTheme.theme, targetTheme.verification), /chat-surface/);
});

test("preflight reports missing theme nodes separately from adapter landmarks", () => {
  const adapter = getAdapter("workbuddy");
  const visibleElement = { getBoundingClientRect: () => ({ width: 100, height: 40 }) };
  const matchedSelectors = new Set([
    "#root > .teams-container",
    ".conversation-sidebar",
    ".teams-main-content",
    "[role='textbox'][contenteditable='true']",
  ]);
  const context = {
    document: { querySelector: (selector) => matchedSelectors.has(selector) ? visibleElement : null },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    innerWidth: 1200,
    innerHeight: 800,
  };

  const expression = buildProbeExpression(adapter, targetTheme.verification);
  const failed = vm.runInNewContext(expression, context);
  assert.equal(failed.compatible, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(failed.missing)),
    [{
      scope: "theme",
      context: null,
      severity: "required",
      name: "chat-surface",
      selectors: [".chat-container", ".wb-cb-chat"],
      invalidSelectors: [],
    }],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(failed.warnings)), [{
    scope: "theme",
    context: null,
    severity: "recommended",
    name: "chat-toolbar",
    selectors: [".chat-toolbar"],
    invalidSelectors: [],
  }]);
  assert.equal(failed.contexts[0].active, false);

  matchedSelectors.add(".chat-container");
  const passed = vm.runInNewContext(expression, context);
  assert.equal(passed.compatible, true);
  assert.deepEqual(JSON.parse(JSON.stringify(passed.missing)), []);
  assert.equal(passed.warnings.length, 1);

  matchedSelectors.add(".chat-route");
  const contextualFailure = vm.runInNewContext(expression, context);
  assert.equal(contextualFailure.compatible, false);
  assert.equal(contextualFailure.contexts[0].active, true);
  assert.deepEqual(JSON.parse(JSON.stringify(contextualFailure.missing)), [{
    scope: "theme",
    context: "active-chat",
    severity: "required",
    name: "message-list",
    selectors: [".message-list"],
    invalidSelectors: [],
  }]);

  matchedSelectors.add(".message-list");
  assert.equal(vm.runInNewContext(expression, context).compatible, true);
});

test("preflight reports invalid selectors instead of hiding parser failures", () => {
  const adapter = getAdapter("codex");
  const visibleElement = { getBoundingClientRect: () => ({ width: 100, height: 40 }) };
  const context = {
    document: {
      querySelector(selector) {
        if (selector === "[broken") throw new Error("Invalid selector");
        return visibleElement;
      },
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    innerWidth: 1200,
    innerHeight: 800,
  };
  const result = vm.runInNewContext(buildProbeExpression(adapter, {
    required: [{ name: "broken-hook", any: ["[broken"] }],
  }), context);
  assert.equal(result.compatible, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.missing[0].invalidSelectors)), [{
    selector: "[broken",
    error: "Invalid selector",
  }]);
});
