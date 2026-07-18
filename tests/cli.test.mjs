import test from "node:test";
import assert from "node:assert/strict";
import { HELP, commandHelp, runCli } from "../src/cli.mjs";

test("probe documents and validates its configurable timeout", async () => {
  assert.match(commandHelp(["probe"]), /probe.+--timeout-ms <milliseconds>/s);
  await assert.rejects(
    runCli(["probe", "--app", "workbuddy", "--timeout-ms", "100"]),
    /integer from 250 to 300000 milliseconds/,
  );
});

test("DOM snapshot is documented and validates its node limit", async () => {
  assert.match(commandHelp(["dom", "snapshot"]), /dom snapshot.+--max-nodes <count>.+--include-hidden/s);
  assert.match(HELP, /exclude text, input values, accessible names, links, and media sources/);
  await assert.rejects(
    runCli(["dom", "snapshot", "--app", "workbuddy", "--max-nodes", "10"]),
    /integer from 50 to 5000/,
  );
});

test("general help lists every command group with a Global options and Examples section", () => {
  for (const heading of ["Apps:", "Theme runtime:", "Theme packages:", "Account:", "Maintenance:", "Global options:", "Examples:", "Environment:", "Safety:"]) {
    assert.ok(HELP.includes(heading), `general help is missing '${heading}'`);
  }
  assert.match(HELP, /-h, --help/);
  assert.match(HELP, /-v, --version/);
  assert.match(HELP, /CODEDROBE_CREDENTIALS_FILE/);
});

test("command help focuses on one command and includes its examples", () => {
  const help = commandHelp(["theme", "publish"]);
  assert.match(help, /theme publish <file\.codedrobe-theme>/);
  assert.match(help, /--submit/);
  assert.match(help, /codedrobe theme publish dream\.codedrobe-theme --submit/);
  // Unrelated commands do not bleed into a focused help screen.
  assert.doesNotMatch(help, /theme convert/);
});

test("a bare group topic lists its subcommands", () => {
  const help = commandHelp(["theme"]);
  for (const sub of ["theme inspect", "theme pack", "theme convert", "theme publish"]) {
    assert.ok(help.includes(sub), `group help is missing '${sub}'`);
  }
});

test("unknown topics fall through to the general help", () => {
  assert.equal(commandHelp(["bogus"]), null);
});

test("short flags map to help and version", async () => {
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(String(line));
  try {
    await runCli(["-v"]);
    await runCli(["-h"]);
  } finally {
    console.log = original;
  }
  assert.ok(logs.some((line) => /^\d+\.\d+\.\d+/.test(line)), "-v should print the version");
  assert.ok(logs.some((line) => line.includes("CodeDrobe multi-app theming CLI")), "-h should print help");
});

test("unknown commands report the command and a non-zero-worthy error", async () => {
  await assert.rejects(runCli(["bogus-command"]), /Unknown command 'bogus-command'/);
});

test("command-scoped --help shows focused help without running the command", async () => {
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(String(line));
  try {
    await runCli(["apply", "--help"]);
  } finally {
    console.log = original;
  }
  const printed = logs.join("\n");
  assert.match(printed, /Apply a theme to an app/);
  assert.match(printed, /codedrobe apply --app <id>/);
});
