import fs from "node:fs/promises";
import path from "node:path";
import { CdpSession, listCdpTargets } from "../cdp/session.mjs";
import { buildApplyExpression, buildRemoveExpression, buildVerifyExpression } from "./renderer-payload.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function findTargets(adapter, port) {
  const targets = await listCdpTargets(port);
  return targets.filter((target) => adapter.matchTarget(target));
}

export async function waitForTargets(adapter, port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await findTargets(adapter, port);
      if (targets.length) return targets;
    } catch (error) {
      lastError = error;
    }
    await delay(350);
  }
  throw new Error(`No ${adapter.displayName} renderer target on 127.0.0.1:${port}: ${lastError?.message ?? "timed out"}`);
}

async function withSessions(targets, callback) {
  const results = [];
  for (const target of targets) {
    const session = await new CdpSession(target).open();
    try {
      results.push({ targetId: target.id, title: target.title, url: target.url, result: await callback(session, target) });
    } finally {
      session.close();
    }
  }
  return results;
}

export async function applyTheme({ adapter, targetTheme, port, timeoutMs = 30000 }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  const expression = buildApplyExpression({ adapter, targetTheme });
  return withSessions(targets, async (session) => {
    await session.evaluate(expression);
    await delay(500);
    return session.evaluate(buildVerifyExpression(adapter, targetTheme.theme));
  });
}

export async function verifyTheme({ adapter, targetTheme, port, timeoutMs = 30000 }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  return withSessions(targets, (session) => session.evaluate(buildVerifyExpression(adapter, targetTheme?.theme ?? null)));
}

export async function removeTheme({ adapter, port, timeoutMs = 30000 }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  return withSessions(targets, (session) => session.evaluate(buildRemoveExpression(adapter)));
}

export async function captureScreenshot({ adapter, port, output, timeoutMs = 30000 }) {
  const [target] = await waitForTargets(adapter, port, timeoutMs);
  const session = await new CdpSession(target).open();
  try {
    const result = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const filename = path.resolve(output);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, Buffer.from(result.data, "base64"));
    return filename;
  } finally {
    session.close();
  }
}

export async function watchTheme({ adapter, targetTheme, port, timeoutMs = 30000, onEvent = () => {} }) {
  const expression = buildApplyExpression({ adapter, targetTheme });
  const sessions = new Map();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopping) {
    let targets = [];
    try {
      targets = await waitForTargets(adapter, port, Math.min(timeoutMs, 2000));
    } catch (error) {
      onEvent({ type: "waiting", message: error.message });
      await delay(900);
      continue;
    }
    const activeIds = new Set(targets.map((target) => target.id));
    for (const [id, session] of sessions) {
      if (!activeIds.has(id) || session.closed) {
        session.close();
        sessions.delete(id);
      }
    }
    for (const target of targets) {
      if (sessions.has(target.id)) continue;
      try {
        const session = await new CdpSession(target).open();
        session.on("Page.loadEventFired", () => {
          setTimeout(() => session.evaluate(expression).catch((error) => {
            onEvent({ type: "error", message: error.message });
          }), 250);
        });
        await session.evaluate(expression);
        sessions.set(target.id, session);
        onEvent({ type: "injected", targetId: target.id, title: target.title });
      } catch (error) {
        onEvent({ type: "error", targetId: target.id, message: error.message });
      }
    }
    await delay(900);
  }
  for (const session of sessions.values()) session.close();
}
