import fs from "node:fs/promises";
import path from "node:path";
import { CdpSession, listCdpTargets } from "../cdp/session.mjs";
import { buildDomSnapshotExpression, DOM_SNAPSHOT_DEFAULT_MAX_NODES } from "./dom-snapshot.mjs";
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

async function withSessions(targets, callback, sessionTimeoutMs = 10000) {
  const results = [];
  for (const target of targets) {
    const session = await new CdpSession(target, sessionTimeoutMs).open();
    try {
      results.push({ targetId: target.id, title: target.title, url: target.url, result: await callback(session, target) });
    } finally {
      session.close();
    }
  }
  return results;
}

export function describeMissingRequirements(missing) {
  return missing
    .map((item) => `${item.scope}${item.context ? `:${item.context}` : ""}:${item.name} (${item.selectors.join(" | ")})`)
    .join("; ");
}

export function describeTarget(item) {
  return item.title || item.url || item.targetId || "unknown target";
}

function compatibilityError(adapter, results) {
  const failures = results.filter((item) => !item.result?.compatible);
  const missing = failures.flatMap((item) => item.result?.missing ?? []);
  const detail = failures
    .map((item) => `${describeTarget(item)} → ${describeMissingRequirements(item.result?.missing ?? []) || "no DOM response"}`)
    .join(" ‖ ");
  const error = new Error(
    `${adapter.displayName} DOM preflight failed for ${failures.length} of ${results.length} renderer target(s)` +
    `${detail ? `: ${detail}` : "."}` +
    ` The app may have updated since this adapter was last verified (${JSON.stringify(adapter.lastVerified ?? {})}).`,
  );
  error.code = "CODEDROBE_DOM_INCOMPATIBLE";
  error.missing = missing;
  error.results = results;
  return error;
}

function ensureCompatible(adapter, results) {
  if (results.every((item) => item.result?.compatible)) return results;
  throw compatibilityError(adapter, results);
}

/**
 * Waits for the page to pass the compatibility probe. A page whose root
 * landmark is absent is still booting (splash/loading screen), so it gets the
 * full boot budget; once the skeleton exists, a genuine selector mismatch
 * fails after the shorter settle budget instead of stalling the caller.
 */
async function waitForCompatibility(session, expression, settleTimeoutMs = 5000, bootTimeoutMs = settleTimeoutMs) {
  const start = Date.now();
  let structuredAt = null;
  let result;
  do {
    try {
      result = await session.evaluate(expression);
    } catch {
      // Boot-time navigations tear down the execution context mid-evaluate;
      // treat it like a page that has not rendered yet and retry.
      result = undefined;
    }
    if (result?.compatible) return result;
    const now = Date.now();
    const hasRoot = Boolean(result?.rootMatches?.length);
    if (hasRoot && structuredAt === null) structuredAt = now;
    const deadline = hasRoot
      ? Math.min(start + bootTimeoutMs, structuredAt + settleTimeoutMs)
      : start + bootTimeoutMs;
    if (now >= deadline) return result;
    await delay(250);
  } while (true);
}

export async function probeApp({ adapter, targetTheme = null, port, timeoutMs = 5000 }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  const expression = buildProbeExpression(adapter, targetTheme?.verification ?? null);
  return withSessions(targets, (session) => waitForCompatibility(session, expression, Math.min(timeoutMs, 5000)));
}

export async function snapshotDom({
  adapter,
  port,
  timeoutMs = 5000,
  maxNodes = DOM_SNAPSHOT_DEFAULT_MAX_NODES,
  includeHidden = false,
}) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  const expression = buildDomSnapshotExpression(adapter, { maxNodes, includeHidden });
  const results = await withSessions(targets, (session) => session.evaluate(expression), timeoutMs);
  return results.map(({ targetId, result }) => ({ targetId, result }));
}

export async function applyTheme({ adapter, targetTheme, port, timeoutMs = 30000 }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  const preflightExpression = buildProbeExpression(adapter, targetTheme.verification);
  // A splash/loading screen may keep the DOM empty for a long while after the
  // CDP target exists, so booting pages get the full apply budget while
  // rendered-but-mismatched pages still fail within the settle budget.
  const preflight = await withSessions(
    targets,
    (session) => waitForCompatibility(session, preflightExpression, Math.min(timeoutMs, 10000), timeoutMs),
    Math.max(10000, timeoutMs),
  );
  // Secondary windows (popped-out chats, floating panels) legitimately lack
  // parts of the main-window DOM. Theme every compatible target and report the
  // rest as skipped instead of refusing the whole apply.
  const compatibleIds = new Set(preflight.filter((item) => item.result?.compatible).map((item) => item.targetId));
  if (!compatibleIds.size) throw compatibilityError(adapter, preflight);
  const skipped = preflight
    .filter((item) => !compatibleIds.has(item.targetId))
    .map((item) => ({
      targetId: item.targetId,
      title: item.title,
      url: item.url,
      skipped: true,
      missing: item.result?.missing ?? [],
    }));
  const expression = buildApplyExpression({ adapter, targetTheme });
  let rendererMutated = false;
  try {
    const applied = await withSessions(
      targets.filter((target) => compatibleIds.has(target.id)),
      async (session) => {
        await session.evaluate(expression);
        rendererMutated = true;
        await delay(500);
        return session.evaluate(buildVerifyExpression(adapter, targetTheme.theme, targetTheme.verification, targetTheme));
      },
    );
    return [...applied, ...skipped];
  } catch (error) {
    error.rendererMutated = rendererMutated;
    throw error;
  }
}

export async function verifyTheme({ adapter, targetTheme, port, timeoutMs = 30000 }) {
  const targets = await waitForTargets(adapter, port, timeoutMs);
  return withSessions(targets, (session) => session.evaluate(buildVerifyExpression(
    adapter,
    targetTheme?.theme ?? null,
    targetTheme?.verification ?? null,
    targetTheme,
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

export async function watchTheme({ adapter, targetTheme, port, timeoutMs = 30000, onEvent = () => {}, signal = null }) {
  const expression = buildApplyExpression({ adapter, targetTheme });
  const preflightExpression = buildProbeExpression(adapter, targetTheme.verification);
  const sessions = new Map();
  // Incompatible targets (e.g. popped-out windows) retry on a cooldown instead
  // of blocking every poll cycle for the full preflight wait.
  const incompatibleUntil = new Map();
  const INCOMPATIBLE_RETRY_MS = 15000;
  let stopping = Boolean(signal?.aborted);
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  signal?.addEventListener("abort", stop, { once: true });

  try {
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
      for (const id of incompatibleUntil.keys()) {
        if (!activeIds.has(id)) incompatibleUntil.delete(id);
      }
      for (const target of targets) {
        if (sessions.has(target.id)) continue;
        if ((incompatibleUntil.get(target.id) ?? 0) > Date.now()) continue;
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
          if (error.code === "CODEDROBE_DOM_INCOMPATIBLE") incompatibleUntil.set(target.id, Date.now() + INCOMPATIBLE_RETRY_MS);
          onEvent({ type: "error", targetId: target.id, code: error.code, message: error.message, missing: error.missing ?? [] });
        }
      }
      await delay(900);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    signal?.removeEventListener("abort", stop);
    for (const session of sessions.values()) session.close();
  }
}
