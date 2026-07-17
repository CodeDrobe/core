import { spawn } from "node:child_process";

import {
  DEFAULT_SCOPES,
  NotLoggedInError,
  TokenRevokedError,
  credentialsEntryFromTokens,
  fetchMe,
  getAccessToken,
  pollForTokens,
  requestDeviceCode,
  resolveBaseUrl,
  revokeToken,
} from "./api.mjs";
import { clearCredentials, loadCredentials, saveCredentials } from "./credentials.mjs";

function groupUserCode(userCode) {
  const normalized = userCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return normalized.length > 4 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized;
}

/** Best-effort system browser open; login continues even when this fails. */
function openBrowser(url, { platform = process.platform } = {}) {
  try {
    const [command, args] = platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Printing the URL is the fallback.
  }
}

function parseScopesOption(value) {
  if (!value) return DEFAULT_SCOPES;
  const scopes = value.split(",").map((scope) => scope.trim()).filter(Boolean);
  if (scopes.length === 0) return DEFAULT_SCOPES;
  return scopes;
}

async function runLogin(options, { output, env, credentialOptions, fetchImpl, sleep, openBrowserImpl }) {
  const baseUrl = resolveBaseUrl(env);
  const scopes = parseScopesOption(options.scopes);
  const device = await requestDeviceCode({ baseUrl, scopes, fetchImpl });

  if (options.json) {
    output({
      action: "auth-login",
      status: "awaiting-approval",
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      verificationUriComplete: device.verificationUriComplete,
      expiresIn: device.expiresIn,
      interval: device.interval,
    }, true);
  } else {
    output(`First, confirm this code in your browser: ${groupUserCode(device.userCode)}`);
    output(`Approve the request at: ${device.verificationUriComplete}`);
    output(`Waiting for approval… (checking every ~${device.interval}s, Ctrl+C to cancel)`);
  }
  if (!options["no-open"]) (openBrowserImpl ?? openBrowser)(device.verificationUriComplete);

  // Progress dots so a silent poll loop never looks frozen while the user
  // finishes logging in and approving in the browser.
  const showTicks = !options.json && typeof process !== "undefined" && process.stdout?.isTTY;
  let ticked = false;
  let tokens;
  try {
    tokens = await pollForTokens({
      baseUrl,
      deviceCode: device.deviceCode,
      intervalSeconds: device.interval,
      expiresInSeconds: device.expiresIn,
      onTick: showTicks
        ? () => {
            ticked = true;
            process.stdout.write(".");
          }
        : undefined,
      fetchImpl,
      sleep,
    });
  } finally {
    if (ticked) process.stdout.write("\n");
  }
  await saveCredentials(baseUrl, credentialsEntryFromTokens(tokens, { scopes }), credentialOptions);

  const me = await fetchMe({ baseUrl, accessToken: tokens.accessToken, fetchImpl });
  const name = me?.user?.name || me?.user?.email || "unknown";
  if (options.json) {
    output({
      action: "auth-login",
      status: "logged-in",
      baseUrl,
      user: { name: me?.user?.name ?? null, email: me?.user?.email ?? null },
      creatorHandle: me?.creator?.handle ?? null,
      scopes: tokens.scope ? tokens.scope.split(" ") : scopes,
    }, true);
    return;
  }
  output(`Logged in as ${name}${me?.user?.email ? ` (${me.user.email})` : ""}.`);
  if (me?.creator?.handle) output(`Creator handle: @${me.creator.handle}`);
}

async function runStatus(options, { output, env, credentialOptions, fetchImpl }) {
  const baseUrl = resolveBaseUrl(env);
  const entry = await loadCredentials(baseUrl, credentialOptions);
  if (!entry) {
    output(options.json ? { action: "auth-status", loggedIn: false, baseUrl } : "Not logged in.", options.json);
    return;
  }
  try {
    const accessToken = await getAccessToken({ baseUrl, fetchImpl, credentialOptions });
    const me = await fetchMe({ baseUrl, accessToken, fetchImpl });
    const refreshed = await loadCredentials(baseUrl, credentialOptions);
    if (options.json) {
      output({
        action: "auth-status",
        loggedIn: true,
        baseUrl,
        user: { name: me?.user?.name ?? null, email: me?.user?.email ?? null },
        creatorHandle: me?.creator?.handle ?? null,
        scopes: refreshed?.scopes ?? entry.scopes ?? [],
        accessTokenExpiresAt: refreshed?.accessTokenExpiresAt ?? null,
      }, true);
      return;
    }
    output(`Logged in to ${baseUrl}`);
    output(`User: ${me?.user?.name ?? "unknown"}${me?.user?.email ? ` (${me.user.email})` : ""}`);
    if (me?.creator?.handle) output(`Creator handle: @${me.creator.handle}`);
    output(`Scopes: ${(refreshed?.scopes ?? entry.scopes ?? []).join(", ") || "(none)"}`);
    if (refreshed?.accessTokenExpiresAt) output(`Access token expires: ${refreshed.accessTokenExpiresAt}`);
  } catch (error) {
    if (error instanceof TokenRevokedError || error instanceof NotLoggedInError) {
      output(
        options.json
          ? { action: "auth-status", loggedIn: false, baseUrl, reason: "revoked" }
          : "Session revoked or expired. Run `codedrobe auth login`.",
        options.json,
      );
      return;
    }
    throw error;
  }
}

async function runLogout(options, { output, env, credentialOptions, fetchImpl }) {
  const baseUrl = resolveBaseUrl(env);
  const entry = await loadCredentials(baseUrl, credentialOptions);
  if (entry?.refreshToken) {
    // Revoking the refresh token kills the whole grant server-side.
    await revokeToken({ baseUrl, token: entry.refreshToken, fetchImpl });
  }
  const cleared = await clearCredentials(baseUrl, credentialOptions);
  output(
    options.json
      ? { action: "auth-logout", loggedOut: true, hadCredentials: cleared, baseUrl }
      : cleared
        ? "Logged out."
        : "Already logged out.",
    options.json,
  );
}

export async function runAuthCommand(positional, options, overrides = {}) {
  const context = {
    output: overrides.output ?? ((value, json = false) => {
      if (json || typeof value !== "string") console.log(JSON.stringify(value, null, 2));
      else console.log(value);
    }),
    env: overrides.env ?? process.env,
    credentialOptions: overrides.credentialOptions ?? {},
    fetchImpl: overrides.fetchImpl ?? fetch,
    sleep: overrides.sleep,
    openBrowserImpl: overrides.openBrowserImpl,
  };
  const subcommand = positional[0];
  if (subcommand === "login") return runLogin(options, context);
  if (subcommand === "status") return runStatus(options, context);
  if (subcommand === "logout") return runLogout(options, context);
  throw new Error("Auth command must be 'login', 'status', or 'logout'.");
}
