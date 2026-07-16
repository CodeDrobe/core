const codex = {
  id: "codex",
  displayName: "OpenAI Codex",
  defaultPort: 9335,
  platforms: {
    darwin: {
      bundleId: "com.openai.codex",
      appCandidates: ["/Applications/ChatGPT.app", "~/Applications/ChatGPT.app"],
      executableRelative: "Contents/MacOS/ChatGPT",
      processMarkers: ["/ChatGPT.app/Contents/MacOS/ChatGPT"],
    },
    win32: {
      appxPackage: "OpenAI.Codex",
      executableRelative: "app\\ChatGPT.exe",
      processNames: ["ChatGPT.exe"],
    },
  },
  matchTarget(target) {
    return target?.type === "page" && String(target.url ?? "").startsWith("app://");
  },
  verification: {
    rootAny: ["main.main-surface", "main"],
    required: [
      { name: "sidebar", any: ["aside.app-shell-left-panel", "aside"] },
      { name: "composer", any: [".composer-surface-chrome", "[contenteditable='true']", "textarea"] },
    ],
  },
};

export default codex;
