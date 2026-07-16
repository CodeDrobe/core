import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildDomSnapshotExpression } from "../src/runtime/dom-snapshot.mjs";

function createElement({ tag = "div", id = "", classes = [], attributes = {}, parent = null, hidden = false } = {}) {
  const element = {
    tagName: tag.toUpperCase(),
    id,
    classList: classes,
    parentElement: parent,
    shadowRoot: null,
    textContent: "TOP_SECRET_CONVERSATION",
    value: "TOP_SECRET_INPUT",
    getAttribute(name) {
      if (name === "id") return id || null;
      if (name === "class") return classes.join(" ") || null;
      return Object.hasOwn(attributes, name) ? attributes[name] : null;
    },
    getBoundingClientRect() {
      return hidden
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: 10, y: 20, width: 320, height: 80 };
    },
    matches(selector) {
      if (tag === "button" && selector.includes("button")) return true;
      if (attributes.role === "textbox" && selector.includes("[role=\"textbox\"]")) return true;
      return false;
    },
  };
  return element;
}

function matchesSimple(element, selector) {
  if (selector === "*") return true;
  if (selector === "body") return element.tagName === "BODY";
  if (selector.startsWith("#")) return element.id === selector.slice(1);
  const attributes = [...selector.matchAll(/\[([^=\]]+)="([^"]*)"\]/g)];
  if (attributes.some(([, name, value]) => element.getAttribute(name) !== value)) return false;
  const withoutAttributes = selector.replace(/\[[^\]]+\]/g, "");
  const classes = [...withoutAttributes.matchAll(/\.([a-zA-Z0-9_/-]+)/g)].map((match) => match[1]);
  if (classes.some((name) => !element.classList.includes(name))) return false;
  const tag = withoutAttributes.match(/^[a-z]+/i)?.[0];
  return !tag || element.tagName.toLowerCase() === tag.toLowerCase();
}

test("DOM snapshot exposes selector and style evidence without renderer content", () => {
  const html = createElement({ tag: "html", id: "root" });
  const body = createElement({ tag: "body", parent: html });
  const sidebar = createElement({
    tag: "aside",
    classes: ["conversation-sidebar", "css-a1b2c3d4", "_grid_48kdk_4"],
    attributes: { role: "navigation", "aria-label": "TOP_SECRET_LABEL" },
    parent: body,
  });
  const button = createElement({
    tag: "button",
    classes: ["new-task-button"],
    attributes: { "data-testid": "new-task", "aria-label": "TOP_SECRET_BUTTON" },
    parent: sidebar,
  });
  const hidden = createElement({ tag: "div", classes: ["hidden-panel"], parent: body, hidden: true });
  const elements = [html, body, sidebar, button, hidden];
  const context = {
    document: {
      documentElement: { dataset: { codedrobeTheme: "existing-theme", codedrobeThemeVersion: "2.0.0" } },
      querySelectorAll(selector) {
        return elements.filter((element) => matchesSimple(element, selector));
      },
    },
    getComputedStyle(element) {
      const rect = element.getBoundingClientRect();
      return {
        display: rect.width ? "flex" : "none",
        visibility: "visible",
        contentVisibility: "visible",
        position: "relative",
        color: "rgb(73, 56, 79)",
        backgroundColor: "rgb(255, 250, 248)",
        backgroundImage: "url(\"TOP_SECRET_MEDIA\")",
      };
    },
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 2,
    location: {
      protocol: "workbuddy:",
      origin: "null",
      pathname: "/chat/1234567890123456",
      search: "?token=TOP_SECRET_QUERY",
      hash: "#TOP_SECRET_HASH",
    },
    CSS: { escape: (value) => value.replace(/\//g, "\\/") },
  };
  const adapter = {
    id: "workbuddy",
    verification: {
      rootAny: ["#root"],
      required: [{ name: "sidebar", any: [".conversation-sidebar"] }],
    },
  };

  const result = vm.runInNewContext(buildDomSnapshotExpression(adapter, { maxNodes: 50 }), context);
  const plain = JSON.parse(JSON.stringify(result));
  assert.equal(plain.summary.documentElements, 5);
  assert.deepEqual(plain.activeTheme, { installed: true, id: "existing-theme", version: "2.0.0" });
  assert.equal(plain.summary.eligibleNodes, 4);
  assert.equal(plain.summary.recordedNodes, 4);
  assert.equal(plain.summary.truncated, false);
  assert.equal(plain.route.pathname, "/chat/:id");
  assert.equal(plain.nodes[2].parentIndex, 1);
  assert.deepEqual(plain.nodes[2].semanticClasses, ["conversation-sidebar"]);
  assert.equal(plain.nodes[2].selectors.find((item) => item.selector === ".conversation-sidebar").count, 1);
  assert.equal(plain.nodes[3].states.interactive, true);
  assert.equal(plain.landmarks[1].selectors[0].visibleCount, 1);
  assert.equal(plain.privacy.textContent, false);
  const serialized = JSON.stringify(plain);
  assert.doesNotMatch(serialized, /TOP_SECRET/);
  assert.doesNotMatch(serialized, /hidden-panel/);
});

test("DOM snapshot reports truncation and validates its node limit", () => {
  assert.throws(
    () => buildDomSnapshotExpression({ id: "test" }, { maxNodes: 5001 }),
    /integer from 1 to 5000/,
  );
  const elements = Array.from({ length: 4 }, (_, index) => createElement({ id: `node-${index}` }));
  const context = {
    document: {
      documentElement: { dataset: {} },
      querySelectorAll: (selector) => selector === "*" ? elements : [],
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible", contentVisibility: "visible" }),
    innerWidth: 800,
    innerHeight: 600,
    location: {},
    CSS: { escape: (value) => value },
  };
  const result = vm.runInNewContext(buildDomSnapshotExpression({ id: "test" }, { maxNodes: 3 }), context);
  assert.equal(result.summary.recordedNodes, 3);
  assert.equal(result.summary.eligibleNodes, 4);
  assert.equal(result.summary.truncated, true);
});
