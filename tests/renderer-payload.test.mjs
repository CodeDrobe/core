import test from "node:test";
import assert from "node:assert/strict";
import { getAdapter } from "../src/adapters/index.mjs";
import { buildApplyExpression, buildRemoveExpression, buildVerifyExpression } from "../src/runtime/renderer-payload.mjs";

const targetTheme = {
  theme: { id: "dream", displayName: "Dream", version: "1.0.0" },
  css: ":root.codedrobe-host-workbuddy { color: #432; }",
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
  assert.match(buildVerifyExpression(adapter, targetTheme.theme), /composer/);
});
