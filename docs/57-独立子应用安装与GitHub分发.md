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
| Apps · Release | 启用后，main CI 成功自动签名、复验并发布新版本；保留手动恢复入口 | 是，须通过全部来源和签名验证 |
| Apps · Renew catalog | 每周为已有目录续签 30 天有效期，或手动运行 | 不发布新应用版本，不更换安装包 |

正式支持 Windows x64、macOS Intel/Apple Silicon，以及 Linux x64 CLI/MCP。共三个桌面、四个 CLI/子应用 CI 目标；不再构建或提供其他 Windows CPU 架构包。

主程序继续读取 Latest；子应用读取独立 `apps` Release 中的 `EasySellPut-apps.json` 和签名。子应用 Release 永远不是 Latest，不会触发主程序升级。地址由 CI 的发布仓库编译进主程序；运行时不能通过任意 URL 更换信任源。

## 首次配置

管理员需要设置：

1. `release` Environment 仅允许 main 分支，保留已有审核人/等待时间。
2. `UPDATE_SIGNING_KEY` 为 ECDSA P-256 私钥，必须匹配源码公钥；私钥备份必须在 Git 仓库之外保管。
3. 仓库变量 `APPS_AUTO_RELEASE=true`，启用子应用自动发布和目录续签；主程序使用 `HOST_AUTO_RELEASE=true`，首次配置均默认 false。
4. 将审查并测试后的工作流、公钥及运行时代码合入 main。仅修改 work 不会启用 main 的自动发布配置。

已提供一条管理员初始化命令，见 [英文操作指南](app-runtime-research/app-distribution.md#one-time-github-setup)。工具不会合并 main 或发布版本；已有签名 secret 或已发布客户端时会拒绝静默换钥。

当前连接的 GitHub App 可以推送，但管理 Environment secrets/variables 返回 HTTP 403。源码仍是初始开发公钥；在取得管理员授权并确认已有 secret 状态前，不生成或替换生产密钥，不宣称生产分发已经启用。

之后每次更新只需提高 `web/qqq-gex/app.json` 的子应用版本、完成测试并合入 main，自动复验草稿并发布。空版本/CI 输入会自动选择当前版本和精确匹配当前 main 的成功 CI。旧版本不可覆盖；旧提交草稿不自动覆盖，需要人工恢复或提升版本。

## 服务端配置状态（2026-11-18）

管理员已确认 release Environment 仅允许 main，main Ruleset 要求 `CI · Required checks`，两个自动发布开关均为 false。九项正式签名凭据全部缺失，尚不能验收真实发布。补齐凭据及匹配公钥、完成原生验证后再启用；不要使用临时密钥或绕过系统签名。

## Publisher signing deferred — 2026-11-18

The user explicitly authorized automatic host/app distribution before Windows Authenticode and Apple Developer ID/notarization are available. Host preparation now selects `--platform-signing none` explicitly, preserves exact tested archive/checksum bytes and still runs native GUI/CLI/MCP and updater transaction checks. macOS retains its existing ad-hoc integrity signature; no quarantine removal, Gatekeeper bypass or system policy changes are performed. Release notes disclose missing publisher signatures and possible OS warnings/blocks. This does not guarantee a frictionless first installation.

`UPDATE_SIGNING_KEY` remains required for both host indexes and independently installed app packages/catalogs. Its matching public key must be committed before CI builds the first trusted host. The eight Apple/Windows secrets are deferred, not required by the current path. Both auto-release switches remain false until this one-time trust setup and native CI succeed. Future OS signing must switch preparation and assembly together to `required` and re-enable notarization/Gatekeeper validation; missing credentials must never silently trigger an unsigned fallback. Browser installation may require platform-supported user approval; never automate bypasses.

## 第二个子应用：市场流动性

流动性核心 ID 为 `easysellput.market-liquidity`，版本位于 `web/market-liquidity/app.json`。安装/更新/卸载沿用同一管理器，原生页面复用现有组件并调用已验证的报告接口；CLI/MCP 保留 `get_market_liquidity` 名称和权限。主程序未安装该包时保留兼容实现，明确禁用/卸载后不再自动回退。

启用自动发布后，同一 main 成功 CI 会分别检查两个子应用版本并串行发布；仅更新有新版本的应用，保留另一个应用的目录记录。手动恢复时需选择 app。两种包均执行真实签名与发布验证的离线测试，GitHub 写入全部拦截；固定主程序下的实际 CLI/持久 MCP A/B 更新与卸载/重装已验证。生产信任配置及最终原生 CI 状态另见迁移报告，不代表当前已经公开发布。
