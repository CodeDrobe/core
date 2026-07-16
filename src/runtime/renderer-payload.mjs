function safeHostClass(appId) {
  return `codedrobe-host-${String(appId).replace(/[^a-z0-9_-]/gi, "-")}`;
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

export function buildVerifyExpression(adapter, expectedTheme = null) {
  const profile = JSON.stringify(adapter.verification ?? { rootAny: ["body"], required: [] });
  const appId = JSON.stringify(adapter.id);
  const expected = JSON.stringify(expectedTheme);
  return `(() => {
    const appId = ${appId};
    const profile = ${profile};
    const expected = ${expected};
    const query = (selector) => { try { return document.querySelector(selector); } catch { return null; } };
    const visible = (node) => {
      if (!node) return false;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const state = window.__CODEDROBE__?.hosts?.[appId];
    const rootMatches = (profile.rootAny ?? ['body']).filter((selector) => visible(query(selector)));
    const requirements = (profile.required ?? []).map((item) => {
      const matches = item.any.filter((selector) => visible(query(selector)));
      return { name: item.name, pass: matches.length > 0, matches };
    });
    const result = {
      installed: Boolean(state),
      appId,
      themeId: state?.themeId ?? null,
      version: state?.version ?? null,
      stylePresent: Boolean(document.getElementById('codedrobe-theme-style-' + appId)),
      rootMatches,
      requirements,
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
    const themeMatches = !expected || (result.themeId === expected.id && result.version === expected.version);
    result.pass = result.installed && result.stylePresent && rootMatches.length > 0 &&
      requirements.every((item) => item.pass) && themeMatches && !result.horizontalOverflow;
    return result;
  })()`;
}
