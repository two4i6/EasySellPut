# 独立子应用的安装、更新与 GitHub 配置

## 用户怎么用

先安装一次支持子应用的主程序。以后兼容的 GEX 更新只安装签名 `.espapp` 文件，无需重新安装主程序；子应用保存在用户数据目录，而不是签名的 macOS `.app` 内。

- 图形界面：从 GitHub 的子应用 Release 下载正式 `.espapp`，在“设置 → 应用”中选择该文件安装或更新。当前“刷新”只刷新已安装列表，不是在线应用商店。
- CLI：`easysellput apps check --json` 检查独立目录；`easysellput apps download easysellput.qqq-gex --json` 下载并验证，返回具体路径。首次使用 `apps install --package 路径`，之后使用 `apps update --package 路径`。
- 先关闭该子应用的页面和正在运行的任务。空闲 MCP 可以保持连接；安装/更新不是 MCP 工具。
- 默认卸载保留观察历史、设置和备份。兼容重装可以继续使用；不兼容的数据格式、契约或回滚会被拒绝。

开发密钥签名的 CI artifact 不能直接安装到正式主程序。正式主程序必须内置同一发布者的仓库地址、公钥和应用运行时。

## GitHub 如何运行

| 工作流 | 触发及作用 | 会发布正式版本吗 |
|---|---|---|
| Apps · Build & Test | 子应用/SDK 变更，独立构建并验证 core/UI，提供测试产物 | 不会 |
| CI · Test & Package | 主程序、CLI/MCP、原生视图和真实包集成验证 | 不会 |
| Apps · Release | 配置后，main CI 成功自动准备签名草稿；也可手动 prepare | 自动流程不会；只有手动 publish 才发布 |
| Apps · Renew catalog | 每周为已有目录续签 30 天有效期，或手动运行 | 不发布新应用版本，不更换安装包 |

正式支持 Windows x64、macOS Intel/Apple Silicon，以及 Linux x64 CLI/MCP。共三个桌面、四个 CLI/子应用 CI 目标；不再构建或提供其他 Windows CPU 架构包。

主程序继续读取 Latest；子应用读取独立 `apps` Release 中的 `EasySellPut-apps.json` 和签名。子应用 Release 永远不是 Latest，不会触发主程序升级。地址由 CI 的发布仓库编译进主程序；运行时不能通过任意 URL 更换信任源。

## 首次配置

管理员需要设置：

1. `release` Environment 仅允许 main 分支，保留已有审核人/等待时间。
2. `UPDATE_SIGNING_KEY` 为 ECDSA P-256 私钥，必须匹配源码公钥；私钥备份必须在 Git 仓库之外保管。
3. 仓库变量 `APPS_AUTO_PREPARE=true`，启用自动草稿和目录续签。
4. 将审查并测试后的工作流、公钥及运行时代码合入 main。仅修改 work 不会启用 main 的自动发布配置。

已提供一条管理员初始化命令，见 [英文操作指南](app-runtime-research/app-distribution.md#one-time-github-setup)。工具不会合并 main 或发布版本；已有签名 secret 或已发布客户端时会拒绝静默换钥。

当前连接的 GitHub App 可以推送，但管理 Environment secrets/variables 返回 HTTP 403。源码仍是初始开发公钥；在取得管理员授权并确认已有 secret 状态前，不生成或替换生产密钥，不宣称生产分发已经启用。

之后每次更新只需提高 `web/qqq-gex/app.json` 的子应用版本、完成测试并合入 main，审查自动草稿后点击 publish。空版本/CI 输入会自动选择当前版本和精确匹配当前 main 的成功 CI。旧版本不可覆盖；过期或旧提交草稿必须重新准备。
