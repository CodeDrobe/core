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

export interface RendererProfileVerification {
  id: string;
  pass: boolean;
  missing?: Array<{ name: string; selectors?: string[] }>;
  [key: string]: unknown;
}

export interface RendererProfileRuntime {
  ensure?: () => unknown;
  cleanup?: () => unknown;
  verify?: () => RendererProfileVerification;
}

export interface RendererProfile {
  id: string;
  runtime(context: {
    theme: ThemeIdentity;
    imageDataUrls: Record<string, string>;
    imageUrls: Record<string, string>;
    artDataUrl: string | null;
    artUrl: string | null;
  }): RendererProfileRuntime;
  cleanup?: () => unknown;
}

export interface HostSettingsTransaction {
  supported: boolean;
  applied: boolean;
  changed: boolean;
  restartRequired?: boolean;
  rollback(): Promise<void>;
  [key: string]: unknown;
}

export interface HostSettingsResult {
  supported: boolean;
  applied?: boolean;
  restored?: boolean;
  changed?: boolean;
  [key: string]: unknown;
}

export interface HostSettingsAdapter {
  apply(context: {
    targetTheme: ResolvedThemeTarget;
    platform: string;
    options: Record<string, unknown>;
  }): Promise<HostSettingsTransaction>;
  restore(context: {
    platform: string;
    options: Record<string, unknown>;
  }): Promise<HostSettingsResult>;
  publicResult?(transaction: HostSettingsTransaction): HostSettingsResult;
}

export interface AppAdapter {
  id: string;
  displayName: string;
  defaultPort: number;
  platforms: Partial<Record<SupportedPlatform, AdapterPlatformConfig>> & Record<string, AdapterPlatformConfig | undefined>;
  lastVerified?: Partial<Record<SupportedPlatform, AdapterVerificationRecord>>;
  verification?: VerificationProfile;
  rendererProfiles?: Record<string, RendererProfile>;
  hostSettings?: HostSettingsAdapter;
  matchTarget(target: CdpTarget): boolean;
}

export interface ThemeIdentity {
  id: string;
  displayName: string;
  version: string;
  copy?: Record<string, unknown>;
}

export interface ThemeImage {
  filename: string;
  mimeType: string;
  base64: string;
}

export interface ThemeArt extends ThemeImage {}

export interface ThemeTarget {
  css: string;
  options?: Record<string, unknown> & {
    rendererProfile?: string;
    baseTheme?: Record<string, unknown>;
  };
  verification?: VerificationProfile;
}

export interface ThemePackage {
  format: "codedrobe-theme";
  schemaVersion: 1;
  exportedAt?: string;
  theme: ThemeIdentity;
  targets: Record<string, ThemeTarget>;
  assets?: {
    images?: Record<string, ThemeImage>;
    /** @deprecated Use images.hero for new theme packages. */
    art?: ThemeArt;
  };
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
  imageDataUrls: Record<string, string>;
  /** Backward-compatible alias for imageDataUrls.hero. */
  artDataUrl: string | null;
}

export interface SelectorParseError {
  selector: string;
  error: string;
}

export interface CompatibilityIssue {
  scope: "adapter" | "theme" | "profile";
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
  images?: string[];
  profile?: RendererProfileVerification | null;
  pass?: boolean;
}

export interface TargetResult<T = unknown> {
  targetId: string;
  title?: string;
  url?: string;
  result: T;
}

export interface DomSnapshotSelector {
  selector: string;
  count: number;
  valid: boolean;
  error?: string;
}

export interface DomSnapshotNode {
  index: number;
  parentIndex: number | null;
  depth: number;
  tag: string;
  id: string | null;
  classes: string[];
  semanticClasses: string[];
  attributes: Record<string, string>;
  selectors: DomSnapshotSelector[];
  rect: { x: number; y: number; width: number; height: number };
  states: { visible: boolean; interactive: boolean; editable: boolean };
  styles: Record<string, string>;
}

export interface DomSnapshotResult {
  schemaVersion: 1;
  appId: string;
  capturedAt: string;
  activeTheme: { installed: boolean; id: string | null; version: string | null };
  route: { protocol: string; origin: string | null; pathname: string };
  viewport: { width: number; height: number; devicePixelRatio: number };
  privacy: {
    textContent: false;
    formValues: false;
    accessibleNames: false;
    linksAndMediaSources: false;
    queryAndHash: false;
  };
  limits: { maxNodes: number; includeHidden: boolean };
  summary: {
    documentElements: number;
    eligibleNodes: number;
    recordedNodes: number;
    truncated: boolean;
    openShadowRoots: number;
  };
  landmarks: Array<{
    name: string;
    kind: "root" | "required" | "recommended";
    selectors: Array<DomSnapshotSelector & { visibleCount: number }>;
  }>;
  nodes: DomSnapshotNode[];
}

export interface DomSnapshotOptions {
  adapter: AppAdapter;
  port: number;
  timeoutMs?: number;
  maxNodes?: number;
  includeHidden?: boolean;
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

export interface HostSettingsOptions {
  configPath?: string;
  backupPath?: string;
  home?: string;
  stateRoot?: string;
  env?: Record<string, string | undefined>;
  [key: string]: unknown;
}

export interface ApplySkinOptions {
  adapter: AppAdapter;
  targetTheme: ResolvedThemeTarget;
  port?: number;
  launch?: boolean;
  appPath?: string | null;
  profilePath?: string | null;
  restartExisting?: boolean;
  timeoutMs?: number;
  hostOptions?: HostSettingsOptions;
}

export interface ApplySkinResult {
  action: "apply";
  appId: string;
  port: number;
  theme: ThemeIdentity;
  launch: LaunchResult | null;
  host: HostSettingsResult;
  targets: Array<TargetResult<CompatibilityResult>>;
}

export interface RestoreSkinOptions {
  adapter: AppAdapter;
  port?: number;
  timeoutMs?: number;
  hostOptions?: HostSettingsOptions;
}

export interface RestoreSkinResult {
  action: "restore";
  appId: string;
  port: number;
  renderer: {
    restored: boolean;
    targets?: Array<TargetResult<boolean>>;
    code?: string | null;
    message?: string;
  };
  host: HostSettingsResult;
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
export const MAX_THEME_IMAGES: number;
export const DOM_SNAPSHOT_DEFAULT_MAX_NODES: number;
export const DOM_SNAPSHOT_MAX_NODES: number;
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
export function snapshotDom(options: DomSnapshotOptions): Promise<Array<TargetResult<DomSnapshotResult>>>;
export function applyTheme(options: ThemeRuntimeOptions & { targetTheme: ResolvedThemeTarget }): Promise<Array<TargetResult<CompatibilityResult>>>;
export function verifyTheme(options: ThemeRuntimeOptions): Promise<Array<TargetResult<CompatibilityResult>>>;
export function removeTheme(options: Omit<ThemeRuntimeOptions, "targetTheme">): Promise<Array<TargetResult<boolean>>>;
export function captureScreenshot(options: Omit<ThemeRuntimeOptions, "targetTheme"> & { output: string }): Promise<string>;
export function watchTheme(options: ThemeRuntimeOptions & {
  targetTheme: ResolvedThemeTarget;
  onEvent?: (event: Record<string, unknown>) => void;
  signal?: AbortSignal | null;
}): Promise<void>;

export function applySkin(options: ApplySkinOptions): Promise<ApplySkinResult>;
export function restoreSkin(options: RestoreSkinOptions): Promise<RestoreSkinResult>;
export function prepareHostSettings(options: {
  adapter: AppAdapter;
  targetTheme: ResolvedThemeTarget;
  platform?: string;
  options?: HostSettingsOptions;
}): Promise<HostSettingsTransaction>;
export function restoreHostSettings(options: {
  adapter: AppAdapter;
  platform?: string;
  options?: HostSettingsOptions;
}): Promise<HostSettingsResult>;

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
