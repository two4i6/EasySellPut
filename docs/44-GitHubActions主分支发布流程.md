# GitHub Actions：仅 main 发布

## 流程

| 阶段 | 触发 | 内容 | 能否公开发布 |
| --- | --- | --- | --- |
| CI · Test & Package | 所有 push / PR，也可手动运行 | 共享测试、全目录 CLI/MCP、组件与浏览器测试、原生安装包及升级事务验收 | 否，仅保留 artifacts |
| Release · Auto publish | `HOST_AUTO_RELEASE=true` 时 main 的成功 CI 自动触发；也可在 main 手动指定 run ID | 校验来源，下载七份既有包，保留 CI 包原字节，再在原生平台运行最终包，签署发行索引和更新索引，创建草稿、复验并正式发布 | 是，仅新版本 |
| Release · Publish | 在 main 手动输入稳定版本号 | 复验 tag、当前 main、成功 CI、两个签名索引和全部附件，再把草稿转正式发布 | 是 |

`work`、PR、其他分支和标签上的 CI 产物均不能进入发布流程。工作流 job 条件和 Python 策略同时验证 main；成功的 aggregate 不能代替缺失的平台作业。来源必须是本仓库 `.github/workflows/ci.yml` 的成功 **push**，SHA 必须等于当前 main。拒绝 fork、PR、过期/缺失/重复产物和截断的 API 列表。

main 若在准备或发布验证期间前进，流程停止，等待新 main 完整通过 CI。版本已存在时不覆盖或替换附件；正式发布后的新版本需要提升 `Directory.Build.props` 版本。main CI 的自动草稿流程需要版本号已经更新；文档等不需要发行的提交仍可正常通过 CI，已发布版本正常跳过，不进入签名阶段；已有草稿停止并要求人工恢复，不自动覆盖。

## 产物与代码一致性

- Desktop：Windows x64、macOS Intel/Apple Silicon，共三份 zip，含 GUI、CLI/MCP 和配套 skill。
- 独立 CLI/MCP：Linux x64、Windows x64、macOS x64/ARM64，共四份 zip/tar.gz。
- Release 直接使用成功 CI 的原始包和校验文件，并在原生平台再次验证最终包。Windows 包无 Authenticode 发布者签名。macOS 包保留本地 ad-hoc 完整性签名，无 Developer ID 签名和 Apple 公证。
- 最终验证包括含空格路径解压、CLI/MCP 真实进程、GUI、内置图表、更新替换/重启及数据保留。系统可能显示发布者警告或阻止打开。三种平台的包均由签名发行索引验证来源。
- `EasySellPut-update.json` 包含构建仓库 `repository` 和三份桌面包，保持客户端协议；`EasySellPut-release.json` 包含七份包的大小/哈希、源码提交、CI run 和原始 artifact 身份。两个索引均使用内置公钥对应的 ECDSA P-256 私钥签名。
- 正式发布前下载全部草稿附件，复验两个签名、七个产物目标、哈希、校验文件和附件集合。没有 `--publish` 的验证不会发布；自动发布和手动恢复入口均调用同一验证器传入它。

## 首次启用配置

仓库的 `release` Environment 必须只允许 `main`。发布渠道唯一需要的 Secret 是 `UPDATE_SIGNING_KEY`，即与源码 `update-public-key.pem` 匹配的项目密钥。主程序用它验证更新清单，独立应用用它验证签名包和目录。项目密钥由 OpenSSL 生成，无需 Apple 或 Windows 开发者账号。

第一次配置时，按 [更新配置说明](29-检查更新与安装.md) 从维护者电脑保存私钥备份并配置 Secret。已有固定公钥和对应私钥时，继续使用原密钥。只把公钥提交到仓库。

GitHub 分支规则要求通过 `CI · Required checks`。原生验证、哈希校验和更新签名仍是公开发布的必要条件。

## 操作

1. 将改动合入 main，并设置新的三段稳定版本号。
2. 等 main 的完整 CI 成功。如果已启用 `HOST_AUTO_RELEASE`，成功的 main CI 会启动自动发布。也可在 main 手动选择 `Release · Auto publish`，输入该 CI run ID 和可选说明。
3. 检查草稿、发行说明、签名及所有平台的最终包验证结果。tag 在草稿准备阶段创建并指向该 main SHA；不重新指向已有版本。
4. 如果使用手动入口创建草稿，在 main 运行 `Release · Publish`，输入如 `0.6.0`。它会再次验证当前 main、tag、来源和附件后公开发布。

所有正式发布通过 Actions 完成，不在本地执行 `gh release create/edit`，也不通过网页手工替换附件。GitHub 管理员始终具有手动修改仓库的权限；工作流约束不能替代仓库权限与 Environment 配置。

## 验证范围

CI 增加 `Release · main guard` 并接入 required 聚合：检查工作流边界，测试 main/work、错误来源、缺失平台、过期产物、篡改哈希、错误附件、凭据缺失和实际 OpenSSL 签名验证。发布编排测试使用临时 fixture 和模拟 GitHub API，不创建真实发行。

正式发布以 main 工作流成功、公开附件可下载及真机从该版本更新的记录为准。开发签名的测试产物使用临时密钥。

这是工程交付变更，不新增桌面业务、CLI 命令或 MCP 工具，原有业务目录/权限和覆盖场景保持不变。

## 构建与发布仓库绑定

CI 通过 GitHub Actions 环境将当前 `github.repository` 编译进每个 GUI/CLI；不需要上游手改 URL。编译检查拒绝与 `GITHUB_REPOSITORY` 冲突的覆盖。Linux CI 额外构建上游、fork、本地三个真实 CLI，验证仓库绑定、开发禁用和运行时环境无法改源。

每个平台对解压后的 CLI 执行离线 `update source --json`，GUI 自检报告同时输出自身内置源；两者的仓库和公钥指纹必须匹配当前发行仓库和源码。签名后的包也复用同样检查，仍不重新编译。签名更新索引必须包含当前仓库，Publish 再次核对；错误绑定会阻止草稿/发布。

这些检查不替代首次签名密钥配置，也不允许 `work`/PR 发布。首次初始化应先提交仓库自己的公钥，再运行 main CI 并配置对应私钥；已有客户端的密钥不得自动轮换。

## 自动发布开关

`HOST_AUTO_RELEASE=true` 启用主程序自动发布。`APPS_AUTO_RELEASE=true` 启用独立应用的自动发布。两个渠道都要求成功的 main CI 和与源码公钥匹配的项目密钥。独立应用目录使用独立的预发布标签，主程序继续读取稳定版 Latest。
