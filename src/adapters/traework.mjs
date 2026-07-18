// TRAE SOLO is a VS Code (Code-OSS) derivative, but its main window is the
// custom "solo-lite" shell (React under #root), not the Monaco workbench, so
// the landmarks below are solo-lite classes verified across the Work, Code,
// and Design home routes plus the task conversation route.
//
// Covers both editions: global TRAE SOLO (com.trae.solo.app) and TRAE SOLO CN
// (cn.trae.solo.app). Their v0.1.36 packages share the same Code-OSS commit
// and a byte-identical solo-lite UI stylesheet (verified by static extraction
// of the official installers), so one adapter id serves both and themes apply
// unchanged.
const traework = {
  id: "traework",
  displayName: "TRAE SOLO",
  defaultPort: 9338,
  // Real-app signoff exists for the global edition on macOS only; the CN
  // edition and Windows support are based on static package analysis of the
  // same version and stay unverified until a real-app pass.
  lastVerified: {
    // build is the Code-OSS commit from product.json (app base 1.107.1).
    darwin: { appVersion: "0.1.36", build: "ce5758dc", verifiedAt: "2026-07-19" },
  },
  platforms: {
    darwin: {
      bundleIds: ["com.trae.solo.app", "cn.trae.solo.app"],
      appCandidates: [
        "/Applications/TRAE SOLO.app",
        "~/Applications/TRAE SOLO.app",
        "/Applications/TRAE SOLO CN.app",
        "~/Applications/TRAE SOLO CN.app",
      ],
      // Both editions keep the stock Electron binary name.
      executableRelative: "Contents/MacOS/Electron",
      processMarkers: [
        "/TRAE SOLO.app/Contents/MacOS/Electron",
        "/TRAE SOLO CN.app/Contents/MacOS/Electron",
      ],
    },
    win32: {
      // VS Code-style Inno Setup: user setups land in %LOCALAPPDATA%\Programs\
      // <win32DirName>, system setups in %PROGRAMFILES%; the executable is
      // named after product.json nameShort.
      executableCandidates: [
        "%LOCALAPPDATA%\\Programs\\TRAE SOLO\\TRAE SOLO.exe",
        "%LOCALAPPDATA%\\Programs\\TRAE SOLO CN\\TRAE SOLO CN.exe",
        "%PROGRAMFILES%\\TRAE SOLO\\TRAE SOLO.exe",
        "%PROGRAMFILES%\\TRAE SOLO CN\\TRAE SOLO CN.exe",
      ],
      // Inno Setup keys the uninstall entry by the product.json AppId GUID
      // plus the "_is1" suffix (x64/arm64 × user/system × global/CN).
      uninstallKeys: [
        "{8F316A45-DB23-480D-A345-3B00ECBCE79D}_is1",
        "{9F4ECBF8-0F5D-4282-81D7-C4D00F79E68A}_is1",
        "{71014002-986F-48F1-AC35-32576E223DD8}_is1",
        "{F86046C4-D092-4BA8-9138-2156ED846F89}_is1",
        "{953A2114-1972-4389-9722-1F54639F3958}_is1",
        "{422F0E0D-9BEF-4EB5-8AF0-B515EEE7197E}_is1",
        "{4562FAED-D9B1-4B2D-801B-A2AAE734FB7E}_is1",
        "{E7D41D89-D044-48DF-B02C-6A2443FB1E49}_is1",
      ],
      processNames: ["TRAE SOLO.exe", "TRAE SOLO CN.exe"],
    },
  },
  matchTarget(target) {
    if (target?.type !== "page") return false;
    const url = String(target.url ?? "");
    if (/^(devtools|chrome-extension):/i.test(url)) return false;
    // Auxiliary windows (process explorer, file preview) live in sibling
    // electron-browser directories; only the solo-lite shell is the main UI.
    return /\/electron-browser\/solo\/solo-lite\.html/i.test(url);
  },
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint. The home
    // routes render .panel-container while conversations render
    // .solo-lite-layout, so both satisfy the any-list. Everything else warns —
    // panels hide per view/window, and CSS is inert on absent nodes.
    rootAny: ["#root .panel-container", "#root .solo-lite-layout", "#root"],
    recommended: [
      { name: "sidebar", any: [".task-list-base", ".task-list-panel"] },
      { name: "workspace", any: [".panel-container", ".solo-lite-layout"] },
      { name: "composer", any: [".chat-input-v2-input-box-editable[contenteditable='true']"] },
    ],
  },
};

export default traework;
