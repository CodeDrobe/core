#!/usr/bin/env node
import { runCli } from "../src/cli.mjs";

try {
  await runCli();
} catch (error) {
  console.error(`[codedrobe] ${error.message}`);
  if (error.fields && typeof error.fields === "object") {
    for (const [field, messages] of Object.entries(error.fields)) {
      console.error(`[codedrobe]   ${field}: ${[].concat(messages).join(" ")}`);
    }
  }
  if (error.results) console.error(JSON.stringify(error.results, null, 2));
  process.exitCode = 1;
}
