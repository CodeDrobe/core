export async function listCdpTargets(port, timeoutMs = 1500) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`CDP endpoint returned HTTP ${response.status}.`);
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error("CDP target list is not an array.");
  return targets;
}

export class CdpSession {
  constructor(target, timeoutMs = 10000) {
    if (typeof WebSocket !== "function") {
      throw new Error("The codedrobe CLI requires Node.js 22.4 or newer for WebSocket support.");
    }
    this.target = target;
    this.timeoutMs = timeoutMs;
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.pending = new Map();
    this.listeners = new Map();
    this.nextId = 1;
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP socket open timed out.")), this.timeoutMs);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", (error) => {
        clearTimeout(timer);
        reject(error);
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => this.#onMessage(event));
    this.socket.addEventListener("close", () => this.#closePending("CDP socket closed."));
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  #onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  #closePending(message) {
    this.closed = true;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
    this.pending.clear();
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed."));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  close() {
    if (!this.closed) this.socket.close();
    this.#closePending("CDP session closed.");
  }
}
