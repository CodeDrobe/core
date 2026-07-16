# CodeDrobe

Multi-app theming CLI and runtime for supported Chromium/Electron desktop applications. CodeDrobe injects reversible `.codedrobe-theme` packages over a loopback Chromium DevTools Protocol connection without modifying application bundles or `app.asar`.

[中文文档](./README_zh.md)

```bash
npx --yes --package=@codedrobe/core@0.2.0 codedrobe apps
npx --yes --package=@codedrobe/core@0.2.0 codedrobe detect
npx --yes --package=@codedrobe/core@0.2.0 codedrobe apply --app workbuddy --theme /absolute/theme.codedrobe-theme
```

Bun is supported as a CLI runtime:

```bash
bunx --package @codedrobe/core@0.2.0 codedrobe apps
```

Check for or install the latest global CLI version:

```bash
codedrobe update --check
codedrobe update
codedrobe update --check --json
```

Interactive global installations check at most once every 24 hours and print an update hint only when a newer version is available. JSON output, CI, non-interactive runs, and pinned `npx`/`bunx` invocations stay silent. Set `NO_UPDATE_NOTIFIER=1` or `CODEDROBE_DISABLE_UPDATE_CHECK=1` to disable automatic checks.

Applications can consume the same package as an ES module:

```bash
npm install @codedrobe/core
```

```js
import { getAdapter, launchApp, readThemePackage } from "@codedrobe/core";
```

The package ships TypeScript declarations for the root API and the `@codedrobe/core/adapters` and `@codedrobe/core/theme` subpath exports.

Built-in adapters currently include `codex` and `workbuddy`. Existing applications are never restarted unless `--restart-existing` is explicitly provided.

If an application is installed outside the adapter's default locations, pass its app bundle, installation directory, or executable file explicitly:

```bash
codedrobe detect --app workbuddy --app-path "/custom/WorkBuddy.app"
codedrobe apply --app workbuddy --app-path "/custom/WorkBuddy.app" --theme /absolute/theme.codedrobe-theme
```

The same `appPath` override is available to applications using the exported `launchApp()` API.

Probe an application's current DOM without injecting or removing a theme:

```bash
codedrobe probe --app codex
codedrobe probe --app codex --theme /absolute/theme.codedrobe-theme --json
codedrobe probe --app workbuddy --timeout-ms 10000
```

`probe` never launches or restarts an application. It prints the target address immediately, waits 5 seconds by default, and suggests the matching `codedrobe launch` command when no CDP renderer is available. Use `--timeout-ms` to change the wait from 250ms up to 5 minutes.

CodeDrobe probes each adapter's stable cross-route renderer landmarks before injecting CSS. A theme may add required landmarks, advisory landmarks, and route-specific contexts without adding runtime JavaScript:

```json
{
  "targets": {
    "workbuddy": {
      "css": "workbuddy.css",
      "verification": {
        "required": [
          { "name": "chat-surface", "any": [".chat-container", ".wb-cb-chat"] }
        ],
        "recommended": [
          { "name": "conversation-list", "any": [".conversation-list"] }
        ],
        "contexts": [
          {
            "name": "active-chat",
            "when": { "any": [".chat-route"] },
            "required": [
              { "name": "message-list", "any": [".message-list"] }
            ]
          }
        ]
      }
    }
  }
}
```

Missing adapter or theme `required` landmarks stop injection and report the scope, active context, name, attempted selectors, and selector parse errors. Missing `recommended` landmarks are returned as warnings without blocking injection. Context checks run only while one of their `when.any` landmarks is visible.

`codedrobe theme pack` and `codedrobe theme inspect` also report non-blocking selector lint warnings for positional selectors, deep direct-child chains, localized text attributes, generated classes, and unusually long selectors. Keep adapter files limited to stable cross-route landmarks; put feature- and theme-specific DOM dependencies in the theme target.

Convert a legacy Codex-only package without copying JavaScript into a skill:

```bash
codedrobe theme convert ./legacy.codex-theme \
  --output ./legacy.codedrobe-theme
```

The converter validates the old package, preserves its CSS, metadata, copy, artwork, and base-theme options, and creates a declaration-only package with a single `targets.codex` entry. Existing output files require `--force` before they can be replaced.

The Codex adapter was last verified against macOS app version `26.707.72221` (build `5307`) and the WorkBuddy adapter against macOS `5.2.6`, both on 2026-07-16. WorkBuddy passed the full launch/probe/apply/verify/screenshot/restore flow. Use `codedrobe apps --json` to read this metadata.
