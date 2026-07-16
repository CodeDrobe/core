import codex from "./codex.mjs";
import workbuddy from "./workbuddy.mjs";

const adapters = new Map([codex, workbuddy].map((adapter) => [adapter.id, adapter]));

export function listAdapters() {
  return [...adapters.values()];
}

export function getAdapter(id) {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(`Unsupported app '${id}'. Available apps: ${[...adapters.keys()].join(", ")}`);
  }
  return adapter;
}

export function registerAdapter(adapter) {
  if (!adapter?.id || typeof adapter.matchTarget !== "function") {
    throw new Error("An adapter requires an id and matchTarget(target) function.");
  }
  if (adapters.has(adapter.id)) throw new Error(`Adapter '${adapter.id}' is already registered.`);
  adapters.set(adapter.id, adapter);
}
