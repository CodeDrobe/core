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
npx --yes --package=@codedrobe/core@0.2.0 codedrobe apps
bunx --package @codedrobe/core@0.2.0 codedrobe apps
```

在源码仓库中也可以直接通过 Bun 运行：

```bash
bun ./bin/codedrobe.mjs apps
```

检查和安装全局 CLI 的新版本：

```bash
codedrobe update --check
codedrobe update
codedrobe update --check --json
```

`codedrobe update` 会根据当前运行环境选择 npm、Bun 或 pnpm，安装 `@codedrobe/core@latest` 的全局版本。普通命令只会在全局安装、交互式终端中检查更新；检查结果缓存 24 小时，网络失败不会影响原命令。`--json`、CI、非交互执行和固定版本的 `npx`/`bunx` 调用不会出现升级提示。可以设置 `NO_UPDATE_NOTIFIER=1` 或 `CODEDROBE_DISABLE_UPDATE_CHECK=1` 关闭自动检查。

Skill 应固定 `codedrobe` 的准确版本，避免 `npx` 自动取得新版本后行为漂移。CodeDrobe Desktop 等软件则把它作为普通依赖，在 Electron 主进程使用导出的 API：

```bash
npm install @codedrobe/core
```

```js
import { getAdapter, launchApp, readThemePackage } from "@codedrobe/core";
```

npm 包内置 TypeScript 类型声明，覆盖根入口以及 `@codedrobe/core/adapters`、`@codedrobe/core/theme` 子路径，不需要另外安装 `@types` 包。

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

如果应用不在适配器的默认安装位置，可以通过 `--app-path` 传入应用目录、macOS `.app` 包或可执行文件：

```bash
codedrobe detect --app workbuddy --app-path "/custom/WorkBuddy.app"
codedrobe apply \
  --app workbuddy \
  --app-path "/custom/WorkBuddy.app" \
  --theme /absolute/dream-1.0.0.codedrobe-theme
```

软件直接使用 `launchApp()` API 时，也可以传入同名的 `appPath` 字段。

只检查当前应用 DOM，不注入或移除主题：

```bash
codedrobe probe --app codex
codedrobe probe --app codex --theme /absolute/theme.codedrobe-theme --json
codedrobe probe --app workbuddy --timeout-ms 10000
```

`probe` 不会启动或重启应用。命令会立即显示正在检查的地址，默认等待 5 秒；找不到 CDP renderer 时会提示对应的 `codedrobe launch` 命令。可以使用 `--timeout-ms` 将等待时间设置为 250 毫秒至 5 分钟。

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
    "workbuddy": {
      "css": "/* WorkBuddy CSS */",
      "verification": {
        "required": [
          {
            "name": "chat-surface",
            "any": [".chat-container", ".wb-cb-chat"]
          }
        ],
        "recommended": [
          {
            "name": "conversation-list",
            "any": [".conversation-list"]
          }
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

主题包限制为 30MB，拒绝外部 `url(...)` 与 `@import`。主题包只能包含声明式配置、CSS 和内嵌图片，不能携带或执行 JavaScript。

`targets.<app>.verification` 是可选的主题专属 DOM 依赖：

- `required`：缺失时阻止注入。
- `recommended`：缺失时只返回警告，不阻止注入。
- `contexts`：通过 `when.any` 判断当前页面，只在上下文激活时检查其中的 `required` 和 `recommended`。

Core 会在注入前合并适配器基础探针和主题探针。验证结果会返回探针来源、上下文、名称、全部尝试过的选择器以及无效选择器的解析错误。

开发主题时先维护源清单和独立 CSS 文件：

```json
{
  "schemaVersion": 1,
  "id": "dream",
  "displayName": "Dream Multi-App",
  "version": "1.0.0",
  "targets": {
    "codex": { "css": "codex.css" },
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

打包和检查：

```bash
codedrobe theme pack ./theme.json --output ./dream-1.0.0.codedrobe-theme
codedrobe theme inspect ./dream-1.0.0.codedrobe-theme
```

打包和检查命令会额外输出非阻断的选择器 lint 警告，包括位置选择器、过深的直接子节点链、依赖本地化文本的属性、生成类名和过长选择器。适配器应只保留跨页面稳定地标；功能页和主题专属 DOM 依赖放在主题 target 中。

旧版 Codex 专属主题可以直接转换，不需要在 Skill 中复制 JavaScript：

```bash
codedrobe theme convert ./legacy.codex-theme \
  --output ./legacy.codedrobe-theme
```

转换器会先验证旧主题包，保留 CSS、主题元数据、文案、图片和基础主题选项，再生成只包含 `targets.codex` 的声明式新主题包。输出文件已存在时必须显式传入 `--force` 才会覆盖。

## 适配器职责

应用适配器只描述宿主差异：

- macOS Bundle ID、候选路径和可执行文件。
- Windows Appx 包或候选安装路径。
- 独立默认 CDP 端口。
- CDP 页面目标识别规则。
- 页面根节点、工作区和输入区域的验证探针。
- 每个平台最后一次实机验证的应用版本和日期。

CDP 会话、注入前预检、主题探针合并、缺失节点报告、重载监听、截图、主题包校验和恢复由通用运行时负责。新增应用时注册新适配器，不复制整套启动脚本或注入器。

## 当前验证状态

- macOS 应用发现：已验证 Codex 与 WorkBuddy。
- `.codedrobe-theme` 双目标打包与读取：已自动化测试。
- Codex 26.707.72221（build 5307）macOS 任务页的基础 DOM 探针：已通过本地 CDP 实机验证。
- WorkBuddy 5.2.6 macOS 欢迎页：已完成 `launch/probe/apply/verify/screenshot/restore` 全流程实机验证，主题探针、视觉截图和恢复均通过。
- Windows 应用发现和启动：已实现适配入口，尚需 Windows 实机验证。

## 与旧项目的关系

`codedrobe-codex-skill` 后续应改为调用 `codedrobe` npm 包的 Codex adapter。旧 `.codex-theme` 使用 `codedrobe theme convert` 转换成只包含 `targets.codex` 的 `.codedrobe-theme`，不应继续把 Codex 专属配置写入通用核心。
