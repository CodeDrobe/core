export type SupportedPlatform = "darwin" | "win32";

export interface CdpTarget {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl: string;
  [key: string]: unknown;
}

export interface VerificationRequirement {
  name: string;
  any: string[];
}

export interface VerificationContext {
  name: string;
  when: { any: string[] };
  required?: VerificationRequirement[];
  recommended?: VerificationRequirement[];
}

export interface VerificationProfile {
  rootAny?: string[];
  required?: VerificationRequirement[];
  recommended?: VerificationRequirement[];
  contexts?: VerificationContext[];
}

export interface AdapterPlatformConfig {
  bundleId?: string;
  appCandidates?: string[];
  appxPackage?: string;
  executableRelative?: string;
  executableCandidates?: string[];
  processMarkers?: string[];
  processNames?: string[];
}

export interface AdapterVerificationRecord {
  appVersion: string;
  build?: string;
  verifiedAt: string;
}

export interface AppAdapter {
  id: string;
  displayName: string;
  defaultPort: number;
  platforms: Partial<Record<SupportedPlatform, AdapterPlatformConfig>> & Record<string, AdapterPlatformConfig | undefined>;
  lastVerified?: Partial<Record<SupportedPlatform, AdapterVerificationRecord>>;
  verification?: VerificationProfile;
  matchTarget(target: CdpTarget): boolean;
}

export interface ThemeIdentity {
  id: string;
  displayName: string;
  version: string;
  copy?: Record<string, unknown>;
}

export interface ThemeArt {
  filename: string;
  mimeType: string;
  base64: string;
}

export interface ThemeTarget {
  css: string;
  options?: Record<string, unknown>;
  verification?: VerificationProfile;
}

export interface ThemePackage {
  format: "codedrobe-theme";
  schemaVersion: 1;
  exportedAt?: string;
  theme: ThemeIdentity;
  targets: Record<string, ThemeTarget>;
  assets?: { art?: ThemeArt };
}

export interface LegacyThemeManifest extends ThemeIdentity {
  schemaVersion: 1;
  css: string;
  art?: string | null;
  baseTheme?: Record<string, unknown>;
}

export interface LegacyThemePackage {
  format: "codex-theme";
  schemaVersion: 1;
  exportedAt?: string;
  manifest: LegacyThemeManifest;
  css: string;
  art?: ThemeArt;
}

export type LegacyThemeArt = ThemeArt;

export interface ConvertLegacyThemeFileResult {
  input: string;
  output: string;
  bundle: ThemePackage;
}

export interface ResolvedThemeTarget {
  theme: ThemeIdentity;
  css: string;
  options: Record<string, unknown>;
  verification: VerificationProfile | null;
  artDataUrl: string | null;
}

export interface SelectorParseError {
  selector: string;
  error: string;
}

export interface CompatibilityIssue {
  scope: "adapter" | "theme";
  context: string | null;
  severity: "required" | "recommended";
  name: string;
  selectors: string[];
  invalidSelectors: SelectorParseError[];
}

export interface CompatibilityRequirement extends CompatibilityIssue {
  pass: boolean;
  matches: string[];
}

export interface CompatibilityContextResult {
  scope: "adapter" | "theme";
  name: string;
  active: boolean;
  matches: string[];
  selectors: string[];
  invalidSelectors: SelectorParseError[];
}

export interface CompatibilityResult {
  appId: string;
  compatible: boolean;
  rootMatches: string[];
  rootInvalidSelectors: SelectorParseError[];
  contexts: CompatibilityContextResult[];
  requirements: CompatibilityRequirement[];
  missing: CompatibilityIssue[];
  warnings: CompatibilityIssue[];
  viewport: { width: number; height: number };
  installed?: boolean;
  themeId?: string | null;
  version?: string | null;
  stylePresent?: boolean;
  horizontalOverflow?: boolean;
  pass?: boolean;
}

export interface TargetResult<T = unknown> {
  targetId: string;
  title?: string;
  url?: string;
  result: T;
}

export interface AppInstallation {
  appId: string;
  appPath: string;
  executable: string;
}

export interface LaunchOptions {
  adapter: AppAdapter;
  port?: number;
  appPath?: string | null;
  profilePath?: string | null;
  restartExisting?: boolean;
  timeoutMs?: number;
}

export interface LaunchResult {
  appId: string;
  port: number;
  alreadyReady?: boolean;
  executable?: string;
  pid?: number;
  targets: number;
}

export interface ThemeRuntimeOptions {
  adapter: AppAdapter;
  targetTheme?: ResolvedThemeTarget | null;
  port: number;
  timeoutMs?: number;
}

export interface ThemeLintWarning {
  code: string;
  appId: string;
  location: string;
  selector: string;
  message: string;
}

export class CdpSession {
  constructor(target: CdpTarget, timeoutMs?: number);
  readonly target: CdpTarget;
  readonly timeoutMs: number;
  readonly closed: boolean;
  open(): Promise<this>;
  on(method: string, listener: (params: Record<string, unknown>) => void): void;
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  close(): void;
}

export const VERSION: string;
export const THEME_FORMAT: "codedrobe-theme";
export const THEME_EXTENSION: ".codedrobe-theme";
export const THEME_SCHEMA_VERSION: 1;
export const MAX_THEME_PACKAGE_BYTES: number;
export const LEGACY_THEME_FORMAT: "codex-theme";
export const LEGACY_THEME_EXTENSION: ".codex-theme";
export const LEGACY_THEME_SCHEMA_VERSION: 1;

export function listAdapters(): AppAdapter[];
export function getAdapter(id: string): AppAdapter;
export function registerAdapter(adapter: AppAdapter): void;
export function listCdpTargets(port: number, timeoutMs?: number): Promise<CdpTarget[]>;
export function discoverApp(adapter: AppAdapter, platform?: string, appPath?: string | null): Promise<AppInstallation | null>;
export function findRunningPids(adapter: AppAdapter, platform?: string, executablePath?: string | null): Promise<number[]>;
export function launchApp(options: LaunchOptions): Promise<LaunchResult>;
export function findTargets(adapter: AppAdapter, port: number, timeoutMs?: number): Promise<CdpTarget[]>;
export function waitForTargets(adapter: AppAdapter, port: number, timeoutMs?: number): Promise<CdpTarget[]>;
export function probeApp(options: ThemeRuntimeOptions): Promise<Array<TargetResult<CompatibilityResult>>>;
export function applyTheme(options: ThemeRuntimeOptions & { targetTheme: ResolvedThemeTarget }): Promise<Array<TargetResult<CompatibilityResult>>>;
export function verifyTheme(options: ThemeRuntimeOptions): Promise<Array<TargetResult<CompatibilityResult>>>;
export function removeTheme(options: Omit<ThemeRuntimeOptions, "targetTheme">): Promise<Array<TargetResult<boolean>>>;
export function captureScreenshot(options: Omit<ThemeRuntimeOptions, "targetTheme"> & { output: string }): Promise<string>;
export function watchTheme(options: ThemeRuntimeOptions & {
  targetTheme: ResolvedThemeTarget;
  onEvent?: (event: Record<string, unknown>) => void;
}): Promise<void>;

export function validateThemePackage(bundle: unknown): ThemePackage;
export function readThemePackage(filename: string): Promise<ThemePackage>;
export function resolveThemeTarget(bundle: ThemePackage, appId: string): ResolvedThemeTarget;
export function lintThemePackage(bundle: ThemePackage): ThemeLintWarning[];
export function buildThemePackage(manifestFilename: string): Promise<{ bundle: ThemePackage; serialized: string }>;
export function writeThemePackage(manifestFilename: string, outputFilename: string, options?: { force?: boolean }): Promise<{ output: string; bundle: ThemePackage }>;
export function validateLegacyThemePackage(bundle: unknown): LegacyThemePackage;
export function readLegacyThemePackage(filename: string): Promise<LegacyThemePackage>;
export function convertLegacyThemePackage(bundle: LegacyThemePackage): ThemePackage;
export function convertLegacyThemeFile(inputFilename: string, outputFilename: string, options?: { force?: boolean }): Promise<ConvertLegacyThemeFileResult>;
