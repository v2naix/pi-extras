# GitHub Issue 实现调度

用户通过 `/implement` 明确要求实现 GitHub Issue 时，按范围选择执行方式；仅查看、分析或制定计划不构成执行授权。

## 单个 Issue

在当前会话直接实现，不启动 Subagent，不开 worktree。遵循 `/implement` 的 TDD、验证、`/code-review` 和提交要求。

## 多个 Issue（父 Issue 带子 Issue，或若干相关 Issue）

不要自行设计编排：不写 workflowScript，不逐 Issue 安排审阅，不由父 Agent 复核子任务的 diff。改为调用 `/skill:implement-issues`，它提供固定的工作流：按依赖分波、每波在独立 worktree 中并行实现、宿主执行测试门槛、波间脚本合并到集成分支，结束后只做一次 `/code-review`。用户的工作区不受影响。

该 skill 要求目标仓库的 AGENTS.md 写明测试与类型检查命令；缺失时先补 AGENTS.md，不要猜测或安装工具。

## 基础设施失败

调度、启动或子任务工具失败时，停止受影响执行，报告确切错误、运行状态、仓库与 worktree/分支/基线；未经用户批准不切换执行协议或工具绕过。默认不 push、不创建 PR。
