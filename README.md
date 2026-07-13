# pi-extras

个人维护的 [Pi](https://pi.dev) Package，用于集中存放自己编写或从其他来源整理的零散资源。

## 目录

```text
extensions/   Pi extensions
skills/       Pi 按需加载的技能与配套脚本
```

后续也可以按需增加：

```text
prompts/
themes/
```

## 本地使用

```bash
pi install ~/.pi/pi-extras
```

也可以将仓库发布到 Git 后，把 Git 来源加入 `pi-package-catalog` 统一管理。

安装后，这些 skills 不会暴露给模型自动调用。启用 skill commands 后可显式调用 `pi-extras`：

```text
/skill:pi-extras
```

仓库当前提供以下 skills：

- `pi-extras`：选择、使用和维护本仓库资源的指南；
- `dayone-new`：通过 Day One 官方 `dayone` CLI 新建条目，支持日记本、标签、日期、时区、全天、星标、坐标和附件；
- `dayone-reader`：通过独立安装的 [`v2naix/dayone-reader`](https://github.com/v2naix/dayone-reader) CLI，在本机检索 Day One 日记。支持日记本、标签、最近条目、搜索、历年今日和单篇读取。

两个 Day One skills 都仅支持 macOS，并且只支持通过 skill command 显式调用。`dayone-new` 要求已安装 Day One，并默认从 `/usr/local/bin/dayone` 调用官方 CLI；也可以用 `DAYONE_CLI` 配置其他绝对路径。Skill 强制通过标准输入传递正文，并将新建操作视为不可幂等操作，以避免不确定失败后的重复写入。

`dayone-reader` 还需要 Python 3.11+ 和位于 `~/.local/bin/dayone-reader` 的独立 CLI，也可以用 `DAYONE_READER_CLI` 配置绝对路径：

```bash
uv tool install git+https://github.com/v2naix/dayone-reader
```

Reader skill 中只保留固定路径启动包装器，CLI 实现、测试和发布由独立仓库维护。读取直接访问本机数据库，不联网、不创建全文索引。

```text
/skill:dayone-new
/skill:dayone-reader
```

## Usage 报告

`extensions/usage.ts` 注册 `/usage` 命令。执行后，Agent 会读取本机 Pi 与 Codex CLI 的 JSONL 会话，按模型汇总最近 1、7、30、90 天的消息/轮次、输入/输出/缓存 Token 和总 Token，并查询 [models.dev](https://models.dev) 的当前价格估算费用。

该命令会读取 `~/.pi/agent/sessions`、`~/.codex/sessions` 和可选的 `~/.codex/archived_sessions`；价格查询需要联网。扩展本身只向 Agent 发送报告提示词，不直接修改会话文件。

此扩展改编自 [`davis7dotsh/my-pi-setup`](https://github.com/davis7dotsh/my-pi-setup/blob/322d60288226d7edbefff03662f879f02147227d/extensions/usage.ts)，原始文件采用 MIT License；版权与许可声明保留在文件头中。

```text
/usage
```

## Package Catalog 集成

`extensions/package-catalog.ts` 注册 `pi_package_catalog` 工具，让 Pi 可以直接执行：

- `status`：查看当前机器的启用状态；
- `add` / `remove`：增删共享 Package 来源；
- `apply`：把共享清单和本机选择合并到 Pi settings；
- `capture`：在用户直接运行 `pi config` 后保存本机选择。

工具默认调用 `~/.pi/pi-package-catalog/scripts/catalog.ts`；如安装在其他目录，可设置 `PI_PACKAGE_CATALOG_DIR`。交互式 `config` 流程仍应由用户在终端运行，避免在 Pi TUI 内嵌套启动另一个 Pi TUI。

## 安全

Extensions 会以当前用户权限执行代码。引入第三方文件前应审查源码、确认许可证，并记录原始来源和版本。
