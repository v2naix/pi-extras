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

## 安全

Extensions 会以当前用户权限执行代码。引入第三方文件前应审查源码、确认许可证，并记录原始来源和版本。
