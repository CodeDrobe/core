# CodeDrobe

Multi-app theming CLI and runtime for supported Chromium/Electron desktop applications. CodeDrobe injects reversible `.codedrobe-theme` packages over a loopback Chromium DevTools Protocol connection without modifying application bundles or `app.asar`.

[中文文档](./README_zh.md)

```bash
npx --yes --package=@codedrobe/core@0.3.0 codedrobe apps
npx --yes --package=@codedrobe/core@0.3.0 codedrobe detect
npx --yes --package=@codedrobe/core@0.3.0 codedrobe apply --app workbuddy --theme /absolute/theme.codedrobe-theme
```

Bun is supported as a CLI runtime:

```bash
bunx --package @codedrobe/core@0.3.0 codedrobe apps
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
import { applySkin, getAdapter, readThemePackage, resolveThemeTarget, restoreSkin } from "@codedrobe/core";

const adapter = getAdapter("codex");
const theme = await readThemePackage("/absolute/theme.codedrobe-theme");
const targetTheme = resolveThemeTarget(theme, adapter.id);

await applySkin({ adapter, targetTheme, port: 9335 });
await restoreSkin({ adapter, port: 9335 });
```

Applications should normally use the high-level `applySkin()` and `restoreSkin()` APIs. They coordinate host settings, launch, DOM preflight, renderer injection, verification, and rollback. `watchTheme()` accepts an `AbortSignal`, so an Electron main process can own its lifecycle without relying on process signals.

The package ships TypeScript declarations for the root API and the `@codedrobe/core/adapters` and `@codedrobe/core/theme` subpath exports.

Built-in adapters currently include `codex` and `workbuddy`. Existing applications are never restarted unless `--restart-existing` is explicitly provided.

When a Codex theme changes host appearance settings, a running Codex process must restart before the complete skin can load. Core returns `CODEDROBE_RESTART_REQUIRED` and rolls the settings back unless `--restart-existing` is explicit. Renderer-only changes can still apply live.

If an application is installed outside the adapter's default locations, pass its app bundle, installation directory, or executable file explicitly:

```bash
codedrobe detect --app workbuddy --app-path "/custom/WorkBuddy.app"
codedrobe apply --app workbuddy --app-path "/custom/WorkBuddy.app" --theme /absolute/theme.codedrobe-theme
```

The same `appPath` override is available to applications using the exported `launchApp()` API.

Capture a read-only DOM and computed-style snapshot for AI-assisted theme authoring:

```bash
codedrobe dom snapshot --app codex --output /absolute/codex-dom.json
codedrobe dom snapshot --app workbuddy --port 9440 --max-nodes 1500 --output /absolute/workbuddy-dom.json
```

The snapshot records the active CodeDrobe theme, element relationships, semantic classes, selected safe attributes, stable selector candidates with match counts, bounding boxes, adapter landmark matches, and theme-relevant computed styles. It deliberately excludes text content, form values, accessible names, query/hash data, links, and media sources. Only visible elements are included by default; use `--include-hidden` when a hidden route or dialog must be styled. The command never launches, restarts, or mutates the application.

Applications can call the same read-only API:

```js
import { getAdapter, snapshotDom } from "@codedrobe/core";

const targets = await snapshotDom({
  adapter: getAdapter("workbuddy"),
  port: 9336,
  maxNodes: 1500,
});
```

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

A source manifest can declare up to 32 named PNG, JPEG, WebP, or GIF images. Packing embeds them under `assets.images`; the renderer creates scoped Blob URLs and exposes one CSS variable per image:

```json
{
  "images": {
    "hero": "assets/hero.webp",
    "background": "assets/background.jpg",
    "logo": "assets/logo.png",
    "texture": "assets/texture.png"
  }
}
```

```css
.home-hero { background-image: var(--codedrobe-image-hero); }
.app-shell { background-image: var(--codedrobe-image-background); }
.brand::before { background-image: var(--codedrobe-image-logo); }
.panel { background-image: var(--codedrobe-image-texture); }
```

Image IDs map directly to `--codedrobe-image-<id>`. The `hero` image also aliases to `--codedrobe-art` and, for converted Codex themes, `--dream-art`. Legacy `assets.art` packages still resolve as `assets.images.hero`, while new packing and conversion output `assets.images`.

`codedrobe theme pack` and `codedrobe theme inspect` also report non-blocking selector lint warnings for positional selectors, deep direct-child chains, localized text attributes, generated classes, and unusually long selectors. Keep adapter files limited to stable cross-route landmarks; put feature- and theme-specific DOM dependencies in the theme target.

Convert a legacy Codex-only package without copying JavaScript into a skill:

```bash
codedrobe theme convert ./legacy.codex-theme \
  --output ./legacy.codedrobe-theme
```

The converter validates the old package, preserves its CSS, metadata, copy, artwork, and base-theme options, and creates a declaration-only package with a single `targets.codex` entry. Existing output files require `--force` before they can be replaced.

Converted Codex themes select a trusted renderer profile supplied by Core. It restores the legacy DOM classes, decorative layer, copy, and artwork variables expected by existing CSS while stopping any observer, timer, or style node left by the old Skill runtime. Theme packages remain declaration-only and cannot provide JavaScript.

For Codex themes with `baseTheme`, `applySkin()` changes only the three managed appearance keys under `[desktop]` in `~/.codex/config.toml`. Restore merges those keys from `config.before-codedrobe.toml` and preserves unrelated edits. The default backup path remains compatible with the old Skill (`~/Library/Application Support/CodeDrobe/` on macOS and `%LOCALAPPDATA%\CodeDrobe\` on Windows), and `restoreSkin()` can recover host settings even while Codex/CDP is offline.

The Codex adapter was last verified against macOS app version `26.707.72221` (build `5307`) and the WorkBuddy adapter against macOS `5.2.6`, both on 2026-07-16. WorkBuddy passed the full launch/probe/apply/verify/screenshot/restore flow. Use `codedrobe apps --json` to read this metadata.
