# pi-extras

[English](README.en.md)

个人维护的 [Pi](https://pi.dev) Package，用于集中保存、维护和分发可复用的 Pi skills 与 extensions。资源既包括自行编写的功能，也包括经过审查并保留来源与许可证信息的第三方实现。

## 安装

从本地开发检出安装时，先安装运行时依赖；Pi 的本地路径安装不会代为执行这一步：

```bash
cd ~/.pi/pi-extras
pnpm install
pi install .
```

也可以直接安装 Git 仓库，或将该来源加入 `pi-package-catalog` 统一管理；Git 安装会自动安装运行时依赖：

```bash
pi install git:github.com/v2naix/pi-extras
```

资源变更后，在 Pi 中执行 `/reload` 或重启。Git 安装可通过 `pi update --extensions` 更新。

## Skills

| Skill | 功能描述 | 调用方式与环境 |
| --- | --- | --- |
| [`pi-extras`](skills/pi-extras/SKILL.md) | 维护本仓库的 Pi 资源：将 Agent 生成或从其他来源取得的 skills 与 extensions 收录到正确的开发仓库，并负责新增、审查、修改、替换和清理移除。 | 相关维护请求可按需加载，也可显式调用 `/skill:pi-extras`；需要 Git 及 `v2naix/pi-extras` 的可写开发检出。 |
| [`pi-resource-audit`](skills/pi-resource-audit/SKILL.md) | 对 Pi extensions、skills 和 packages 进行静态、证据驱动的审核，覆盖安全、隐私、正确性、质量、供应链和 Pi API 合规性；默认快速筛查，发现高风险信号或明确要求时再完整审计。 | 安装前风险评估或本地资源审核时按需加载，也可显式调用 `/skill:pi-resource-audit`；默认不执行受审代码。 |
| [`dayone-new`](skills/dayone-new/SKILL.md) | 通过 Day One 官方 `dayone` CLI 新建本地日记，支持日记本、标签、日期、时区、全天、星标、坐标和附件。正文只通过标准输入传递，并将创建操作视为不可幂等。 | 仅显式调用 `/skill:dayone-new`；需要 macOS、Day One 及官方 CLI。 |
| [`dayone-reader`](skills/dayone-reader/SKILL.md) | 通过独立的 [`v2naix/dayone-reader`](https://github.com/v2naix/dayone-reader) CLI 检索和读取本地 Day One 数据，支持日记本、标签、最近条目、关键词搜索、历年今日和单篇读取；不会修改或删除日记。 | 仅显式调用 `/skill:dayone-reader`；需要 macOS、Day One、Python 3.11+ 及 reader CLI。 |

### Day One 配置

`dayone-new` 默认调用 `/usr/local/bin/dayone`，也可以通过 `DAYONE_CLI` 指向其他绝对路径。它不会读取、修改或删除已有条目，也不会在测试时创建日记。

`dayone-reader` 默认调用 `~/.local/bin/dayone-reader`，也可以通过 `DAYONE_READER_CLI` 指向其他绝对路径。CLI 可按以下方式安装：

```bash
uv tool install git+https://github.com/v2naix/dayone-reader
```

Reader 直接读取本机 Day One 数据库，不联网、不创建全文索引，也不读取附件内容。

## Extensions

| Extension | 接口 | 功能描述 | 主要要求 |
| --- | --- | --- | --- |
| [`compact-footer.ts`](extensions/compact-footer.ts) | TUI footer | 用紧凑的一行显示目录、Git 分支、会话名、扩展状态、上下文占用、模型和 thinking level。 | 仅 TUI；建议使用 Nerd Font。 |
| [`copy-all.ts`](extensions/copy-all.ts) | `/copy-all` | 将当前会话分支中的全部用户与 Assistant 消息复制到系统剪贴板。 | macOS `pbcopy`。 |
| [`copy-code.ts`](extensions/copy-code.ts) | `/copy-code [edit]`、`Ctrl+Alt+C` | 从最近 10 条含 fenced code block 的 Assistant 回复中选择并复制代码；`edit` 在 Pi 内置编辑器中编辑后复制。 | 优先使用系统剪贴板工具，缺失时使用有长度上限的 OSC 52。 |
| [`dashed-editor-border.ts`](extensions/dashed-editor-border.ts) | TUI editor | 将输入框上下边框从实线改为虚线，同时保留原有颜色、输入和快捷键行为。 | 仅 TUI；不要与其他替换 editor component 的扩展同时启用。 |
| [`diff.ts`](extensions/diff.ts) | `/diff`、`/diff list`、`/diff clear` | 跟踪上一次 Agent 运行触及的文件，可列出文件或选择后在 Zed 中打开。 | Git；打开文件需要 `zed` CLI。 |
| [`herdr-answer-studio`](extensions/herdr-answer-studio/index.ts) | `/answer`、自动触发、`herdr:blocked` bridge | 内置本地维护的 Answer Studio fork：多个问题时打开回答界面；只有一个问题时保留普通输入框，同时继续同步 Herdr 侧边栏的等待状态。 | Herdr 及其 Pi integration；不要再单独加载其他 Answer Studio 扩展。 |
| [`set-pane-title.ts`](extensions/set-pane-title.ts) | `/set-pane-title [文字]`、自动命名 | 完成首轮对话后调用当前模型生成一次不超过 20 个字符的默认标题，并将 Herdr pane 左上角的 agent label 设为“当前 agent - 标题”；之后可用命令手动覆盖，切换 session 或退出时清除。 | Herdr 及其 Pi integration；自动命名会额外调用一次当前模型，不带命令参数时需要交互式 UI。 |
| [`mac-guardrail.ts`](extensions/mac-guardrail.ts) | `tool_call` guard | 为 Agent 的 `bash`、`write` 和 `edit` 调用提供轻量 macOS 防护：硬拦截明显的系统破坏操作，对高风险命令和工作目录外写入请求确认。 | macOS；非交互模式对需确认操作默认拒绝。 |
| [`package-catalog.ts`](extensions/package-catalog.ts) | `pi_package_catalog` tool | 让 Agent 查看、添加、移除、应用或捕获共享 Pi package catalog 配置，并串行化写操作。 | 独立的 `pi-package-catalog` 仓库。 |
| [`retro.ts`](extensions/retro.ts) | `/retro` | 分析最近会话中的绕路与改进点，并在会话文件旁生成 HTML retrospective。 | 生成报告会调用模型；HTML 从 CDN 加载 Tailwind CSS。 |
| [`session-digest.ts`](extensions/session-digest.ts) | `/digest [all\|ai\|tool\|user\|context]` | 在分页 overlay 中筛选浏览当前 session branch 的消息；通过 `context` 参数显示上下文占用和 token 分布。 | 仅 TUI；每种消息筛选最多展示最近 500 条，并限制单条展示长度。 |
| [`skill-visibility.ts`](extensions/skill-visibility.ts) | `/skill-visibility` | 读取当前环境的全部 Skill，通过可搜索的二级配置界面选择哪些 Skill 不进入系统提示词，同时保留 `/skill:name` 手动调用。 | 配置界面仅支持 TUI；选择全局保存在 Pi agent 目录中。 |
| [`todo.ts`](extensions/todo.ts) | `todo` tool、`/todos` | Pi 官方精简 Todo 示例：用 `add`、`toggle`、`list` 和 `clear` 管理当前会话分支的任务，并提供交互式列表。 | 不注入额外工作流提示；不要与其他注册 `todo` 或 `/todos` 的扩展同时启用。 |
| [`youtube-transcript.ts`](extensions/youtube-transcript.ts) | `youtube_transcript` tool | 下载并清理 YouTube 已有字幕，优先选择人工字幕，并为长文本保存本地缓存。 | `yt-dlp` 和网络连接；只分析字幕，不分析画面或转录音频。 |

### Skill 系统提示词可见性

Pi 当前的 extension API 不能向内置 `pi config` 注册嵌套菜单，因此先在 `pi config` 中启用 `skill-visibility.ts`，再通过 `/skill-visibility` 打开该扩展自己的二级配置界面。界面实时读取当前 session 已加载的所有用户级、项目级和 package Skill，支持搜索，并以 Skill 文件路径作为稳定标识保存选择。

被设为“仅手动调用”的 Skill 不再出现在模型收到的 `<available_skills>` 列表中，但 `/skill:name` 仍然可用。配置写入 `~/.pi/agent/skill-visibility.json`（实际位置跟随 Pi agent 目录），不会修改第三方 Skill 文件，因此 package 更新后仍然生效。Skill 自身已经声明 `disable-model-invocation: true` 时，界面只显示其固有状态，不会反向覆盖。

### Session Digest

`session-digest.ts` 的消息浏览功能改编自 `disler/pi-vs-claude-code` 在 commit `32dfe122cb6d444e91c68b32597274a725d81fa3` 中的实现；上下文用量视图改编自 `ttttmr/pi-context` v2.1.0。相关 MIT 许可证与 attribution 保留于 [`extensions/session-digest.LICENSE`](extensions/session-digest.LICENSE)。收录版本使用当前 Pi package imports，移除了原项目的主题映射依赖，并补充内容上限、终端控制字符清理、敏感工具参数脱敏、可配置按键支持和有界分页显示。`/digest` 默认进入 User 视图，也可通过 `all`、`ai`、`tool`、`user` 或 `context` 参数直接进入对应视图。消息视图和上下文视图底部提供 `A`、`U`、`T`、`C`、`D` 快捷键，可直接切换到 AI、User、Tool、Context 或 All 视图；不再显示工具调用数和用户轮次统计。通过 `/digest context` 可显示与 `pi-context` 的 `/context` 相同风格的上下文用量网格，按 System Prompt、System Tools、Tool Call、Messages、Other 和 Available 估算 token 分布。消息列表采用与上下文视图一致的克制配色：AI 使用强调色、Tool 使用成功色、User 使用正文色，同时提高正文预览的对比度。All 视图中的 User 和 AI 条目分别用 `[user]` 与 `[ai]` 区分，只在标签后显示完整时间和相邻消息间隔，不显示 `User Prompt` 或 `Assistant`；Tool 条目仍保留工具名称以便识别。单独的 User 和 AI 视图不显示标签和完整时间，只显示不带加号与括号的相邻消息间隔；首条没有前序条目时显示 `0s`。每个间隔前使用虚线横线填充到行首，将秒数对齐到行尾，形成更清晰的消息分隔。所有时间均按本机时区以 `00:00:00`–`23:59:59` 显示。

扩展只读取当前 session branch，不写入 session 或联网。工具结果本身可能包含敏感内容；展开详情前仍应留意屏幕共享或旁观者。

### 精简 Todo

`todo.ts` 原样收录自 `@earendil-works/pi-coding-agent` v0.80.6 的[官方 Todo 示例](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/examples/extensions/todo.ts)，原始文件 SHA-256 为 `e46824d00217e25242c186d41837cc84ca81b23f978500323448502a9a424ee2`，并保留上游 MIT 许可证于 [`extensions/todo.LICENSE`](extensions/todo.LICENSE)。它只注册简短的工具定义，不添加 `promptSnippet` 或 `promptGuidelines`；任务状态保存在 tool result details 中，因此能随 session branch 恢复。

该扩展与其他使用 `todo` 工具名或 `/todos` 命令名的扩展冲突。临时试用时请隔离加载；正式启用前先禁用 `@juicesharp/rpiv-todo` 等同名扩展。

### Package Catalog 配置

`package-catalog.ts` 默认调用：

```text
~/.pi/pi-package-catalog/scripts/catalog.ts
```

如安装在其他位置，可设置 `PI_PACKAGE_CATALOG_DIR`。工具支持：

- `status`：查看当前机器的启用状态；
- `add` / `remove`：增删共享 package 来源；
- `apply`：将共享清单和本机选择合并到 Pi settings；
- `capture`：在用户直接运行 `pi config` 并调整资源选择后，保存本机选择。

交互式 `pi config` 应由用户直接在终端运行，不会通过该工具嵌套启动。

### Herdr 问答状态桥

`herdr-answer-studio` 是一个集成入口：它内置一份基于 `@petechu/pi-answer-studio` 0.1.2 的本地 fork，不再依赖该 npm 包，并把手工 `/answer` 与自动触发统一到同一个受控 handler。文本编辑器激活时，左右箭头用于移动文本光标；选择题的选项界面激活时，左右箭头仍切换问题，`Tab` / `Shift+Tab` 也始终可切换前后问题。Agent 完全结束后，问号或常见中英文询问句式会直接打开 Answer Studio，不会再把字面量 `/answer` 作为用户消息发送给模型。无论自动还是手工进入，回答界面存续期间 Herdr 都显示 `blocked`；提交并启动后续 Agent 时恢复为 `working`，取消、空提取或异常时解除阻塞，随后由 Herdr 恢复为 `done` 或 `idle`。同一 Assistant 消息每个 runtime 只触发一次。使用该入口时不要再把其他 Answer Studio 作为另一个 extension 单独加载，否则会产生重复命令。它不修改 Herdr 管理的 integration 文件；缺少 Herdr integration 时不会产生侧边栏状态效果。安装或更新 Herdr integration 后无需重新应用此扩展。fork 的来源与 MIT 许可证见 [`extensions/herdr-answer-studio/answer-studio.LICENSE`](extensions/herdr-answer-studio/answer-studio.LICENSE)。

### macOS Guardrail

`mac-guardrail.ts` 采用低干扰策略：正常的项目内开发操作直接放行；递归删除、`sudo`、服务停用、磁盘工具等高风险命令需要逐次确认；磁盘擦除、向原始磁盘写入、递归删除系统关键目录、禁用 SIP/Gatekeeper，以及对系统目录、SSH/GPG 凭据、钥匙串等路径的直接写入会被硬拦截。通过常规 Shell 引号直接传给 `sh -c`、`bash -c` 或 `zsh -c` 的命令会按相同规则继续检查；嵌套过深时转为请求确认。状态栏右侧随当前主题显示的 `mac-guard` 表示扩展已加载。

这是一层纵深防御，不是 macOS 沙箱：它仍无法可靠理解 `eval`、`source`、命令替换、动态生成或编码混淆的命令，也无法预知未知第三方工具的副作用，因此不能提供“绝对不会损坏系统”的数学保证。重要数据仍应使用 Time Machine 或其他独立备份；需要更强隔离时，应在容器、虚拟机或 OS 级沙箱中运行 Agent。

## 仓库结构

```text
extensions/   Pi extensions
skills/       Pi skills 及其脚本、references 和 assets
```

未来可按需增加 `prompts/` 和 `themes/`。Pi 通过 [`package.json`](package.json) 中的 `pi` manifest 加载资源。

## 安全与维护

- Extensions 以当前用户权限执行代码；skills 可以指示 Agent 执行命令。使用前应审查来源与实现。
- 引入第三方资源时，应确认许可证、保留 attribution，并检查依赖、子进程、网络、凭据和文件写入行为。
- 本仓库的开发源是可写的 `v2naix/pi-extras` 检出；不要直接修改 Pi 位于 `~/.pi/agent/git/` 或 `~/.pi/agent/npm/` 下的 managed clone。
- 不要为了测试而触发联网、破坏性或不可幂等行为。

本仓库采用 [MIT License](LICENSE)。第三方改编文件可能包含各自保留的版权与许可声明。
