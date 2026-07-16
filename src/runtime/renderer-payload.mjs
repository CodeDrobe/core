function safeHostClass(appId) {
  return `codedrobe-host-${String(appId).replace(/[^a-z0-9_-]/gi, "-")}`;
}

function buildCompatibilityProfile(adapter, themeVerification = null) {
  const adapterProfile = adapter.verification ?? { rootAny: ["body"], required: [] };
  const checks = (verification, scope, context = null) => [
    ...(verification?.required ?? []).map((item) => ({ ...item, scope, context, severity: "required" })),
    ...(verification?.recommended ?? []).map((item) => ({ ...item, scope, context, severity: "recommended" })),
  ];
  const contexts = (verification, scope) => (verification?.contexts ?? []).map((context) => ({
    name: context.name,
    scope,
    whenAny: context.when.any,
    checks: checks(context, scope, context.name),
  }));
  return {
    rootAny: adapterProfile.rootAny ?? ["body"],
    checks: [
      ...checks(adapterProfile, "adapter"),
      ...checks(themeVerification, "theme"),
    ],
    contexts: [
      ...contexts(adapterProfile, "adapter"),
      ...contexts(themeVerification, "theme"),
    ],
  };
}

function buildCompatibilityPrelude(adapter, themeVerification = null) {
  const profile = JSON.stringify(buildCompatibilityProfile(adapter, themeVerification));
  const appId = JSON.stringify(adapter.id);
  return `
    const appId = ${appId};
    const profile = ${profile};
    const inspect = (selector) => {
      try { return { selector, node: document.querySelector(selector), valid: true, error: null }; }
      catch (error) { return { selector, node: null, valid: false, error: error?.message ?? String(error) }; }
    };
    const visible = (node) => {
      if (!node) return false;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const evaluateSelectors = (selectors) => {
      const inspected = selectors.map(inspect);
      return {
        matches: inspected.filter((item) => item.valid && visible(item.node)).map((item) => item.selector),
        invalidSelectors: inspected.filter((item) => !item.valid).map((item) => ({ selector: item.selector, error: item.error })),
      };
    };
    const root = evaluateSelectors(profile.rootAny);
    const contexts = profile.contexts.map((context) => {
      const trigger = evaluateSelectors(context.whenAny);
      return {
        scope: context.scope,
        name: context.name,
        active: trigger.matches.length > 0,
        matches: trigger.matches,
        selectors: context.whenAny,
        invalidSelectors: trigger.invalidSelectors,
      };
    });
    const activeContexts = new Set(contexts.filter((context) => context.active).map((context) => context.scope + ':' + context.name));
    const checks = [
      ...profile.checks,
      ...profile.contexts.flatMap((context) => activeContexts.has(context.scope + ':' + context.name) ? context.checks : []),
    ];
    const requirements = checks.map((item) => {
      const evaluated = evaluateSelectors(item.any);
      return {
        scope: item.scope,
        context: item.context,
        severity: item.severity,
        name: item.name,
        pass: evaluated.matches.length > 0,
        matches: evaluated.matches,
        selectors: item.any,
        invalidSelectors: evaluated.invalidSelectors,
      };
    });
    const diagnostic = (item) => ({
      scope: item.scope,
      context: item.context,
      severity: item.severity,
      name: item.name,
      selectors: item.selectors,
      invalidSelectors: item.invalidSelectors,
    });
    const missing = [];
    const warnings = [];
    if (!root.matches.length) missing.push({
      scope: 'adapter', context: null, severity: 'required', name: 'root',
      selectors: profile.rootAny, invalidSelectors: root.invalidSelectors,
    });
    for (const item of requirements) {
      if (!item.pass && item.severity === 'required') missing.push(diagnostic(item));
      if (!item.pass && item.severity === 'recommended') warnings.push(diagnostic(item));
    }
    const compatibility = {
      appId,
      compatible: missing.length === 0,
      rootMatches: root.matches,
      rootInvalidSelectors: root.invalidSelectors,
      contexts,
      requirements,
      missing,
      warnings,
      viewport: { width: innerWidth, height: innerHeight },
    };`;
}

export function buildApplyExpression({ adapter, targetTheme }) {
  const host = JSON.stringify({ id: adapter.id, className: safeHostClass(adapter.id) });
  const theme = JSON.stringify(targetTheme.theme);
  const css = JSON.stringify(targetTheme.css);
  const art = JSON.stringify(targetTheme.artDataUrl);
  return `(() => {
    const host = ${host};
    const theme = ${theme};
    const cssText = ${css};
    const artDataUrl = ${art};
    const rootState = window.__CODEDROBE__ ||= { hosts: {} };
    rootState.hosts ||= {};
    rootState.hosts[host.id]?.cleanup?.();
    const styleId = 'codedrobe-theme-style-' + host.id;

    const ensure = () => {
      const root = document.documentElement;
      if (!root) return false;
      root.classList.add('codedrobe-theme', host.className);
      root.dataset.codedrobeHost = host.id;
      root.dataset.codedrobeTheme = theme.id;
      root.dataset.codedrobeThemeVersion = theme.version;
      if (artDataUrl) root.style.setProperty('--codedrobe-art', 'url("' + artDataUrl + '")');
      else root.style.removeProperty('--codedrobe-art');
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        (document.head || root).appendChild(style);
      }
      if (style.dataset.themeVersion !== theme.id + '@' + theme.version) {
        style.textContent = cssText;
        style.dataset.themeVersion = theme.id + '@' + theme.version;
      }
      return true;
    };

    let timer;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(ensure, 120);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const interval = setInterval(ensure, 5000);
    const cleanup = () => {
      observer.disconnect();
      clearTimeout(timer);
      clearInterval(interval);
      document.getElementById(styleId)?.remove();
      const root = document.documentElement;
      root?.classList.remove(host.className);
      root?.style.removeProperty('--codedrobe-art');
      if (root?.dataset.codedrobeHost === host.id) {
        delete root.dataset.codedrobeHost;
        delete root.dataset.codedrobeTheme;
        delete root.dataset.codedrobeThemeVersion;
      }
      delete rootState.hosts[host.id];
      if (!Object.keys(rootState.hosts).length) root?.classList.remove('codedrobe-theme');
      return true;
    };
    rootState.hosts[host.id] = { cleanup, ensure, observer, interval, themeId: theme.id, version: theme.version };
    ensure();
    return { installed: true, appId: host.id, themeId: theme.id, version: theme.version };
  })()`;
}

export function buildRemoveExpression(adapter) {
  const appId = JSON.stringify(adapter.id);
  return `(() => {
    const appId = ${appId};
    const state = window.__CODEDROBE__?.hosts?.[appId];
    if (state?.cleanup) return state.cleanup();
    document.getElementById('codedrobe-theme-style-' + appId)?.remove();
    document.documentElement?.classList.remove('codedrobe-host-' + appId);
    return true;
  })()`;
}

export function buildProbeExpression(adapter, themeVerification = null) {
  return `(() => {
    ${buildCompatibilityPrelude(adapter, themeVerification)}
    return compatibility;
  })()`;
}

export function buildVerifyExpression(adapter, expectedTheme = null, themeVerification = null) {
  const expected = JSON.stringify(expectedTheme);
  return `(() => {
    ${buildCompatibilityPrelude(adapter, themeVerification)}
    const expected = ${expected};
    const state = window.__CODEDROBE__?.hosts?.[appId];
    const result = {
      ...compatibility,
      installed: Boolean(state),
      themeId: state?.themeId ?? null,
      version: state?.version ?? null,
      stylePresent: Boolean(document.getElementById('codedrobe-theme-style-' + appId)),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
    const themeMatches = !expected || (result.themeId === expected.id && result.version === expected.version);
    result.pass = result.compatible && result.installed && result.stylePresent && themeMatches && !result.horizontalOverflow;
    return result;
  })()`;
}
