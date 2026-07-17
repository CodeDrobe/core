import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CREDENTIALS_VERSION = 1;

export function getCredentialsFile({ env = process.env, home = os.homedir() } = {}) {
  if (env.CODEDROBE_CREDENTIALS_FILE) return path.resolve(env.CODEDROBE_CREDENTIALS_FILE);
  return path.join(home, ".codedrobe", "credentials.json");
}

async function readStore(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.version === CREDENTIALS_VERSION
      && parsed.credentials && typeof parsed.credentials === "object") {
      return parsed;
    }
  } catch {
    // Missing or corrupt file — treated as logged out.
  }
  return { version: CREDENTIALS_VERSION, credentials: {} };
}

/**
 * Atomic write: the new file is fully written before it replaces the old one,
 * so a rotated refresh token is never lost to a partial write. 0600/0700 modes
 * are best-effort (no-ops on Windows).
 */
async function writeStore(file, store) {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
  try {
    await fs.chmod(file, 0o600);
  } catch {
    // Windows or restricted FS — ignore.
  }
}

/** Credentials are keyed by API origin so staging and production coexist. */
export async function loadCredentials(origin, options = {}) {
  const file = getCredentialsFile(options);
  const store = await readStore(file);
  const entry = store.credentials[origin];
  if (!entry || typeof entry !== "object" || typeof entry.refreshToken !== "string") return null;
  return entry;
}

export async function saveCredentials(origin, entry, options = {}) {
  const file = getCredentialsFile(options);
  const store = await readStore(file);
  store.credentials[origin] = entry;
  await writeStore(file, store);
}

export async function clearCredentials(origin, options = {}) {
  const file = getCredentialsFile(options);
  const store = await readStore(file);
  if (!(origin in store.credentials)) return false;
  delete store.credentials[origin];
  await writeStore(file, store);
  return true;
}
