# 全局 Agent 指导

`AGENTS.md` 是个人全局指导的唯一维护源；仓库根目录的 `AGENTS.md` 只约束本仓库开发。完整 Issue 调度规则位于 `../instructions/issue-orchestration.md`，由全局指导中的条件 pointer 按需加载。

## 新机器接入

将仓库放在 `~/.pi/pi-extras`。检查 `~/.pi/agent/AGENTS.md`：已有普通文件时先将机器特有规则合并到本目录的 `AGENTS.md`，再备份原文件；已有软链接时先核对目标。目标路径空闲后执行：

```bash
mkdir -p ~/.pi/agent && ln -s ../pi-extras/global/AGENTS.md ~/.pi/agent/AGENTS.md
```

启动新 Pi 会话以加载全局指导。安装 Pi package 本身不会建立此链接。

## 同步

提交并同步 `global/AGENTS.md` 和 `instructions/issue-orchestration.md`；各机器一次性建立链接后，更新仓库即可更新正文和入口，无需修改第三方 `/implement` 技能。全局指导中的规则路径依赖上述固定仓库位置。

首次迁移的原文件保存在 `~/.pi/agent/AGENTS.md.before-pi-extras`，不纳入版本控制。
