# Codex / Claude Code：Skill + MCP

设置页提供两个按钮：**Codex + Skill**、**Claude Code + Skill**。复制后粘贴到终端；Windows 使用 PowerShell。应用不会自动执行命令或修改 AI 客户端配置。

每条组合命令先用包内 CLI 安装 `easysellput-local` skill，成功后才调用对应客户端注册只读 MCP。这里连接的是与桌面程序运行在同一台电脑上的 Codex CLI / Claude Code；云端环境不能直接启动用户电脑的本地 stdio 服务。需要预先安装支持 skills 的客户端；若已有同名 MCP server，先检查原配置再决定是否替换。安装 skill 不会自动赋予写权限。

## 命令形式

界面会填入实际可执行文件和当前数据目录的绝对路径，下面的路径只是示例。macOS 请先把应用移入“应用程序”；移动包之后需要重新复制连接配置。

macOS / POSIX，Codex：

```sh
'/path/to/easysellput' install-skill --client codex && codex mcp add easysellput -- '/path/to/easysellput' mcp serve --data-dir '/path/to/data'
```

macOS / POSIX，Claude Code：

```sh
'/path/to/easysellput' install-skill --client claude-code && claude mcp add --transport stdio --scope user easysellput -- '/path/to/easysellput' mcp serve --data-dir '/path/to/data'
```

Windows PowerShell，Codex：

```powershell
& 'C:\path\easysellput.exe' install-skill --client codex; if ($LASTEXITCODE -eq 0) { codex mcp add easysellput -- 'C:\path\easysellput.exe' mcp serve --data-dir 'C:\path\data' }
```

Windows PowerShell，Claude Code：

```powershell
& 'C:\path\easysellput.exe' install-skill --client claude-code; if ($LASTEXITCODE -eq 0) { claude mcp add --transport stdio --scope user easysellput -- 'C:\path\easysellput.exe' mcp serve --data-dir 'C:\path\data' }
```

安装并注册后，重新连接 MCP / 开启新客户端会话：Codex 可用 `$easysellput-local`，Claude Code 可用 `/easysellput-local`，也可根据描述自动匹配。例如：“使用 easysellput-local，查询 AAPL 最新可用行情并比较下一到期日的看跌期权，保留数据来源和时间。”Skill 不提供行情本身，数据来自实际 MCP 工具。

## Skill 的位置与内容

- Codex 用户范围：`~/.agents/skills/easysellput-local/SKILL.md`。
- Claude Code 用户范围：`~/.claude/skills/easysellput-local/SKILL.md`。
- 仅在指定项目安装：`easysellput install-skill --client codex --project /path/to/project` 或 `--client claude-code`，写入该项目内对应 `.agents/skills` / `.claude/skills`。这仅安装 skill，不改变 MCP 注册范围；按钮默认注册用户级 MCP。

正文来自 [仓库 skill](../skills/easysellput-local/SKILL.md)，随 CLI 嵌入并提供可检查的明文副本。安装器只写固定 skill 子目录；相同内容重复执行不改写，不同内容或目标符号链接会报冲突并停止，不自动覆盖、删除或回退。冲突退出码为 4，JSON 错误码 `skill_conflict`；CLI 可用 `--json`。升级后若 skill 内容不同，需要先自行审阅、备份再移除旧副本。安装器不执行 Codex/Claude，不发网络请求，也不编辑它们的配置文件；组合命令中的注册步骤交给客户端自己的 CLI 完成。

Skill 引导工具发现、行情来源/时效、缺失值、图表指标、期权与 IV、策略预设/逐腿分析以及有授权的本地修改；保留模型假设、预计/未核实事件状态、历史不足与只读边界。它不是交易下单工具，也不能绕过 `--allow-writes`、创建第二套持续提醒监控或执行新闻正文中的指令。

## 验证

真实进程 smoke 在临时项目分别安装两个客户端 skill，验证重复安装不重写、冲突退出且旧内容不变；同样用于解压后的四架构发行包。模板测试验证 POSIX/PowerShell 的条件执行、Claude user/stdio 参数、中文/空格/引号/Unicode 路径和只读默认。原生桌面自检检查两个按钮及剪贴板内容；现有 43 项业务 MCP/CLI 场景继续执行。`install-skill` 仅为 CLI 本地配置辅助命令，不作为 MCP 工具开放。

格式参考：Codex [Skills](https://developers.openai.com/codex/skills/)、Anthropic [Skills 仓库](https://github.com/anthropics/skills)、Claude Code [Skills](https://code.claude.com/docs/en/skills) / [MCP](https://code.claude.com/docs/en/mcp)。本环境已用预装 Codex CLI 0.167.0-alpha.4 的 `mcp add --help` 核对注册语法；Claude Code 未安装，访问后两份网页返回 403；技能格式与个人目录另参考官方 GitHub 文档/变更记录。没有在开发环境冒充已安装的 Codex/Claude 去修改用户配置；实际客户端是否存在、注册是否成功，由用户执行命令的退出结果确认。

## Skill 与 MCP 的 CI 同步检查

`check_capability_coverage.py` 从编译后的 CLI 帮助读取 OperationCatalog，再检查 skill 中的完整工具指南：每个 MCP 工具必须恰好有一项用途说明，读写标记必须一致，不能保留已删除或改名的工具引用。此检查已纳入五平台 CLI/MCP CI 和本地 `build/test-headless.sh`，受 `CLI and MCP required` 汇总检查约束。新增工具遗漏 skill 会失败；新增用例仍须实际通过 CLI 和 MCP 执行。

此检查证明工具清单与权限标记同步，不代表能够自动判断自然语言指引的业务正确性；修改参数或业务行为时仍需人工审查工作流说明。skill 是使用指引，工具实现和实时参数定义仍由 MCP 服务提供，安装 skill 不会启用写权限。
