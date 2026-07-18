import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { buildThemePackage } from "../src/theme/package.mjs";

const schemaUrl = new URL("../schemas/theme-manifest.schema.json", import.meta.url);
const exampleManifestUrl = new URL("../examples/dream/theme.json", import.meta.url);

test("theme manifest schema is valid JSON with a stable canonical id", async () => {
  const schema = JSON.parse(await fs.readFile(schemaUrl, "utf8"));
  assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
  assert.equal(schema.$id, "https://codedrobe.app/schemas/theme-manifest.schema.json");
  assert.deepEqual(schema.required, ["schemaVersion", "id", "displayName", "version", "targets"]);
  assert.equal(schema.properties.schemaVersion.const, 1);
});

test("schema declares every field the example manifest and pack pipeline use", async () => {
  const schema = JSON.parse(await fs.readFile(schemaUrl, "utf8"));
  const manifest = JSON.parse(await fs.readFile(exampleManifestUrl, "utf8"));
  // additionalProperties is false at the root, so an undeclared manifest key
  // would make editors flag every published example as invalid.
  assert.equal(schema.additionalProperties, false);
  for (const key of Object.keys(manifest)) {
    assert.ok(schema.properties[key], `schema is missing root property '${key}' used by the example manifest`);
  }
  for (const key of ["copy", "catalog", "art", "images", "targets"]) {
    assert.ok(schema.properties[key], `schema is missing documented root property '${key}'`);
  }
  assert.deepEqual(
    Object.keys(schema.definitions.target.properties).sort(),
    ["css", "options", "verification"],
  );
});

test("a manifest carrying $schema still packs cleanly", async () => {
  const { bundle } = await buildThemePackage(exampleManifestUrl.pathname);
  assert.equal(bundle.theme.id, "dream");
  // The editor-only $schema key must never leak into the packed bundle.
  assert.equal(Object.keys(bundle).includes("$schema"), false);
});
