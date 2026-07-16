import { launchApp } from "./launcher.mjs";
import { applyTheme, removeTheme } from "./injector.mjs";
import { prepareHostSettings, publicHostSettingsResult, restoreHostSettings } from "./host-settings.mjs";

function verificationError(results) {
  const failures = results.filter((item) => item.result?.pass === false);
  const missing = failures.flatMap((item) => item.result?.missing ?? []);
  const detail = missing
    .map((item) => `${item.scope}${item.context ? `:${item.context}` : ""}:${item.name} (${item.selectors.join(" | ")})`)
    .join("; ");
  const error = new Error(`Theme application verification failed for ${failures.length} renderer target(s)${detail ? `: ${detail}` : "."}`);
  error.code = "CODEDROBE_VERIFY_FAILED";
  error.missing = missing;
  error.results = results;
  return error;
}

function restartRequiredError(adapter, port) {
  const error = new Error(`${adapter.displayName} is already running, but its host appearance settings changed. Close it or pass --restart-existing so the complete skin can load.`);
  error.code = "CODEDROBE_RESTART_REQUIRED";
  error.appId = adapter.id;
  error.port = port;
  return error;
}

export async function applySkin({
  adapter,
  targetTheme,
  port = adapter.defaultPort,
  launch = true,
  appPath = null,
  profilePath = null,
  restartExisting = false,
  timeoutMs = 30000,
  hostOptions = {},
} = {}) {
  const hostTransaction = await prepareHostSettings({ adapter, targetTheme, options: hostOptions });
  let rendererMutated = false;
  try {
    const launchResult = launch
      ? await launchApp({ adapter, port, appPath, profilePath, restartExisting, timeoutMs })
      : null;
    if (hostTransaction.restartRequired && launchResult?.alreadyReady) {
      throw restartRequiredError(adapter, port);
    }
    const targets = await applyTheme({ adapter, targetTheme, port, timeoutMs });
    rendererMutated = true;
    if (targets.some((item) => item.result?.pass === false)) throw verificationError(targets);
    return {
      action: "apply",
      appId: adapter.id,
      port,
      theme: targetTheme.theme,
      launch: launchResult,
      host: publicHostSettingsResult(adapter, hostTransaction),
      targets,
    };
  } catch (error) {
    if (rendererMutated || error.rendererMutated) {
      try {
        error.rendererRollback = await removeTheme({
          adapter,
          port,
          timeoutMs: Math.min(timeoutMs, 3000),
        });
      } catch (rendererRollbackError) {
        error.rendererRollbackError = rendererRollbackError;
      }
    }
    try {
      await hostTransaction.rollback();
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}

export async function restoreSkin({
  adapter,
  port = adapter.defaultPort,
  timeoutMs = 3000,
  hostOptions = {},
} = {}) {
  let renderer;
  try {
    renderer = { restored: true, targets: await removeTheme({ adapter, port, timeoutMs }) };
  } catch (error) {
    renderer = {
      restored: false,
      code: error.code ?? null,
      message: error.message,
    };
  }
  const host = await restoreHostSettings({ adapter, options: hostOptions });
  return { action: "restore", appId: adapter.id, port, renderer, host };
}
