# pi-extras

个人维护的 [Pi](https://pi.dev) Package，用于集中存放自己编写或从其他来源整理的零散资源。

## 目录

```text
extensions/   Pi extensions
```

后续也可以按需增加：

```text
skills/
prompts/
themes/
```

## 本地使用

```bash
pi install ~/.pi/pi-extras
```

也可以将仓库发布到 Git 后，把 Git 来源加入 `pi-package-catalog` 统一管理。

## Package Catalog 集成

`extensions/package-catalog.ts` 注册 `pi_package_catalog` 工具，让 Pi 可以直接执行：

- `status`：查看当前机器的启用状态；
- `add` / `remove`：增删共享 Package 来源；
- `apply`：把共享清单和本机选择合并到 Pi settings；
- `capture`：在用户直接运行 `pi config` 后保存本机选择。

工具默认调用 `~/.pi/pi-package-catalog/scripts/catalog.ts`；如安装在其他目录，可设置 `PI_PACKAGE_CATALOG_DIR`。交互式 `config` 流程仍应由用户在终端运行，避免在 Pi TUI 内嵌套启动另一个 Pi TUI。

## 安全

Extensions 会以当前用户权限执行代码。引入第三方文件前应审查源码、确认许可证，并记录原始来源和版本。
