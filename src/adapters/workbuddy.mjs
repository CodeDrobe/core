const workbuddy = {
  id: "workbuddy",
  displayName: "Tencent WorkBuddy",
  defaultPort: 9336,
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
      processNames: ["WorkBuddy.exe", "Electron.exe"],
    },
  },
  matchTarget(target) {
    if (target?.type !== "page") return false;
    const url = String(target.url ?? "");
    if (/^(devtools|chrome-extension):/i.test(url)) return false;
    return /workbuddy/i.test(String(target.title ?? "")) ||
      /^(workbuddy|vscode-file|file):/i.test(url) ||
      /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url);
  },
  verification: {
    rootAny: [".monaco-workbench", "[class*='workbench']", "main"],
    required: [
      { name: "workspace", any: [".monaco-workbench", "[class*='workbench']", "main"] },
      { name: "input", any: ["[contenteditable='true']", "textarea", "input[type='text']"] },
    ],
  },
};

export default workbuddy;
