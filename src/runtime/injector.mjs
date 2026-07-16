import fs from "node:fs/promises";
import path from "node:path";
import { CdpSession, listCdpTargets } from "../cdp/session.mjs";
import { buildApplyExpression, buildProbeExpression, buildRemoveExpression, buildVerifyExpression } from "./renderer-payload.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function findTargets(adapter, port, timeoutMs = 1500) {
  const targets = await listCdpTargets(port, timeoutMs);
  return targets.filter((target) => adapter.matchTarget(target));
}

export async function waitForTargets(adapter, port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const remaining = Math.max(1, deadline - Date.now());
      const targets = await findTargets(adapter, port, Math.min(1500, remaining));
      if (targets.length) return targets;
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(350, remaining));
  }
  const error = new Error(`No ${adapter.displayName} renderer target on 127.0.0.1:${port} within ${timeoutMs}ms: ${lastError?.message ?? "timed out"}`);
  error.code = "CODEDROBE_TARGET_TIMEOUT";
  error.appId = adapter.id;
  error.port = port;
  error.timeoutMs = timeoutMs;
  throw error;
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

function compatibilityError(adapter, results) {
  const missing = results.flatMap((item) => item.result?.missing ?? []);
  const detail = missing
    .map((item) => `${item.scope}${item.context ? `:${item.context}` : ""}:${item.name} (${item.selectors.join(" | ")})`)
    .join("; ");
  const error = new Error(`${adapter.displayName} DOM preflight failed${detail ? `: ${detail}` : "."}`);
  error.code = "CODEDROBE_DOM_INCOMPATIBLE";
  error.missing = missing;
  error.results = results;
  return error;
}

function ensureCompatible(adapter, results) {
  if (results.every((item) => item.result?.compatible)) return results;
  throw compatibilityError(adapter, results);
}

async function waitForCompatibility(session, expression, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let result;
  do {
    result = await session.evaluate(expression);
    if (result?.compatible) return result;
    await delay(250);
  } while (Date.now() < deadline);
  return result;
}

export async function probeApp({ adapter, targetTheme = null, port, timeoutMs = 5000 }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  const expression = buildProbeExpression(adapter, targetTheme?.verification ?? null);
  return withSessions(targets, (session) => waitForCompatibility(session, expression, Math.min(timeoutMs, 5000)));
}

export async function applyTheme({ adapter, targetTheme, port, timeoutMs = 30000 }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  const preflightExpression = buildProbeExpression(adapter, targetTheme.verification);
  const preflight = await withSessions(
    targets,
    (session) => waitForCompatibility(session, preflightExpression, Math.min(timeoutMs, 5000)),
  );
  ensureCompatible(adapter, preflight);
  const expression = buildApplyExpression({ adapter, targetTheme });
  return withSessions(targets, async (session) => {
    await session.evaluate(expression);
    await delay(500);
    return session.evaluate(buildVerifyExpression(adapter, targetTheme.theme, targetTheme.verification));
  });
}

export async function verifyTheme({ adapter, targetTheme, port, timeoutMs = 30000 }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  return withSessions(targets, (session) => session.evaluate(buildVerifyExpression(
    adapter,
    targetTheme?.theme ?? null,
    targetTheme?.verification ?? null,
  )));
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
  const preflightExpression = buildProbeExpression(adapter, targetTheme.verification);
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
      let session;
      try {
        session = await new CdpSession(target).open();
        const applyCompatible = async () => {
          const result = await waitForCompatibility(session, preflightExpression, Math.min(timeoutMs, 5000));
          ensureCompatible(adapter, [{ targetId: target.id, title: target.title, url: target.url, result }]);
          await session.evaluate(expression);
        };
        session.on("Page.loadEventFired", () => {
          setTimeout(() => applyCompatible().catch((error) => {
            onEvent({ type: "error", code: error.code, message: error.message, missing: error.missing ?? [] });
            session.close();
            sessions.delete(target.id);
          }), 250);
        });
        await applyCompatible();
        sessions.set(target.id, session);
        onEvent({ type: "injected", targetId: target.id, title: target.title });
      } catch (error) {
        session?.close();
        onEvent({ type: "error", targetId: target.id, code: error.code, message: error.message, missing: error.missing ?? [] });
      }
    }
    await delay(900);
  }
  for (const session of sessions.values()) session.close();
}
