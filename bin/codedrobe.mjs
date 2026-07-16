#!/usr/bin/env node
import { runCli } from "../src/cli.mjs";

try {
  await runCli();
} catch (error) {
  console.error(`[codedrobe] ${error.message}`);
  if (error.results) console.error(JSON.stringify(error.results, null, 2));
  process.exitCode = 1;
}
