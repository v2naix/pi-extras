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

安装后，Pi 会在任务匹配时按需加载 `pi-extras` skill。启用 skill commands 后也可显式调用：

```text
/skill:pi-extras
```

仓库当前提供以下 skills：

- `pi-extras`：选择、使用和维护本仓库资源的指南；
- `dayone-reader`：通过独立安装的 [`v2naix/dayone-reader`](https://github.com/v2naix/dayone-reader) CLI，在本机检索 Day One 日记。支持日记本、标签、最近条目、搜索、历年今日、单篇读取和显式新建。

Day One skill 仅支持 macOS，需要 Python 3.11+、已安装的 Day One，以及位于 `~/.local/bin/dayone-reader` 的独立 CLI。也可以用 `DAYONE_READER_CLI` 配置绝对路径：

```bash
uv tool install git+https://github.com/v2naix/dayone-reader
```

Skill 中只保留固定路径启动包装器，CLI 实现、测试和发布由独立仓库维护。读取直接访问本机数据库，不联网、不创建全文索引；新建功能仅调用官方 `dayone` CLI。

启用 skill commands 后可以显式调用：

```text
/skill:dayone-reader
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
