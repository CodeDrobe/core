import {
  applySkin,
  convertLegacyThemePackage,
  getAdapter,
  launchApp,
  probeApp,
  restoreSkin,
  snapshotDom,
  watchTheme,
  type LegacyThemePackage,
  type ThemePackage,
} from "@codedrobe/core";
import {
  convertLegacyThemePackage as convertLegacyFromThemeEntry,
  resolveThemeTarget,
  type ThemeLintWarning,
} from "@codedrobe/core/theme";
import { listAdapters, type AppAdapter } from "@codedrobe/core/adapters";

const adapter: AppAdapter = getAdapter("codex");
const adapters: AppAdapter[] = listAdapters();
void adapters;

const legacy: LegacyThemePackage = {
  format: "codex-theme",
  schemaVersion: 1,
  manifest: {
    schemaVersion: 1,
    id: "typed",
    displayName: "Typed",
    version: "1.0.0",
    css: "theme.css",
  },
  css: ":root { color: red; }",
};

const converted: ThemePackage = convertLegacyThemePackage(legacy);
const convertedFromThemeEntry: ThemePackage = convertLegacyFromThemeEntry(legacy);
void convertedFromThemeEntry;
const target = resolveThemeTarget(converted, adapter.id);
const imageUrls: Record<string, string> = target.imageDataUrls;
void imageUrls;
const warnings: ThemeLintWarning[] = [];
void warnings;
void launchApp({ adapter, port: 9444, appPath: "/Applications/ChatGPT.app" });
void probeApp({ adapter, port: 9444, targetTheme: target, timeoutMs: 5000 });
void snapshotDom({ adapter, port: 9444, timeoutMs: 5000, maxNodes: 800 });
void applySkin({ adapter, targetTheme: target, port: 9444, launch: false });
void restoreSkin({ adapter, port: 9444 });
const controller = new AbortController();
void watchTheme({ adapter, targetTheme: target, port: 9444, signal: controller.signal });
