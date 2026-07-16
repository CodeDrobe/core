import test from "node:test";
import assert from "node:assert/strict";
import { HELP, runCli } from "../src/cli.mjs";

test("probe documents and validates its configurable timeout", async () => {
  assert.match(HELP, /probe.+--timeout-ms <milliseconds>/);
  await assert.rejects(
    runCli(["probe", "--app", "workbuddy", "--timeout-ms", "100"]),
    /integer from 250 to 300000 milliseconds/,
  );
});

test("DOM snapshot is documented and validates its node limit", async () => {
  assert.match(HELP, /dom snapshot.+--max-nodes <count>.+--include-hidden/);
  assert.match(HELP, /exclude text, input values, accessible names, links, and media sources/);
  await assert.rejects(
    runCli(["dom", "snapshot", "--app", "workbuddy", "--max-nodes", "10"]),
    /integer from 50 to 5000/,
  );
});
