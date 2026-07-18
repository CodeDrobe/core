// Covers both editions: QoderWork CN (com.qoder.work.cn) and the global
// QoderWork (com.qoder.work). Their v0.9.12 packages ship byte-identical
// renderer stylesheets and identical landmark class inventories (verified by
// static extraction of the official installers), so one adapter id serves
// both and themes apply unchanged.
const qoderwork = {
  id: "qoderwork",
  displayName: "QoderWork",
  defaultPort: 9337,
  // Real-app signoff exists for the CN edition on macOS only; global macOS
  // and Windows support is based on static package analysis of the same
  // version and stays unverified until a real-app pass.
  lastVerified: {
    darwin: { appVersion: "0.9.12", build: "0.9.12", verifiedAt: "2026-07-19" },
  },
  platforms: {
    darwin: {
      bundleIds: ["com.qoder.work.cn", "com.qoder.work"],
      appCandidates: [
        "/Applications/QoderWork CN.app",
        "~/Applications/QoderWork CN.app",
        "/Applications/QoderWork.app",
        "~/Applications/QoderWork.app",
      ],
      // Each edition names the binary after its bundle; discovery also derives
      // "Contents/MacOS/<bundle name>" per candidate.
      executableRelative: "Contents/MacOS/QoderWork CN",
      processMarkers: [
        "/QoderWork CN.app/Contents/MacOS/QoderWork CN",
        "/QoderWork.app/Contents/MacOS/QoderWork",
      ],
      // The main process forces `remote-debugging-port=0`, so caller-chosen
      // ports never bind; the live port is published only through these files
      // (one user-data directory per edition).
      devToolsActivePortFile: [
        "~/Library/Application Support/QoderWork CN/DevToolsActivePort",
        "~/Library/Application Support/QoderWork/DevToolsActivePort",
      ],
    },
    win32: {
      executableCandidates: [
        "%LOCALAPPDATA%\\Programs\\QoderWork\\QoderWork.exe",
        "%LOCALAPPDATA%\\Programs\\QoderWork CN\\QoderWork CN.exe",
        "%LOCALAPPDATA%\\Programs\\QoderWorkCN\\QoderWorkCN.exe",
      ],
      // electron-builder keys the uninstall entry by appId (or product name on
      // older builds); probe both editions.
      uninstallKeys: ["com.qoder.work", "com.qoder.work.cn", "QoderWork", "QoderWork CN"],
      processNames: ["QoderWork.exe", "QoderWork CN.exe", "QoderWorkCN.exe"],
      devToolsActivePortFile: [
        "%APPDATA%\\QoderWork\\DevToolsActivePort",
        "%APPDATA%\\QoderWork CN\\DevToolsActivePort",
      ],
    },
  },
  matchTarget(target) {
    if (target?.type !== "page") return false;
    const url = String(target.url ?? "");
    if (/^(devtools|chrome-extension):/i.test(url)) return false;
    // Auxiliary windows (artifact preview, quick pick, voice overlay, MCP app
    // preview) live in the same renderer directory but are not the main shell.
    if (/(artifact-preview|mcp-app-preview|quickpick|voice-overlay)\.html/i.test(url)) return false;
    return /app\.asar\/out\/renderer\/index\.html/i.test(url) ||
      /qoderwork/i.test(String(target.title ?? ""));
  },
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint. Everything
    // else warns — panels hide per view/window, and CSS is inert on absent nodes.
    rootAny: ["#root .agents-layout-root", ".agents-layout-root", "#root"],
    recommended: [
      { name: "sidebar", any: [".agents-sidebar", "[data-resizable-sidebar]"] },
      { name: "workspace", any: [".agents-content-area", ".agents-layout-body"] },
      // The editable div has a placeholder twin with the same class, so the
      // contenteditable attribute filter is load-bearing.
      { name: "composer", any: [".chat-input-editor-text[contenteditable='true']"] },
    ],
  },
};

export default qoderwork;
