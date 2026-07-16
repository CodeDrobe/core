# CodeDrobe Core

CodeDrobe Core 是面向多个 Chromium/Electron 桌面应用的主题运行时、命令行工具和适配器协议。它不修改应用包、不改写 `app.asar`，通过绑定到 `127.0.0.1` 的 Chromium DevTools Protocol 注入可恢复的 CSS 主题。

首批内置适配器：

- `codex`：OpenAI Codex Desktop，默认端口 `9335`。
- `workbuddy`：Tencent WorkBuddy，默认端口 `9336`。

## 本地使用

要求 Node.js 22.4 或更高版本；也可以使用 Bun 1.3 或更高版本执行 CLI。

全局安装后直接使用：

```bash
npm install --global @codedrobe/core
codedrobe --version
codedrobe apps
```

无需全局安装：

```bash
npx --yes --package=@codedrobe/core@0.1.0 codedrobe apps
bunx --package @codedrobe/core@0.1.0 codedrobe apps
```

在源码仓库中也可以直接通过 Bun 运行：

```bash
bun ./bin/codedrobe.mjs apps
```

Skill 应固定 `codedrobe` 的准确版本，避免 `npx` 自动取得新版本后行为漂移。CodeDrobe Desktop 等软件则把它作为普通依赖，在 Electron 主进程使用导出的 API：

```bash
npm install @codedrobe/core
```

```js
import { getAdapter, launchApp, readThemePackage } from "@codedrobe/core";
```

Skill 目录不再复制 JavaScript 运行时，只保留 `SKILL.md`、必要 references 和对 `@codedrobe/core@固定版本` 的调用说明。

本仓库开发时可以链接命令：

```bash
npm link
codedrobe apps
codedrobe detect
```

应用主题：

```bash
codedrobe apply \
  --app workbuddy \
  --theme /absolute/dream-1.0.0.codedrobe-theme
```

如果应用已经在未开启 CDP 的状态下运行，命令会停止并要求用户自行关闭应用，或者显式传入：

```bash
codedrobe apply \
  --app workbuddy \
  --theme /absolute/dream-1.0.0.codedrobe-theme \
  --restart-existing
```

持续覆盖页面重载和新窗口：

```bash
codedrobe apply --app workbuddy --theme /absolute/theme.codedrobe-theme --watch
```

验证、截图和恢复：

```bash
codedrobe verify --app workbuddy --theme /absolute/theme.codedrobe-theme
codedrobe verify --app workbuddy --screenshot /absolute/workbuddy.png
codedrobe restore --app workbuddy
```

## `.codedrobe-theme`

`.codedrobe-theme` 是 UTF-8 JSON 文件，不是 ZIP。一个主题包可以为多个应用携带不同 CSS：

```json
{
  "format": "codedrobe-theme",
  "schemaVersion": 1,
  "theme": {
    "id": "dream",
    "displayName": "Dream Multi-App",
    "version": "1.0.0"
  },
  "targets": {
    "codex": { "css": "/* Codex CSS */" },
    "workbuddy": { "css": "/* WorkBuddy CSS */" }
  }
}
```

主题包限制为 30MB，拒绝外部 `url(...)` 与 `@import`。主题包只能包含声明式配置、CSS 和内嵌图片，不能携带或执行 JavaScript。

开发主题时先维护源清单和独立 CSS 文件：

```json
{
  "schemaVersion": 1,
  "id": "dream",
  "displayName": "Dream Multi-App",
  "version": "1.0.0",
  "targets": {
    "codex": { "css": "codex.css" },
    "workbuddy": { "css": "workbuddy.css" }
  }
}
```

打包和检查：

```bash
codedrobe theme pack ./theme.json --output ./dream-1.0.0.codedrobe-theme
codedrobe theme inspect ./dream-1.0.0.codedrobe-theme
```

## 适配器职责

应用适配器只描述宿主差异：

- macOS Bundle ID、候选路径和可执行文件。
- Windows Appx 包或候选安装路径。
- 独立默认 CDP 端口。
- CDP 页面目标识别规则。
- 页面根节点、工作区和输入区域的验证探针。

CDP 会话、注入、重载监听、截图、主题包校验和恢复由通用运行时负责。新增应用时注册新适配器，不复制整套启动脚本或注入器。

## 当前验证状态

- macOS 应用发现：已验证 Codex 与 WorkBuddy。
- `.codedrobe-theme` 双目标打包与读取：已自动化测试。
- WorkBuddy 实际 DOM 选择器和视觉效果：需要在用户允许重启 WorkBuddy 并开启本地 CDP 后完成截图验收。
- Windows 应用发现和启动：已实现适配入口，尚需 Windows 实机验证。

## 与旧项目的关系

`codedrobe-codex-skill` 后续应改为调用 `codedrobe` npm 包的 Codex adapter。旧 `.codex-theme` 可由兼容层转换成只包含 `targets.codex` 的 `.codedrobe-theme`，不应继续把 Codex 专属配置写入通用核心。
