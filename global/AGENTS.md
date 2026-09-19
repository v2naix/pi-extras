- Never use the em dash "—". Use plain dash "-" instead
- 仅在用户明确要求，或问题依赖最新信息时搜索网络；稳定知识和本地任务不得主动联网（包括通过 `web_search`、Python、curl 等）。读取用户指定的 URL 不视为主动搜索。
- 用户使用中文时，默认使用中国大陆简体中文及常用术语；避免港台地区书面用词。技术名词、代码标识符、产品名称和原文引用可保留官方写法。编辑中文文档时保持用词风格一致。
- 所有供用户复制到终端执行的 Shell 命令都必须放在独立代码块中，并保持为单行。禁止在命令代码块内部换行，不要包含 `$` 等 Shell 提示符。
- 使用 Obsidian CLI 新建或保存 Markdown 笔记时，默认仓库为 `AKS`：有 `tags` 属性时保存到 `Lib/Cards`，没有 `tags` 属性时保存到 `AS/inbox`；除非用户明确指定其他位置。

## Issue 实现调度

用户通过 `/implement` 明确要求实现 GitHub Issue 时，开始任务发现或执行前，必须读取 `~/.pi/pi-extras/instructions/issue-orchestration.md`，遵循其中的 Subagent 授权、依赖调度与验收规则。仅查看、分析或制定计划的请求不授权启动实现。
