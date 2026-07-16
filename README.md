# CodeDrobe

Multi-app theming CLI and runtime for supported Chromium/Electron desktop applications. CodeDrobe injects reversible `.codedrobe-theme` packages over a loopback Chromium DevTools Protocol connection without modifying application bundles or `app.asar`.

[中文文档](./README_zh.md)

```bash
npx --yes --package=@codedrobe/core@0.1.0 codedrobe apps
npx --yes --package=@codedrobe/core@0.1.0 codedrobe detect
npx --yes --package=@codedrobe/core@0.1.0 codedrobe apply --app workbuddy --theme /absolute/theme.codedrobe-theme
```

Bun is supported as a CLI runtime:

```bash
bunx --package @codedrobe/core@0.1.0 codedrobe apps
```

Applications can consume the same package as an ES module:

```bash
npm install @codedrobe/core
```

```js
import { getAdapter, launchApp, readThemePackage } from "@codedrobe/core";
```

Built-in adapters currently include `codex` and `workbuddy`. Existing applications are never restarted unless `--restart-existing` is explicitly provided.
