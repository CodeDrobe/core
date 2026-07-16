import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { VERSION } from "../src/version.mjs";

test("runtime version matches package.json", async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.name, "@codedrobe/core");
  assert.equal(packageJson.version, VERSION);
  assert.equal(packageJson.bin.codedrobe, "bin/codedrobe.mjs");
});
