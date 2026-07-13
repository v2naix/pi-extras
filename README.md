# pi-extras

[English](README.en.md)

个人维护的 [Pi](https://pi.dev) Package，用于集中保存、维护和分发可复用的 Pi skills 与 extensions。资源既包括自行编写的功能，也包括经过审查并保留来源与许可证信息的第三方实现。

## 安装

从本地开发检出安装：

```bash
pi install ~/.pi/pi-extras
```

也可以直接安装 Git 仓库，或将该来源加入 `pi-package-catalog` 统一管理：

```bash
pi install git:github.com/v2naix/pi-extras
```

资源变更后，在 Pi 中执行 `/reload` 或重启。Git 安装可通过 `pi update --extensions` 更新。

## Skills

| Skill | 功能描述 | 调用方式与环境 |
| --- | --- | --- |
| [`pi-extras`](skills/pi-extras/SKILL.md) | 维护本仓库的 Pi 资源：将 Agent 生成或从其他来源取得的 skills 与 extensions 收录到正确的开发仓库，并负责新增、审查、修改、替换和清理移除。 | 相关维护请求可按需加载，也可显式调用 `/skill:pi-extras`；需要 Git 及 `v2naix/pi-extras` 的可写开发检出。 |
| [`pi-resource-audit`](skills/pi-resource-audit/SKILL.md) | 对 Pi extensions、skills 和 packages 进行静态、证据驱动的审核，覆盖安全、隐私、正确性、质量、供应链和 Pi API 合规性。 | 安装前风险评估或本地资源审核时按需加载，也可显式调用 `/skill:pi-resource-audit`；默认不执行受审代码。 |
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
| [`diff.ts`](extensions/diff.ts) | `/diff`、`/diff list`、`/diff clear` | 跟踪上一次 Agent 运行触及的文件，可列出文件或选择后在 Zed 中打开。 | Git；打开文件需要 `zed` CLI。 |
| [`package-catalog.ts`](extensions/package-catalog.ts) | `pi_package_catalog` tool | 让 Agent 查看、添加、移除、应用或捕获共享 Pi package catalog 配置，并串行化写操作。 | 独立的 `pi-package-catalog` 仓库。 |
| [`retro.ts`](extensions/retro.ts) | `/retro` | 分析最近会话中的绕路与改进点，并在会话文件旁生成 HTML retrospective。 | 生成报告会调用模型；HTML 从 CDN 加载 Tailwind CSS。 |
| [`usage.ts`](extensions/usage.ts) | `/usage` | 汇总 Pi 与 Codex CLI 最近 1、7、30、90 天的消息、Token 和按当前价格估算的费用。 | 读取本机会话 JSONL；查询 models.dev 当前价格时需要联网。 |
| [`youtube-transcript.ts`](extensions/youtube-transcript.ts) | `youtube_transcript` tool | 下载并清理 YouTube 已有字幕，优先选择人工字幕，并为长文本保存本地缓存。 | `yt-dlp` 和网络连接；只分析字幕，不分析画面或转录音频。 |

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

### Usage 数据与价格

`/usage` 只读取以下本地会话目录，不会修改会话文件：

```text
~/.pi/agent/sessions
~/.codex/sessions
~/.codex/archived_sessions  # 可选
```

当前模型价格来自 [models.dev](https://models.dev)，因此价格查询需要联网。该扩展改编自 [`davis7dotsh/my-pi-setup`](https://github.com/davis7dotsh/my-pi-setup/blob/322d60288226d7edbefff03662f879f02147227d/extensions/usage.ts)，原始 MIT 版权与许可声明保留在源码中。

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
