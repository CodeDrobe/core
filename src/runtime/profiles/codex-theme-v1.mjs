export const CODEX_THEME_V1_PROFILE = "codex-theme-v1";

function runtime({ theme, imageDataUrls = {}, imageUrls = {}, artDataUrl, artUrl = imageUrls.hero ?? artDataUrl }) {
  const CHROME_ID = "codedrobe-codex-skin-chrome";
  const LEGACY_STYLE_ID = "codedrobe-codex-skin-style";
  const LEGACY_STATE_KEY = "__CODEDROBE_CODEX_SKIN_STATE__";
  const copy = {
    brandTitle: theme.displayName ?? "CodeDrobe",
    brandSubtitle: "",
    signature: "",
    tagline: "",
    projectPrefix: "",
    projectLabel: "",
    ribbon: "✦",
    ...(theme.copy ?? {}),
  };
  const cssString = (value) => JSON.stringify(String(value ?? ""));

  const stopLegacyRuntime = () => {
    window.__CODEDROBE_CODEX_SKIN_DISABLED__ = true;
    const legacyState = window[LEGACY_STATE_KEY];
    try { legacyState?.cleanup?.(); } catch { /* Fall through to static cleanup. */ }
    legacyState?.observer?.disconnect?.();
    if (legacyState?.timer) clearInterval(legacyState.timer);
    if (legacyState?.scheduler?.timeout) clearTimeout(legacyState.scheduler.timeout);
    if (legacyState?.artUrl) globalThis.URL?.revokeObjectURL?.(legacyState.artUrl);
    document.getElementById(LEGACY_STYLE_ID)?.remove();
    delete window[LEGACY_STATE_KEY];
  };

  stopLegacyRuntime();

  const updateChromeCopy = (chrome) => {
    chrome.querySelector(".dream-brand-title").textContent = String(copy.brandTitle ?? "");
    chrome.querySelector(".dream-brand-subtitle").textContent = String(copy.brandSubtitle ?? "");
    chrome.querySelector(".dream-signature").textContent = String(copy.signature ?? "");
    chrome.querySelector(".dream-ribbon-emoji").textContent = String(copy.ribbon ?? "");
  };

  const ensure = () => {
    const root = document.documentElement;
    if (!root) return false;
    root.classList.add("codedrobe-codex-skin");
    root.dataset.codexSkinTheme = theme.id;
    if (artUrl) root.style.setProperty("--dream-art", `url("${artUrl}")`);
    else root.style.removeProperty("--dream-art");
    root.style.setProperty("--dream-tagline", cssString(copy.tagline));
    root.style.setProperty("--dream-project-prefix", cssString(copy.projectPrefix));
    root.style.setProperty("--dream-project-label", cssString(copy.projectLabel));

    const shellMain = document.querySelector("main.main-surface") || document.querySelector("main");
    const home = document.querySelector('[role="main"]:has([data-testid="home-icon"])');
    for (const candidate of document.querySelectorAll('[role="main"].dream-home')) {
      if (candidate !== home) candidate.classList.remove("dream-home");
    }
    if (home) home.classList.add("dream-home");
    if (!shellMain || !document.body) return true;

    shellMain.classList.toggle("dream-home-shell", Boolean(home));
    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body || !chrome.querySelector(".dream-brand-title")) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.setAttribute("aria-hidden", "true");
      chrome.innerHTML = `
        <div class="dream-brand"><span class="dream-note">♫</span><span><b class="dream-brand-title"></b><small class="dream-brand-subtitle"></small></span></div>
        <div class="dream-signature"></div>
        <div class="dream-sparkles"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="dream-ribbon"><span>♡</span><b class="dream-ribbon-emoji"></b><span>✦</span></div>
        <div class="dream-polaroid"></div>`;
      document.body.appendChild(chrome);
    }
    updateChromeCopy(chrome);
    const shellBox = shellMain.getBoundingClientRect();
    chrome.style.left = `${Math.round(shellBox.left)}px`;
    chrome.style.top = `${Math.round(shellBox.top)}px`;
    chrome.style.width = `${Math.round(shellBox.width)}px`;
    chrome.style.height = `${Math.round(shellBox.height)}px`;
    chrome.classList.toggle("dream-home-shell", Boolean(home));
    return true;
  };

  const cleanup = () => {
    const root = document.documentElement;
    root?.classList.remove("codedrobe-codex-skin");
    if (root) delete root.dataset.codexSkinTheme;
    root?.style.removeProperty("--dream-art");
    root?.style.removeProperty("--dream-tagline");
    root?.style.removeProperty("--dream-project-prefix");
    root?.style.removeProperty("--dream-project-label");
    document.querySelectorAll(".dream-home").forEach((node) => node.classList.remove("dream-home"));
    document.querySelectorAll(".dream-home-shell").forEach((node) => node.classList.remove("dream-home-shell"));
    document.getElementById(CHROME_ID)?.remove();
  };

  const verify = () => {
    const root = document.documentElement;
    const chrome = document.getElementById(CHROME_ID);
    const nativeHome = document.querySelector('[role="main"]:has([data-testid="home-icon"])');
    const markedHome = document.querySelector('[role="main"].dream-home');
    const missing = [];
    if (!root?.classList.contains("codedrobe-codex-skin")) {
      missing.push({ name: "legacy-root-class", selectors: ["html.codedrobe-codex-skin"] });
    }
    if (!chrome) missing.push({ name: "legacy-chrome", selectors: ["#codedrobe-codex-skin-chrome"] });
    if (chrome && getComputedStyle(chrome).pointerEvents !== "none") {
      missing.push({ name: "noninteractive-chrome", selectors: ["#codedrobe-codex-skin-chrome { pointer-events: none }"] });
    }
    if (artDataUrl && !root?.style.getPropertyValue("--dream-art")) {
      missing.push({ name: "legacy-art-variable", selectors: ["--dream-art"] });
    }
    if (nativeHome && markedHome !== nativeHome) {
      missing.push({ name: "legacy-home-marker", selectors: ['[role="main"].dream-home'] });
    }
    return {
      id: "codex-theme-v1",
      pass: missing.length === 0,
      missing,
      rootClassPresent: Boolean(root?.classList.contains("codedrobe-codex-skin")),
      chromePresent: Boolean(chrome),
      homeContextActive: Boolean(nativeHome),
      homeMarked: !nativeHome || markedHome === nativeHome,
    };
  };

  return { ensure, cleanup, verify };
}

function cleanup() {
  window.__CODEDROBE_CODEX_SKIN_DISABLED__ = true;
  const legacyState = window.__CODEDROBE_CODEX_SKIN_STATE__;
  try { legacyState?.cleanup?.(); } catch { /* Fall through to static cleanup. */ }
  legacyState?.observer?.disconnect?.();
  if (legacyState?.timer) clearInterval(legacyState.timer);
  if (legacyState?.scheduler?.timeout) clearTimeout(legacyState.scheduler.timeout);
  if (legacyState?.artUrl) globalThis.URL?.revokeObjectURL?.(legacyState.artUrl);
  delete window.__CODEDROBE_CODEX_SKIN_STATE__;
  const root = document.documentElement;
  root?.classList.remove("codedrobe-codex-skin");
  if (root) delete root.dataset.codexSkinTheme;
  root?.style.removeProperty("--dream-art");
  root?.style.removeProperty("--dream-tagline");
  root?.style.removeProperty("--dream-project-prefix");
  root?.style.removeProperty("--dream-project-label");
  document.querySelectorAll(".dream-home").forEach((node) => node.classList.remove("dream-home"));
  document.querySelectorAll(".dream-home-shell").forEach((node) => node.classList.remove("dream-home-shell"));
  document.getElementById("codedrobe-codex-skin-style")?.remove();
  document.getElementById("codedrobe-codex-skin-chrome")?.remove();
}

export default {
  id: CODEX_THEME_V1_PROFILE,
  runtime,
  cleanup,
};
