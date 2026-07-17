import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  credentialsEntryFromTokens,
  getAccessToken,
  NotLoggedInError,
  pollForTokens,
  refreshTokens,
  requestDeviceCode,
  resolveBaseUrl,
  TokenRevokedError,
} from "../src/auth/api.mjs";
import { runAuthCommand } from "../src/auth/commands.mjs";
import {
  clearCredentials,
  getCredentialsFile,
  loadCredentials,
  saveCredentials,
} from "../src/auth/credentials.mjs";

const BASE = "https://codedrobe.test";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Sequential fetch stub: each call consumes the next handler. */
function fetchQueue(handlers) {
  let index = 0;
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    return typeof handler === "function" ? handler(url, init) : handler;
  };
  impl.calls = calls;
  return impl;
}

async function makeHome() {
  return fs.mkdtemp(path.join(os.tmpdir(), "codedrobe-auth-"));
}

test("resolveBaseUrl defaults and validates", () => {
  assert.equal(resolveBaseUrl({}), "https://codedrobe.app");
  assert.equal(resolveBaseUrl({ CODEDROBE_API_BASE: "http://localhost:4291/" }), "http://localhost:4291");
  assert.throws(() => resolveBaseUrl({ CODEDROBE_API_BASE: "ftp://nope" }));
});

test("credentials store round-trips atomically with 0600", async () => {
  const home = await makeHome();
  const options = { home };
  assert.equal(await loadCredentials(BASE, options), null);

  await saveCredentials(BASE, { clientId: "codedrobe-skill", refreshToken: "cdbrt_1", scopes: ["profile"] }, options);
  const loaded = await loadCredentials(BASE, options);
  assert.equal(loaded.refreshToken, "cdbrt_1");

  if (process.platform !== "win32") {
    const stat = await fs.stat(getCredentialsFile(options));
    assert.equal(stat.mode & 0o777, 0o600);
  }

  // Rotation overwrites in place; other origins are untouched.
  await saveCredentials("https://other.test", { clientId: "codedrobe-skill", refreshToken: "cdbrt_other" }, options);
  await saveCredentials(BASE, { clientId: "codedrobe-skill", refreshToken: "cdbrt_2" }, options);
  assert.equal((await loadCredentials(BASE, options)).refreshToken, "cdbrt_2");
  assert.equal((await loadCredentials("https://other.test", options)).refreshToken, "cdbrt_other");

  assert.equal(await clearCredentials(BASE, options), true);
  assert.equal(await loadCredentials(BASE, options), null);
  assert.equal((await loadCredentials("https://other.test", options)).refreshToken, "cdbrt_other");
});

test("requestDeviceCode surfaces server errors", async () => {
  const fetchImpl = fetchQueue([
    jsonResponse({ error: "invalid_request", error_description: "Unknown scope 'nope'." }, 400),
  ]);
  await assert.rejects(
    requestDeviceCode({ baseUrl: BASE, scopes: ["nope"], fetchImpl }),
    /Unknown scope/,
  );
});

test("pollForTokens handles pending, slow_down backoff, then success", async () => {
  const waits = [];
  const sleep = async (ms) => {
    waits.push(ms);
  };
  const fetchImpl = fetchQueue([
    jsonResponse({ error: "authorization_pending" }, 400),
    jsonResponse({ error: "slow_down" }, 400),
    jsonResponse({ error: "authorization_pending" }, 400),
    jsonResponse({
      access_token: "cdbat_x",
      refresh_token: "cdbrt_x",
      token_type: "Bearer",
      expires_in: 900,
      scope: "openid profile",
    }),
  ]);
  const tokens = await pollForTokens({
    baseUrl: BASE,
    deviceCode: "dev",
    intervalSeconds: 5,
    expiresInSeconds: 900,
    fetchImpl,
    sleep,
  });
  assert.equal(tokens.accessToken, "cdbat_x");
  assert.equal(tokens.refreshToken, "cdbrt_x");
  // RFC 8628: slow_down adds 5s to the interval for every later poll; each
  // sleep carries a +250ms jitter buffer so polls never arrive early.
  assert.deepEqual(waits, [5250, 5250, 10250, 10250]);
});

test("pollForTokens rejects on denial and expiry", async () => {
  const sleep = async () => {};
  await assert.rejects(
    pollForTokens({
      baseUrl: BASE,
      deviceCode: "dev",
      fetchImpl: fetchQueue([jsonResponse({ error: "access_denied" }, 400)]),
      sleep,
    }),
    /denied/,
  );
  await assert.rejects(
    pollForTokens({
      baseUrl: BASE,
      deviceCode: "dev",
      fetchImpl: fetchQueue([jsonResponse({ error: "expired_token" }, 400)]),
      sleep,
    }),
    /expired/,
  );
});

test("refreshTokens maps invalid_grant to TokenRevokedError", async () => {
  await assert.rejects(
    refreshTokens({
      baseUrl: BASE,
      refreshToken: "cdbrt_old",
      fetchImpl: fetchQueue([jsonResponse({ error: "invalid_grant" }, 400)]),
    }),
    TokenRevokedError,
  );
});

test("getAccessToken returns cached token, refreshes when stale, clears on revocation", async () => {
  const home = await makeHome();
  const credentialOptions = { home };

  await assert.rejects(
    getAccessToken({ baseUrl: BASE, fetchImpl: fetchQueue([]), credentialOptions }),
    NotLoggedInError,
  );

  // Fresh token: no network.
  const fresh = credentialsEntryFromTokens(
    { accessToken: "cdbat_fresh", refreshToken: "cdbrt_1", expiresIn: 900, scope: "profile" },
    { scopes: ["profile"] },
  );
  await saveCredentials(BASE, fresh, credentialOptions);
  const noFetch = fetchQueue([]);
  assert.equal(await getAccessToken({ baseUrl: BASE, fetchImpl: noFetch, credentialOptions }), "cdbat_fresh");
  assert.equal(noFetch.calls.length, 0);

  // Stale token: rotates and persists the new pair atomically.
  await saveCredentials(BASE, {
    ...fresh,
    accessToken: "cdbat_stale",
    accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
  }, credentialOptions);
  const rotateFetch = fetchQueue([
    jsonResponse({
      access_token: "cdbat_new",
      refresh_token: "cdbrt_2",
      token_type: "Bearer",
      expires_in: 900,
      scope: "profile",
    }),
  ]);
  assert.equal(await getAccessToken({ baseUrl: BASE, fetchImpl: rotateFetch, credentialOptions }), "cdbat_new");
  const rotated = await loadCredentials(BASE, credentialOptions);
  assert.equal(rotated.refreshToken, "cdbrt_2");
  assert.equal(rotated.accessToken, "cdbat_new");

  // Revoked refresh: credentials are cleared.
  await saveCredentials(BASE, {
    ...rotated,
    accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
  }, credentialOptions);
  await assert.rejects(
    getAccessToken({
      baseUrl: BASE,
      fetchImpl: fetchQueue([jsonResponse({ error: "invalid_grant" }, 400)]),
      credentialOptions,
    }),
    TokenRevokedError,
  );
  assert.equal(await loadCredentials(BASE, credentialOptions), null);
});

test("auth login command completes the device dance and persists credentials", async () => {
  const home = await makeHome();
  const lines = [];
  const opened = [];
  const fetchImpl = fetchQueue([
    jsonResponse({
      device_code: "dev_1",
      user_code: "ABCD1234",
      verification_uri: `${BASE}/device`,
      verification_uri_complete: `${BASE}/device?user_code=ABCD1234`,
      expires_in: 900,
      interval: 5,
    }),
    jsonResponse({ error: "authorization_pending" }, 400),
    jsonResponse({
      access_token: "cdbat_login",
      refresh_token: "cdbrt_login",
      token_type: "Bearer",
      expires_in: 900,
      scope: "openid profile offline_access",
    }),
    jsonResponse({
      data: {
        authenticated: true,
        user: { name: "An Hao", email: "an@example.com" },
        creator: { handle: "anhao" },
      },
    }),
  ]);
  await runAuthCommand(["login"], {}, {
    output: (value) => lines.push(value),
    env: { CODEDROBE_API_BASE: BASE },
    credentialOptions: { home },
    fetchImpl,
    sleep: async () => {},
    openBrowserImpl: (url) => opened.push(url),
  });
  assert.ok(lines.some((line) => typeof line === "string" && line.includes("ABCD-1234")));
  assert.ok(lines.some((line) => typeof line === "string" && line.includes("Logged in as An Hao")));
  assert.deepEqual(opened, [`${BASE}/device?user_code=ABCD1234`]);
  assert.equal((await loadCredentials(BASE, { home })).refreshToken, "cdbrt_login");
});

test("auth logout revokes the refresh token and clears local state", async () => {
  const home = await makeHome();
  await saveCredentials(BASE, {
    clientId: "codedrobe-skill",
    refreshToken: "cdbrt_bye",
    accessToken: "cdbat_bye",
    accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    scopes: ["profile"],
  }, { home });
  const fetchImpl = fetchQueue([jsonResponse({})]);
  const lines = [];
  await runAuthCommand(["logout"], {}, {
    output: (value) => lines.push(value),
    env: { CODEDROBE_API_BASE: BASE },
    credentialOptions: { home },
    fetchImpl,
  });
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.endsWith("/api/auth/oauth2/revoke"));
  assert.ok(JSON.parse(fetchImpl.calls[0].init.body).token === "cdbrt_bye");
  assert.equal(await loadCredentials(BASE, { home }), null);
  assert.ok(lines.some((line) => line === "Logged out."));
});

test("auth status reports revoked sessions without throwing", async () => {
  const home = await makeHome();
  await saveCredentials(BASE, {
    clientId: "codedrobe-skill",
    refreshToken: "cdbrt_gone",
    accessToken: "cdbat_gone",
    accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    scopes: ["profile"],
  }, { home });
  const lines = [];
  await runAuthCommand(["status"], {}, {
    output: (value) => lines.push(value),
    env: { CODEDROBE_API_BASE: BASE },
    credentialOptions: { home },
    fetchImpl: fetchQueue([jsonResponse({ error: "invalid_grant" }, 400)]),
  });
  assert.ok(lines.some((line) => typeof line === "string" && line.includes("revoked")));
});
