import codexThemeV1Profile from "../runtime/profiles/codex-theme-v1.mjs";
import codexHostSettings from "../host/codex-settings.mjs";

const codex = {
  id: "codex",
  displayName: "OpenAI Codex",
  defaultPort: 9335,
  lastVerified: {
    darwin: { appVersion: "26.707.72221", build: "5307", verifiedAt: "2026-07-16" },
  },
  rendererProfiles: {
    [codexThemeV1Profile.id]: codexThemeV1Profile,
  },
  hostSettings: codexHostSettings,
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
    rootAny: ["main.main-surface"],
    required: [
      { name: "sidebar", any: ["aside.app-shell-left-panel"] },
      { name: "composer", any: [".composer-surface-chrome"] },
    ],
  },
};

export default codex;
