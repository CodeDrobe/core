import { clearCredentials, loadCredentials, saveCredentials } from "./credentials.mjs";

export const CLIENT_ID = "codedrobe-skill";
export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const DEFAULT_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "theme:read",
  "theme:write",
  "theme:submit",
];

const ACCESS_TOKEN_RENEW_MARGIN_MS = 60 * 1000;

export class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export class NotLoggedInError extends AuthError {
  constructor() {
    super("Not logged in. Run `codedrobe auth login` first.", "not_logged_in");
    this.name = "NotLoggedInError";
  }
}

export class TokenRevokedError extends AuthError {
  constructor() {
    super("Session was revoked or expired. Run `codedrobe auth login` again.", "token_revoked");
    this.name = "TokenRevokedError";
  }
}

export function resolveBaseUrl(env = process.env) {
  const raw = (env.CODEDROBE_API_BASE || "https://codedrobe.app").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AuthError(`Invalid CODEDROBE_API_BASE '${raw}'.`, "invalid_base_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AuthError("CODEDROBE_API_BASE must use http(s).", "invalid_base_url");
  }
  return url.origin;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function requestDeviceCode({ baseUrl, scopes = DEFAULT_SCOPES, fetchImpl = fetch }) {
  const response = await fetchImpl(`${baseUrl}/api/auth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: scopes.join(" ") }),
  });
  const body = await readJson(response);
  if (!response.ok || !body?.device_code || !body?.user_code) {
    const description = body?.error_description || body?.message || `HTTP ${response.status}`;
    throw new AuthError(`Device authorization failed: ${description}`, body?.error || "device_code_failed");
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri || `${baseUrl}/device`,
    verificationUriComplete: body.verification_uri_complete
      || `${baseUrl}/device?user_code=${encodeURIComponent(body.user_code)}`,
    expiresIn: Number(body.expires_in) || 900,
    interval: Number(body.interval) || 5,
  };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the token endpoint per RFC 8628: wait `interval` between polls, add 5s
 * on slow_down, and stop on denial/expiry.
 */
export async function pollForTokens({
  baseUrl,
  deviceCode,
  intervalSeconds = 5,
  expiresInSeconds = 900,
  onTick,
  fetchImpl = fetch,
  sleep = defaultSleep,
}) {
  let interval = Math.max(intervalSeconds, 1);
  const deadline = Date.now() + expiresInSeconds * 1000;

  while (Date.now() < deadline) {
    // +250ms buffer so timer jitter never lands a poll before the server's
    // minimum interval (which would trigger snowballing slow_down backoff).
    await sleep(interval * 1000 + 250);
    onTick?.();
    const response = await fetchImpl(`${baseUrl}/api/auth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: DEVICE_CODE_GRANT,
        device_code: deviceCode,
        client_id: CLIENT_ID,
      }),
    });
    const body = await readJson(response);
    if (response.ok && body?.access_token) {
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? null,
        expiresIn: Number(body.expires_in) || 900,
        scope: typeof body.scope === "string" ? body.scope : "",
      };
    }
    const error = body?.error;
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval += 5;
      continue;
    }
    if (error === "access_denied") throw new AuthError("The request was denied in the browser.", "access_denied");
    if (error === "expired_token") throw new AuthError("The device code expired before approval.", "expired_token");
    throw new AuthError(
      `Token request failed: ${body?.error_description || error || `HTTP ${response.status}`}`,
      error || "token_failed",
    );
  }
  throw new AuthError("Timed out waiting for approval.", "expired_token");
}

export async function refreshTokens({ baseUrl, refreshToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`${baseUrl}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  const body = await readJson(response);
  if (!response.ok || !body?.access_token) {
    if (body?.error === "invalid_grant") throw new TokenRevokedError();
    throw new AuthError(
      `Token refresh failed: ${body?.error_description || body?.error || `HTTP ${response.status}`}`,
      body?.error || "refresh_failed",
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? refreshToken,
    expiresIn: Number(body.expires_in) || 900,
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

export async function revokeToken({ baseUrl, token, fetchImpl = fetch }) {
  try {
    await fetchImpl(`${baseUrl}/api/auth/oauth2/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token, client_id: CLIENT_ID }),
    });
  } catch {
    // Best-effort: local logout proceeds regardless.
  }
}

export async function fetchMe({ baseUrl, accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`${baseUrl}/api/v1/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const body = await readJson(response);
  if (!response.ok || !body?.data) {
    if (response.status === 401) throw new TokenRevokedError();
    throw new AuthError(`Fetching identity failed: HTTP ${response.status}`, "me_failed");
  }
  return body.data;
}

export function credentialsEntryFromTokens(tokens, { scopes }) {
  return {
    clientId: CLIENT_ID,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    refreshToken: tokens.refreshToken,
    scopes: tokens.scope ? tokens.scope.split(" ") : scopes,
    obtainedAt: new Date().toISOString(),
  };
}

/**
 * Silent-renew seam: returns a valid access token, refreshing (and atomically
 * persisting the rotated pair) when the cached one is about to expire. Future
 * API commands (e.g. `codedrobe theme publish`) call this.
 */
export async function getAccessToken({ baseUrl, fetchImpl = fetch, credentialOptions = {} }) {
  const entry = await loadCredentials(baseUrl, credentialOptions);
  if (!entry) throw new NotLoggedInError();

  const expiresAt = Date.parse(entry.accessTokenExpiresAt ?? "");
  if (entry.accessToken && Number.isFinite(expiresAt)
    && expiresAt - Date.now() > ACCESS_TOKEN_RENEW_MARGIN_MS) {
    return entry.accessToken;
  }

  try {
    const rotated = await refreshTokens({ baseUrl, refreshToken: entry.refreshToken, fetchImpl });
    await saveCredentials(baseUrl, credentialsEntryFromTokens(rotated, { scopes: entry.scopes }), credentialOptions);
    return rotated.accessToken;
  } catch (error) {
    if (error instanceof TokenRevokedError) {
      await clearCredentials(baseUrl, credentialOptions);
    }
    throw error;
  }
}
