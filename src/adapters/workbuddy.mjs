const workbuddy = {
  id: "workbuddy",
  displayName: "Tencent WorkBuddy",
  defaultPort: 9336,
  lastVerified: {
    darwin: { appVersion: "5.2.6", build: "5.2.6", verifiedAt: "2026-07-16" },
    win32: { appVersion: "5.2.6", build: "5.2.6", verifiedAt: "2026-07-18" },
  },
  platforms: {
    darwin: {
      bundleId: "com.workbuddy.workbuddy",
      appCandidates: ["/Applications/WorkBuddy.app", "~/Applications/WorkBuddy.app"],
      executableRelative: "Contents/MacOS/Electron",
      processMarkers: ["/WorkBuddy.app/Contents/MacOS/Electron"],
    },
    win32: {
      executableCandidates: [
        "%LOCALAPPDATA%\\Programs\\WorkBuddy\\WorkBuddy.exe",
        "%LOCALAPPDATA%\\WorkBuddy\\WorkBuddy.exe",
        "%PROGRAMFILES%\\WorkBuddy\\WorkBuddy.exe"
      ],
      // Covers installs on non-default drives (e.g. D:\Program Files) via the
      // installer's registry uninstall entry.
      uninstallKeys: ["WorkBuddy"],
      processNames: ["WorkBuddy.exe", "Electron.exe"],
    },
  },
  matchTarget(target) {
    if (target?.type !== "page") return false;
    const url = String(target.url ?? "");
    if (/^(devtools|chrome-extension):/i.test(url)) return false;
    return /workbuddy/i.test(String(target.title ?? "")) ||
      /app\.asar\/renderer\/index\.html$/i.test(url) ||
      /^(workbuddy|vscode-file):/i.test(url) ||
      /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url);
  },
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint. Everything
    // else warns — panels hide per view/window, and CSS is inert on absent nodes.
    rootAny: ["#root > .teams-container", ".teams-container", "#root"],
    recommended: [
      { name: "sidebar", any: [".conversation-sidebar", ".conversation-list"] },
      { name: "workspace", any: [".teams-main-content", ".main-content", ".chat-container"] },
      { name: "composer", any: ["[role='textbox'][contenteditable='true']", ".wb-home-composer [contenteditable='true']"] },
    ],
  },
};

export default workbuddy;
