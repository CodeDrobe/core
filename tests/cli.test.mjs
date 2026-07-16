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
