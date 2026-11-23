# GC_Bridge

**通用模型协作控制台 · Oh My Pi 无头后台 · Codex CLI / Desktop**

GC_Bridge 默认只负责模型之间的交流探讨。协作角色和任务说明由用户在 GUI 修改；项目分析、挑错、产品构思等都属于用户选定的任务，不是自动执行的默认流程。协作模型不限 Gemini，可配置 OpenAI 兼容、Gemini 原生、Anthropic 和 Responses 协议。**默认关闭后台，MCP 接入、打开 GUI 和保存配置都不会启动模型，也不会产生推理请求。**

## 下载与启动

GitHub Actions 的 `build-desktop-binaries` 为 Windows x64、macOS Apple Silicon、macOS Intel 和 Linux x64 分别构建独立程序。产物从 Actions 下载；本项目不在 Actions 自动运行测试或上传测试源码。

- **Windows**：运行 `GCBridge.exe`，自动打开本机浏览器 GUI。无需安装 Node.js、npm、Bun、WSL 或全局 Oh My Pi。
- **macOS**：按芯片下载 arm64 或 x64 的 `.app` 压缩包，解压后打开 `GCBridge.app`。应用使用临时签名，尚无 Apple Developer ID 公证；首次下载可能被 Gatekeeper 提示。请先核对校验值与来源，再按系统提供的单个应用放行流程操作。
- **Linux**：解压 `.tar.gz`，运行 `GCBridge`。归档保留执行权限。

独立程序内置 Bun、Oh My Pi Agent SDK、平台 `.node` 原生组件、网页、默认配置和 gc Skill。启动前自动检查/释放当前版本的内置组件到用户缓存；不要求用户安装交互式 Oh My Pi CLI。`GCBridge components` 可查看 OS/CPU/组件状态。选择错误平台/架构的包不能使用。

Windows 构建未使用商业代码签名证书，SmartScreen 可能显示未知发布者。构建包含 `SHA256SUMS` 与第三方许可证；校验值是完整性线索，不是公证。不要全局关闭系统安全保护。

1. GUI 中设置协作模型、协议、地址、密钥和任务，保存。
2. 在 Codex 接入页点击“检测”，分别核实 CLI、Desktop、WSL 发行版的目标及配置目录，然后选择注入。
3. 重启选定 Codex 客户端后使用 `$gc start`，或 GUI 点击“启动 Bridge”。只启后台，不请求模型。
4. 有明确议题时再调用讨论工具。完整回复保留在工具结果中。

**源码启动**：macOS/Linux 使用 `bash launch.sh gui`。无 Bun 时下载固定 Bun 版本；依赖使用 Bun 自动安装到外部用户缓存，不需要 Node/npm。源码首次启动需要联网、curl/unzip；无网络环境请使用完整编译产物。Windows 源码启动器优先查找同目录 `GCBridge.exe`，其余开发路径可选择 WSL；最终用户不需要这些开发环境。

| 平台 | GCBridge 默认私有配置/数据 | 缓存 |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\GCBridge` | 同目录 `Cache` |
| macOS | `~/Library/Application Support/GCBridge` | `~/Library/Caches/GCBridge` |
| Linux/WSL | `$XDG_CONFIG_HOME/gc-bridge` 或 `~/.config/gc-bridge`；数据 `$XDG_DATA_HOME/gc-bridge` 或 `~/.local/share/gc-bridge` | XDG cache 或 `~/.cache/gc-bridge` |

`GC_BRIDGE_CONFIG`/`--config` 可显式选配置。密钥只在用户私有 `credentials.json`，不会回显或随构建分发。上下文默认 **1,000,000 tokens**，累计预算默认 **100,000 tokens**，两者独立；实际模型容量以服务商为准。Bridge 默认关闭。

Codex 通用入口是 `$gc` Skill + MCP。任意原生 `/gc` 子命令注册不由本项目保证；Oh My Pi 原生扩展支持 `/gc`。Windows exe 被 WSL 调用时通过 interop 使用 Windows 宿主后台/配置；interop 禁用时拒绝注入，改用该 WSL 内的 Linux 版本。不会把 Linux `CODEX_HOME` 写进 Windows 环境。

## 常用操作

| 操作 | 行为 |
| --- | --- |
| `start` / `status` / `stop` | 显式启动、查看、停止同一个共享后台 |
| `read` | 列出并选择讨论，查看完整可见回复；GUI 中回复默认折叠 |
| `delete` | 选择讨论、预览范围、明确确认后永久删除 |
| `new` / `resume` | 新讨论或继续选定历史；不会自动发起推理 |
| `export` | 导出 Markdown，保留实际模型归属 |
| `consult` | `explore` / `brief` / `discuss` / `review`，需后台已启动 |

Codex 中模型完整回复通过 MCP 的原生工具输出和结构化结果返回，避免重复铺进正文；**折叠、展开和截断行为由 Codex 客户端决定**。GUI 的回复使用默认关闭的可展开面板。最终完整方案必须说明：协作模型指出的问题、相较初始方案新增的观点，以及采纳/调整/暂缓/拒绝的建议与原因；没有新增观点时如实说明。

后台使用真实的 **Oh My Pi Agent 19.1.1** SDK，工具列表为空；沿用 pi-ai 模型适配器和原有会话/预算逻辑。没有另起第二个 Codex，当前 Codex 负责判断、编码和验证；没有隐藏的自动辩论或付费循环。可见历史存在 SQLite，停止后台后仍可管理。

## Developer checks

Developer/source builds require Bun ≥ 1.4.4; compiled application users require no JavaScript runtime installation. The bundled OMP SDK version is 19.1.1.

```sh
cd GC_Bridge
bash launch.sh check
bash launch.sh lint
```

`package-lock.json` pins dependencies. The launcher installs them under the external user cache (`~/.cache/gc-bridge/dependencies/<lock-hash>/node_modules` in WSL). npm/Bun caches and temporary output also live outside the checkout. There is no compilation output in the repository.

## Configure

Copy [examples/config.gemini.json](examples/config.gemini.json) or [examples/config.openai-compatible.json](examples/config.openai-compatible.json) to a **private location outside this repository**. Set the exact model ID and versioned base URL offered by your provider.

| Protocol | `director.api` | Base URL convention |
| --- | --- | --- |
| Gemini native | `google-generative-ai` | `https://generativelanguage.googleapis.com/v1beta` |
| OpenAI Chat Completions gateway | `openai-completions` | `https://your-gateway.example/v1` |
| OpenAI Responses | `openai-responses` | `https://your-gateway.example/v1` |
| Anthropic Messages | `anthropic-messages` | Provider API base, normally `https://api.anthropic.com` |

Keep `reasoning: "off"` for gateways whose reasoning controls are unknown; enable `high` or another supported level after verifying compatibility. Model aliases are passed through unchanged. This bridge does not assume which upstream model an alias actually serves.

The GUI manages the default private configuration automatically. Optional `GC_BRIDGE_CONFIG` or `--config` selects another path. A key supplied via the variable named by `director.apiKeyEnv` takes precedence over the private credential file; neither belongs in repository files, command history or MCP JSON/TOML. [Security and local storage](SECURITY.md) explains the boundary.

```sh
bun src/cli.ts doctor --config /absolute/private/path/gc-bridge.json
```

`doctor` checks configuration and credential presence without inference. `components` checks the bundled runtime; `detect-codex` reads installation metadata. Private paths follow the platform table above.

## Oh My Pi: the primary channel

From the coding project, launch your installed Oh My Pi with the extension's absolute path:

```sh
omp --extension /absolute/path/GC_Bridge/src/extension.ts
```

Some installations expose the binary as `pi`; use your installed binary with the same `--extension` option. On Windows use `H:\GC_Bridge\GCBridge\src\extension.ts`; on WSL use `/mnt/h/GC_Bridge/GCBridge/src/extension.ts`. Install dependencies separately for each OS.

Inside Oh My Pi:

```text
/gc start
/gc 为当前项目设计一个有辨识度、可以实际交付的功能，给出首个里程碑和验收条件
```

The command requires explicit start first, then sends only the selected goal to the collaborator. For project-aware or continuing work, ask the coding model to use `gc_bridge` with selected context and reuse the returned `sessionId`. [examples/workflow.md](examples/workflow.md) is a ready-to-use collaboration instruction. The tool respects normal OMP execution approval; no global settings or approval rules are altered.

## Codex and other MCP clients

Use [examples/codex.toml](examples/codex.toml) or a standard MCP entry:

```json
{
  "mcpServers": {
    "gc_bridge": {
      "command": "bun",
      "args": ["/absolute/path/GC_Bridge/src/cli.ts", "mcp", "--config", "/absolute/private/path/gc-bridge.json"]
    }
  }
}
```

The MCP process reads the configured private credential file; an explicitly supplied credential variable takes precedence. The installer sets a 2500-second tool timeout to cover the configurable provider timeout. MCP stdout contains protocol messages only. Prefer either native OMP extension or MCP in one host to avoid duplicate tool names.

## Collaboration example

Call `gc_bridge`:

```json
{"operation":"consult","mode":"explore","prompt":"给知识库增加有创造力的复习功能","context":"当前项目事实与用户限制，经过编码模型选择的简短摘要"}
```

Choose a direction, then call again with `sessionId` and `mode: "brief"`. Check `handoff.valid` and verify the proposed APIs in the actual repository. Implement with normal host tools; then call `review` with selected changes and real test evidence. `discuss` resolves questions. Director suggestions never grant tool authorization or replace user requirements.

Sessions are explicit. There is no autonomous debate loop or background inference. The host decides whether and when to continue.

## CLI

```sh
bun src/cli.ts consult "想三个不同的交互方向" --mode explore
bun src/cli.ts consult "将选定方向整理为实施简报" --session SESSION_UUID --mode brief
bun src/cli.ts consult "评审这些实现与测试证据" --session SESSION_UUID --mode review --context "SELECTED TEXT"
bun src/cli.ts list
bun src/cli.ts get SESSION_UUID
bun src/cli.ts export SESSION_UUID
bun src/cli.ts close SESSION_UUID
bun src/cli.ts recover SESSION_UUID
```

Use `--request-id UUID` to safely repeat the exact same successful request. A reused ID with different arguments is rejected. Failed/pending requests are never resubmitted automatically. After an interrupted request, inspect `get`; `recover` explicitly acknowledges uncertain upstream outcome and permits a **new** request. Session limits do not erase known guidance or silently drop old context. `close` ends collaboration but does not delete history.

Read [architecture](docs/architecture.md), [contributing](CONTRIBUTING.md), and [third-party notices](THIRD_PARTY_NOTICES.md). See the repository LICENSE. Package publication remains disabled with `private: true` until a release is explicitly prepared.


## 讨论工作区（0.3）

在“讨论记录”选择或新建会话，可以使用：

- **分支讨论**：指定轮次边界与新名称，复制该轮及以前的历史，保留父讨论来源。也可为新分支选择另一个已配置模型。原讨论不变；继承用量单独标记，不代表重复付费。
- **观点与采纳记录**：记录提出者、来源轮次、观点内容和采纳状态。采纳、调整、暂缓或拒绝需填写理由；记录代表用户/助手标注，不是模型自动判定的真相。
- **共识与分歧**：按观点、共识、分歧、待澄清问题分组，可编辑来源和决策，最终导出保留归属与理由。
- **上下文选择器**：保存自行粘贴的材料，勾选历史轮次与材料，填写新问题后预览。未勾选历史不发送，完整历史仍保存。确认发送才请求模型；修改选项必须重新预览。
- **任务预设**：内置自由讨论、反方质疑、产品构思，可保存自定义角色与任务；更换设定后新建会话。
- **阶段快照**：保存当时的完整可见讨论和观点记录，并排查看不同阶段。不会自动改写旧快照，也不会为了比较而调用模型。
- **多模型独立意见**：在配置面板添加最多 8 个模型档案，私有密钥分别保存。每次选择 1–4 个目标，预览共同输入和目标地址，确认后顺序征询。每个目标使用独立会话，不读取其他目标的本轮答案；不自动综合或重试，结果逐项保留。

GUI 的配置修改需先停止 Bridge，保存不会启动后台。完整 MCP 操作见 gc Skill；CLI 可通过 `request` 从 stdin 读取同样的 JSON 请求，避免把敏感材料拼进 shell 命令。多模型工具超时上调以覆盖最多四个顺序请求。

分支、材料、观点、快照与预览内容属于私有历史。逻辑删除讨论会删除其附属记录及本讨论创建的预览；独立模型生成的其他会话是独立记录，可在列表分别选择删除。


## GitHub CI

`checks` runs static checks on push, pull requests or manual dispatch, on Ubuntu and Windows with Node 24 / Bun 1.4.5. `build-desktop-binaries` compiles on native Windows, macOS arm64/Intel and Linux hosts after a main-branch push/tag or manual dispatch. Both workflows check TypeScript, source lint, browser JavaScript syntax and tracked-file credential/artifact patterns. `scripts/prepare-ci.mjs` reads `RUNNER_TEMP` at step runtime and exports external dependency/cache/output paths through `GITHUB_ENV`; it also returns the artifact directory through `GITHUB_OUTPUT` for upload. **No tests run on GitHub; no regression test source/data is included.** The build workflow uploads compiled applications, checksums and notices as Actions artifacts (14-day retention). It does not call models, create a GitHub Release or deploy. A workflow file does not imply a successful GitHub run.
