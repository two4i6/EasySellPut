# EasySellPut 0.6.0：本地 CLI 与 MCP

桌面、CLI 和 MCP 使用同一套行情适配与计算库，用户数据保存在本机。CLI/MCP 不需要启动 WPF 或 Avalonia，不运行 Web 服务器，不监听网络端口。行情查询仍会访问第三方数据源；MCP 工具结果会交给启动它的 AI 客户端。

Windows / macOS 用户请先看 [平台快速开始与 MCP 配置](12-Windows与macOS的CLI和MCP.md)。

## 安装与启动

使用 `build/pack-cli.sh <rid>` 生成的自包含发行包，解压整个目录后运行 `easysellput`（Windows 为 `easysellput.exe`），不需要另装 .NET。不要只复制可执行文件；同目录包含运行时和 SQLite 等依赖。支持发布 `win-x64`、`win-arm64`、`osx-x64`、`osx-arm64`、`linux-x64`、`linux-arm64`；交叉发布不等于已在目标系统运行验证。macOS 包是命令行发行包，无 Developer ID 签名/公证。

源码运行需要 global.json 指定的 .NET 10 SDK：

```bash
source tools/env.sh
dotnet build src/Meili.Cli/Meili.Cli.csproj
dotnet run --project src/Meili.Cli -- --help
```

Windows 可先 `. .\tools\env.ps1`，并用 `powershell -ExecutionPolicy Bypass -File build/pack-cli.ps1 -Runtime win-x64` 原生发布；该入口由 Windows 原生 CI 执行并检验发行包。以下命令以已解压并加入 PATH 的 `easysellput` 为例。

## CLI

```bash
easysellput --version
easysellput quote AAPL MSFT --json
easysellput search apple --limit 10 --json
easysellput bars AAPL --interval 1d --limit 100 --offset 0 --json
easysellput bars AAPL --interval 1d --from 2026-10-01T00:00:00Z --to 2026-11-01T00:00:00Z --adjust total --json
easysellput expirations AAPL --json
easysellput options AAPL --expiry 2027-06-18 --right put --min-strike 80 --max-strike 120 --limit 50 --json
easysellput fundamentals AAPL --json
easysellput financials AAPL --json
easysellput news AAPL --limit 10 --json
easysellput events AAPL --type earnings --from 2026-11-01 --to 2026-12-31 --json
easysellput sources --json

easysellput price --right call --spot 100 --strike 100 --years 1 --rate 0.05 --dividend-yield 0 --volatility 0.2 --price 10.450583572185565 --json
easysellput indicators --closes '[100,101,102,99,103]' --period 3 --json

easysellput watchlist list --json
easysellput watchlist create-group --name Research --json
easysellput watchlist add AAPL --group-id <id> --json
easysellput watchlist remove AAPL --group-id <id> --json
easysellput watchlist rename-group --group-id <id> --name Options --json
easysellput watchlist delete-group --group-id <id> --json

easysellput strategy analyze --input analysis.json --json
easysellput strategy list --json
easysellput strategy save --input saved-strategy.json --json
easysellput strategy delete --name 'AAPL short put' --json

easysellput alerts list --json
easysellput alerts history --limit 50 --json
easysellput alerts save AAPL --kind PriceAbove --threshold 200 --json
easysellput alerts enable --id <id> --enabled false --json
easysellput alerts delete --id <id> --json
easysellput settings show --json
```

完整操作名也可直接执行，例如 `easysellput get_quotes --symbols '["AAPL","MSFT"]' --json`。命令与 MCP 工具共用操作目录；`easysellput analyze_strategy --help` 会打印完整输入 Schema。日期采用 `YYYY-MM-DD`；时间戳需带时区。利率、股息率和波动率都是小数，0.2 表示 20%；价格和期权 Greeks 为每股单位，策略结果已乘数量及合约乘数。

`easysellput --help --json` 返回已编译的完整操作目录（名称、输入 Schema、读写属性和版本）；CI 以此逐项检查 CLI/MCP 覆盖，不依赖固定工具数量。

通用参数：

- `--json`：stdout 输出一个 JSON 结果；诊断写 stderr。默认输出人读格式。
- `--data-dir PATH`：明确指定本地数据目录；相对路径相对于当前工作目录。
- `--timeout SECONDS`：每次请求 1–600 秒，默认 60；Ctrl+C 取消。网络和异步等待响应取消；已开始的短暂同步文件提交不会中断一半。
- `--input FILE`：最多 2 MB 的 JSON 参数对象，用于复杂输入。不要重复指定文件内字段与命令行字段。
- `--help` / `--version`。

退出码：0 成功；1 运行/文件/数据源失败；2 参数或 JSON 错误；3 权限错误；4 本地数据冲突；130 取消或超时。JSON 结果有 `schemaVersion: 1`、`success`、`data` 或 `error.code/message`。报价缺少的标的在 `missingSymbols` 中明确返回，批量部分成功不伪造缺失报价。分页返回 `total/offset/limit/items/nextOffset`；K线和期权链的来源信息在分页外保留。

`NaN` 和无穷值编码为 JSON null；必须结合 `incomplete`、预热说明、`status`、`ivStatus` 和 `isMaxProfitUnbounded/isMaxLossUnbounded` 等字段判断，不能把 null 当成 0。数据源健康度只描述当前进程观察，不代表桌面程序的状态，也不代表实际探测通过。`sources` 本身不发真实行情探测。

### 策略输入

`analysis.json`：

```json
{
  "spot": 100,
  "valuationTime": "2026-11-13T15:00:00Z",
  "rate": 0.04,
  "volatility": 0.25,
  "legs": [
    { "type": "Put", "side": "Short", "quantity": 1, "strike": 95, "premium": 2.5, "expiry": "2027-06-18", "multiplier": 100 }
  ]
}
```

`type` 为 Call/Put/Stock，`side` 为 Long/Short，quantity 必须为正；股票腿以股为数量，乘数固定 1。单腿可提供 `iv`；省略时使用分析参数 `volatility`。仅分析同到期日到期盈亏时可省略 valuationTime/volatility。混合到期策略必须提供估值时间和有效 IV，盈亏曲线按最早到期日对后续腿估值，不把所有腿假装同时到期。若提供估值时间和正的 fallback volatility，还返回风险中性模型的盈利概率；不等同于实际预测胜率。Reg-T 保证金只是估算，不能代替券商要求。

`saved-strategy.json` 只包含保存所需字段（不接受 analysis.json 的估值字段）：

```json
{
  "name": "AAPL short put",
  "symbol": "AAPL",
  "legs": [
    { "type": "Put", "side": "Short", "quantity": 1, "strike": 95, "premium": 2.5, "expiry": "2027-06-18" }
  ]
}
```

按相同名称保存会替换已有策略。提醒 `save` 不传 id 为新增，传已有 id 为更新；设置阈值会重新要求首次采样，保留触发历史。持续提醒仍由桌面程序负责，CLI/MCP 不创建第二个后台监控器。

## MCP 配置

支持 stdio 的 MCP 客户端可使用以下配置（不同客户端的配置外层可能不同）：

```json
{
  "mcpServers": {
    "easysellput": {
      "command": "/absolute/path/to/easysellput",
      "args": ["mcp", "serve", "--data-dir", "/absolute/path/to/EasySellPut-data"]
    }
  }
}
```

Windows command 改为完整的 `easysellput.exe` 路径，JSON 中反斜杠需写成 `\\`。源码模式可使用 command=`dotnet`，args 首项为已构建的 `easysellput.dll` 绝对路径，再接 `mcp serve ...`；客户端必须能找到对应 .NET 10 运行时。

默认只读，发现列表不包含修改工具，直接调用修改工具也被拒绝。确需让客户端修改本地自选股、策略或提醒时，在 args 中显式增加 `--allow-writes`。这个开关允许本次 MCP 进程全部已登记的修改操作；仍应由客户端按自己的策略确认操作。工具注解用于描述，不代替权限检查。

查询/计算工具：search_symbols、get_quotes、get_bars、get_expirations、get_option_chain、get_fundamentals、get_financials、get_news、get_market_events、get_market_liquidity、get_source_health、probe_data_sources、get_chart_analysis、analyze_option_chain、get_pricing_assumptions、get_volatility_insights、list_strategy_presets、build_strategy、strategy_what_if、get_chart_drawings、calculate_option、calculate_indicators、analyze_strategy、get_watchlists、get_saved_strategies、get_alerts、get_alert_history、get_settings。

修改工具：create_watchlist_group、rename_watchlist_group、delete_watchlist_group、add_watchlist_symbol、remove_watchlist_symbol、save_strategy、delete_strategy、save_alert、delete_alert、set_alert_enabled。

所有工具返回结构化结果，同时保留兼容客户端的文本 JSON。业务错误以 isError 返回，协议仍可继续使用。stdout 专用于 MCP 协议，不要用 shell 启动脚本向 stdout 打印提示。

## 本地数据与桌面并用

默认数据目录沿用平台约定：Windows `%LOCALAPPDATA%\EasySellPut`，macOS `~/Library/Application Support/EasySellPut`，Linux 为 .NET LocalApplicationData 下的 EasySellPut。便携版在 CLI 旁放置 portable.flag 后使用旁边的 data 目录。CLI 与桌面不放在同一目录时，推荐明确传 `--data-dir` 指向桌面实际数据目录。

MCP 每次操作重新加载本地存储，因此能看到另一 CLI 进程保存的数据。桌面内存中的状态不会自动热刷新：外部修改后，请重新加载或重启桌面再编辑。新版共享 JSON 写入有跨进程锁和快照校验，旧快照保存报 `data_conflict`；不会覆盖新文件。发生冲突时重新读取后再决定重试，不要盲目重试原编辑。旧版本桌面未实现此保护，升级所有写入端后再并用。

只读 MCP 不修改自选股、策略和提醒；正常查询仍可能建立本地日志目录或 SQLite 行情缓存。设置查询不返回手动代理 URL/凭证。不提供任意路径读写、shell 或任意 URL 工具。

## 开发验证与发布

```bash
bash build/test-headless.sh
bash build/pack-cli.sh linux-x64
python3 tests/automation/cli_mcp_smoke.py --executable build/out/cli/EasySellPut-CLI-0.6.0-linux-x64/easysellput
```

回归脚本运行 Core/Data/Analytics/Shared/Mac/Automation 六组离线测试及真实 CLI/MCP 进程测试，保留真实退出状态，输出目录包含当前运行的 TRX、日志及无窗口 UI 截图。实时行情测试不包含在离线验证里；需要真实网络、行情源及相应地区访问条件。Windows WPF/macOS 原生桌面、通知和签名仍需在对应系统验收。

### 手动真实行情验收（不会加入普通 PR 的离线测试）

```bash
source tools/env.sh
MEILI_LIVE=1 python3 tests/automation/live_cli_mcp_smoke.py
# 或测试实际发行可执行程序：
MEILI_LIVE=1 python3 tests/automation/live_cli_mcp_smoke.py --executable /path/to/easysellput
```

必须显式设置 MEILI_LIVE=1。脚本分别使用生产 CLI 和 MCP 请求报价、历史K线（含末页最新交易日）、到期日、期权链、基本面、财报、新闻和搜索，校验来源、抓取时间、行情时间、缺失标的及缓存状态。报告默认在 build/out/live-readiness/acceptance。失败时返回非零，不把第三方限流或离线缓存当作成功。网络请求超时默认 60 秒，可通过 --timeout 调整。

事件查询的日期精度、预计/确认状态及历史覆盖边界见 [K 线事件时间线](16-K线事件时间线.md)。

完整桌面功能对应、47 项工具及界面/监控/安全例外见 [MCP 全功能覆盖审计](17-MCP全功能覆盖审计.md)。新增写入工具包括 record_option_snapshot、add_chart_drawing、update_chart_drawing、delete_chart_drawing、clear_chart_drawings、update_preferences、clear_alert_history、move_watchlist_symbol，MCP 同样要求 --allow-writes。

## 软件更新（本地维护）

`easysellput update check --json` 检查签名的稳定桌面版本；`easysellput update download --json` 下载并验证当前架构包。可加 `--data-dir PATH` 使用相同网络配置。不会自动安装；在桌面设置页阅读更新内容并确认安装/重启。MCP 不开放自我替换可执行文件或任意安装命令。参见 [检查更新与安装](29-检查更新与安装.md)。

缓存维护：`cache status` / `cache clear --category bars --symbol AAPL`；MCP 对应 `get_cache_status` / `clear_cache`。作用范围、历史数据保护与清理语义见 [统一缓存管理](47-统一缓存管理.md)。

## 市场流动性

`easysellput liquidity --json` 或 MCP `get_market_liquidity {}` 返回同一报告：实验性0–100资金压力分数/公式/权重/日期、六项FRED宏观指标、11个行业ETF的日频成交活跃度与Amihud代理。缺少/陈旧输入不出分数，不是VIX、实时深度或资金净流入。无需写权限。详见[数据口径与验收](52-市场流动性与行业热力图.md)。


### QQQ GEX 本地只读归档与页面数据

`get_qqq_gex_archive` 的 `resource` 为 `dates`、`snapshots`、`profile`、`bars` 或 `providers`。`providers` 不需要 date：分页返回本地保留的原始来源响应哈希、来源、发布时间、接收时间和存储大小；使用 `get_qqq_gex_view resource=providerRaw providerHash=该哈希` 读取原始字节，不能传文件路径。除日期索引外需 `date`；完整 profile 还需快照列表原样返回的 `expiry` 和 `capturedAt`。每页最多 200 项，后续页必须带首批 `revision`；`revision_changed` 后从第一页重读。profile 不经过 compact、舍入或缺失补零。

`get_qqq_gex_view` 支持 `display`、`evidence`、`context`、`exposureManifest`、`exposureWindow`、`spreadQuote`、`analysis`、`workspace`、`providerRaw`。大结果用 base64 分块（默认 64 KiB，最大 256 KiB）；解码拼接后验证完整 `sha256`，再解析 JSON/NDJSON。后续块提交 `offset` 和首块 `sha256`，内容变化返回 `revision_changed`，不得拼接旧块。context 的 `at` 固定响应时间，缺少参考日期仍明确报告。manifest 只接收日期及可选 expiry；窗口需使用 manifest 的精确 from/to/source，最长一小时，读完全部窗口后重读 manifest 验证 revision。

analysis 复用导入的 UI 内核：exposure、replayTable、gammaModel、atmIv、maxPain、pulse、optionOverview、dayScenario、wallTouches、spreadStudy、structureEvents、activityResponse、overlays、chart、heatmapField。需 date、at 游标，selected scope 还需 expiry；mode 支持 gamma/gamma-call/gamma-put/delta/charm，metric 支持 gex/oi/volume。工具的 complete=false 不等于传输丢失：它明确不认证缺失历史或全日覆盖。每个快照仍保留自己的输入质量、来源、源时间、延迟和计算版本。不能把这些工具的新增视为所有 UI 分析已完成逐项验收，详见 web/qqq-gex/MIGRATION-MATRIX.md。

`workspace` 无需市场数据库或 Node：只读返回允许保存的界面偏好、已解码的 analyticalSelections、最近观察到的回放游标／作用域／模式／执行价筛选，以及桌面采集阶段、部分数据、存储状态、原生行情和配色的带时间戳观察。`desktop.fresh` 仅表示 30 秒内观察过，不能证明窗口仍运行或行情实时；关闭／休眠后旧观察明确标记 stale。偏好中的 `qqq-local:observed-*` 同样带 observedAt，不冒充瞬时屏幕状态。此工具不改变界面，也不启动监控。读取更新会使分块 hash 失效，应从头重读。

`wallTouches` 新增 `wallHorizon=10|30`（默认 30）、`wallGamma=all|positive|negative|zero`、`wallPeriod=all|open|middle|late`、`wallSide=all|put|call`。`presentation` 采用原界面筛选和直方图表达式：历史参考未认证时 `statsKnown=false`、summary/histogram=null、事件／表格为空；完整筛选事件不截断，表格单独给最后 8 项。旧顶层 events/summary 明确为未筛选保留样本，不当作界面已就绪统计。ATM IV/Max Pain 的跨到期日曲线查询使用 scope=all；单到期日查询是有意缩小范围。

这些读取工具无需 --allow-writes，不采集远程行情或生成观察记录。capture_qqq_gex_input、calculate_qqq_gex_local、rebuild_qqq_gex_history、clear_cache 仍是独立写操作。
## Yahoo 免费推送

`easysellput live AAPL SPY QQQ --seconds 10 --max-updates 20 --json`；MCP `get_live_quotes` 使用同一有界 WebSocket 会话。不是 HTTP 快照或无限监控。完整的覆盖、缺失/断线语义与验证见 [免费 Live](53-Yahoo免费Live与全应用行情订阅.md)。

QQQ GEX 部分采集：`get_qqq_gex_view resource=partial` 返回与桌面“部分采集”表相同的最新元数据，无需桌面打开；`get_qqq_gex_archive archiveState=partial` 可分别分页读取 dates/snapshots/profile/bars。默认 archiveState=published 保持原行为，两种记录绝不混作完整交易日，也不能用 partial 直接授权常规回放。

QQQ GEX 的 `workspace.analyticalSelections.interaction` 还提供私有页面最近观察到的焦点、控件值、指针、可见提示及原始 K 线悬停数据。`observedAt` 是观察时间，`documentId` 区分页面；指针为 CSS 视口像素，图表时间为 Unix 秒。500ms 合并更新，经本地偏好桥保存，不能代表瞬时屏幕或原生全局输入。密码／文本草稿不导出；隐藏页面清空交互。超长内容明确返回 `detailsOmitted`，完整序列请读 chartStudies/archive；提示文字最多4条、各1000字符。缺失字段、旧时间戳及未验证的原生输入流程不能当作实时完整覆盖。

热图当前检查结果见 `interaction.heatmapInspection`：保留原始单元格、null、缺失输入原因、模式、键盘观察及 `scenario`／覆盖信息。其时间是 Unix 毫秒（`heatmapTimeUnits`），K 线仍为 Unix 秒。情景估值不是历史实测。`tooltipsOmitted`、`detailsOmitted` 和 `observationLimits` 明示观察上限，不能把省略内容当成不存在；完整序列继续读 heatmapField/dayScenario/archive。

Exposure observations distinguish mode (retained original selection), scenarioMode (original scenario kernel mode) and displayedMode (actual UI select/model). Delta/Charm retained history selection can display Gamma in scenario view; never infer effective scenario mode from heatmapInspection.mode, which is the original inspector input. Read exposure.displayedMode and preserve scenario provenance.

Exposure also retains original scenarioInputAt/scenarioDisplayedAt (Unix milliseconds), scenarioLoading/scenarioRetained/scenarioError. While recalculation is pending, the displayed scenario may be older than the requested input; respect these fields instead of attributing a retained field to the new cursor.

Exposure active identifies visible heatmap state; allExpiries identifies matrix aggregate context. displayedMode is the effective heatmap model, not proof of an on-screen heatmap while active=false.
# Local application package maintenance

The modular migration currently provides explicit local maintenance primitives:

```sh
easysellput apps list --json
easysellput apps doctor --data-dir PATH --json
easysellput apps install --package signed.espapp --data-dir PATH --json
easysellput apps update --package signed.espapp --data-dir PATH --json
easysellput apps disable easysellput.example --data-dir PATH --json
easysellput apps enable easysellput.example --data-dir PATH --json
easysellput apps uninstall easysellput.example --data-dir PATH --json
easysellput apps recover --data-dir PATH --json
```

Only the compiled repository/key is trusted. Unconfigured local builds reject installation; no runtime trust override is available. Discovery does not initialize storage. An app in use blocks maintenance. Update rejects downgrades and unplanned data-format changes; uninstall preserves app data and immutable backups. Recovery reconciles interrupted journal metadata and never promotes an uncommitted candidate or rewinds observations. These commands are CLI-only software maintenance and never MCP tools. Installing metadata is not yet proof of GEX runtime/UI integration; track S06 onward in TODO.md.
