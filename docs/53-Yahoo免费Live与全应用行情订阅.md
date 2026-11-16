# Yahoo 免费 Live 与全应用行情订阅

## 接入范围

连接 Yahoo 自己的 `wss://streamer.finance.yahoo.com/?version=2`，无需账号或 API Key。发送 subscribe，解析 JSON 中的 base64 PricingData protobuf，保留原始成交时间、价格和常规/盘前/盘后会话。此为 Yahoo 公共指示性最新价推送，不宣称交易所全市场 SIP、NBBO、逐笔完整性或零延迟；WebSocket 是接收方式，不能代替数据授权和时效证明。

协议参考：[PricingData](https://github.com/ranaroussi/yfinance/blob/main/yfinance/pricing.proto)、[Yahoo 流客户端参考](https://github.com/ranaroussi/yfinance/blob/main/yfinance/live.py)。本项目使用 .NET ClientWebSocket 与自有有界解码器，没有增加 Python、protobuf 或浏览器行情依赖。

| 使用位置 | 行为 |
| --- | --- |
| 概览、自选 | 现有 QuoteHub 广播直接更新价格、涨跌、行情时间；来源显示推送或轮询 |
| macOS 状态栏、行情速览、Windows 托盘速览 | 复用同一 Hub；保留常规和盘前盘后各自的时间与来源 |
| K 线 | 可见页订阅当前 symbol；私有 state 通道独立更新最新价线。保持历史 OHLC、成交量、指标、画线和视口，不能从一个价格伪造完整蜡烛 |
| 期权与策略 | 共用 LiveQuotePresenter 显示当前标的价。链同期 Spot/IV/Greeks、入场权利金和用户假设保持独立，不把延迟期权与当前股票混成同一时点 |
| 新闻与基本面 | 当前报价、涨跌和标题更新；公司资料与统计仍保留快照性质，不逐 tick 重算全部基本面 |
| 价格提醒 | 使用推送后的最新缓存，仍按既有 5/10/60 秒会话检查节奏评估，不随推送频率增加规则更新或通知 |
| QQQ GEX | “实时观察”订阅 QQQ，独立轻量 /quotes 长轮询由 Hub 更新唤醒；复用原生 Yahoo 连接。历史模式释放该页订阅，不重算或改写历史 GEX、PCS、OI/IV/期权快照 |
| CLI / MCP | 同一 QuoteStreamingService；有界采样，不创建永久监控、提醒任务或磁盘行情归档 |

期权买卖价、历史 OHLC、新闻、宏观指标和 GEX 期权输入均不属于这个股票最新价流，不能因此标记为实时。

## 生命周期与性能

- 每个桌面进程一条共享连接，合并活动页面/菜单栏/提醒的 symbol；最多 50 个推送 symbol，超出部分保留 HTTP 补位和轮询标识。
- 订阅变更取消旧连接，等待其结束后重连；150ms 合并导航抖动，恢复后重新订阅。无订阅就断开，不新建页面级 socket。
- 使用现有 HttpGateway 的代理、连接池、TLS 校验；连接期限 12 秒，指数退避至 30 秒，支持取消。15 秒续订及协议保活；没有成交不伪造价格，也不等同断线。
- 分片累计上限 64 KiB、protobuf 上限 32 KiB；异常 varint/长度/价格、未订阅 ticker、未来时间和过时 tick 不进入当前报价。
- 现有单一 QuotePump UI timer 消费按 symbol 合并的最新更新：可见最多 4Hz、后台最多 1Hz；静默 5 秒后恢复原轮询节奏。没有第二套 UI 行情计时器。
- 持续收到推送时避免同 symbol 重复 HTTP，每分钟保留元信息快照补齐；断流后 HTTP 补位。晚到的 HTTP 不能把较新的推送价格改回去。
- 最新价来源与其他 HTTP 字段的 SnapshotSource / SnapshotFetchedAt 分开记录；不把旧 bid/ask 当成新成交时点的实时买卖盘。
- QQQ GEX 的逐价更新不扫描归档、不改变缓存版本、不触发历史重算、不另建浏览器 WebSocket；隐藏/历史切换停止该页 quote 请求。

## 历史 K 线与 Live 尾部衔接

- 共用 Application 的 `LiveBarStitcher`，以实际历史时间网格对齐分钟/小时桶；小时线保留提供商的 :30 锚点，日/周/月线等待提供商当前周期锚点。
- 启动、恢复连接和发现跳桶后补拉重叠历史，按时间去重；页面请求单飞并限频，关闭/切换继续沿用原有取消机制。
- 当前观察尾部单独标记 `incomplete`，只含实际价格 Close；未知 OHLC/成交量为 null，不用前值补造蜡烛。已收盘且在收盘后下载的权威 K 线替换重叠观察点。
- Yahoo 分钟历史常附带秒级最新报价尾点。解析器不再把它当成 interval 蜡烛；衔接器与在线/离线缓存读取视图也过滤旧缓存中的同类点（保留原始存储记录），避免重复、时间桶偏移或遮住新的 Live 值。报价时间不等于每根蜡烛的更新时间。
- 跨数据源、标的、周期或复权口径会清除旧观察尾部；分红复权未验证时不把原始推送价格接入调整后的序列。
- 状态明确区分 joined / repairing / waiting_history / waiting_price / adjustment_unverified。缺失真实分钟时显示补齐中并重试，不画虚假的跨缺口连线。正常闭市时段不被当成遗失交易分钟；沿用 MarketClock 的已知节假日范围，未新增提前收盘日历。

## CLI 与 MCP

```sh
easysellput live AAPL SPY QQQ --seconds 10 --max-updates 20 --json
```

历史与 Live 衔接也可只读调用：

```sh
easysellput live-bars QQQ --interval 1m --seconds 20 --max-updates 100 --json
```

MCP `get_live_bars` 使用相同业务服务，返回 canonical history、单独的 observedTail、缺口范围和状态，不修改历史缓存为伪造实时 OHLC。

MCP：`get_live_quotes`，参数 `symbols`（1..50）、`seconds`（1..20，默认 5）、`maxUpdates`（1..500，默认 100）。只读；结果带 `transport=websocket`、原始 tick 时间、session、missingSymbols、received/no_updates/unavailable 和错误信息。采样结束或取消立即释放本次连接。需要常规快照/历史时分别使用 get_quotes/get_bars。伴随 skill 更新为 2.3；精确的旧版可升级，自定义修改继续保护。

生产 CLI 已在北京时间 2026-11-17 00:12:05–00:12:07 收到 AAPL/SPY/QQQ 连续六条实际推送；[保存的原始结果](yahoo-live/production-cli-snapshot.json)。这是历史验证快照，不是当前价格。

## 实际源验证

- [生产 CLI 推送样本](yahoo-live/production-cli-snapshot.json)：三标的、六条实际推送。
- [生产 MCP 推送样本](yahoo-live/production-mcp-snapshot.json)：通过实际 SDK stdio MCP 收到三标的实际推送。
- [120 秒连接检查](yahoo-live/production-120s-soak.json)：6 标的 717 条更新，观察到 0 次连接中断、0 次源时间倒退；最大单标的接收间隔约 2.13 秒，最大测得源时间滞后约 9.9 秒。此结果不证明完整逐笔覆盖或未来永不中断。
- [QQQ 历史/Live 衔接样本](yahoo-live/production-live-bars.json)：北京时间 2026-11-17 01:26，18 条实际推送；历史最后两根为 17:24/17:25 UTC，观察尾部为 17:26 UTC，状态 joined，没有额外空分钟、重复时间或伪造 OHLC/量。

以上均为验证时刻的数据，不代表当前价格。免费源发生真实历史缺失时，系统明确报告并补拉，无法凭空保证源端完整。

## 验收与 CI

覆盖协议解码/分片/取消清理、空闲与断线重订阅、有界采样、旧 HTTP 回滚、盘前盘后与常规价格分离、无订阅停止、提醒频率、跨页面当前价及链同期估值不被覆盖。CLI/MCP 新操作进入能力清单和真实进程逐操作对照，五个平台继续跑完整业务测试；四个桌面目标保留原生验收。

QQQ Web CI 增加真实 Chromium 的 live-quote 测试：价格变化、旧响应防回滚、无 GEX 重新请求、历史模式停止、单次导航和零浏览器 WebSocket。图表 renderer 回归验证最新价线变化时历史行、MA 和视口完全保持。合并远端并行修复后，保留 GEX 存储错误日志及 SQLite 清理修复。补齐新增 GEX 只读工具的真实 CLI/MCP 用例，覆盖检查实际执行全部 58 项操作；空缓存浏览器验收明确验证“尚无可读缓存”且不启动无效的 PCS 读取，没有放宽错误或远程请求守卫。QQQ 网页构建根据源码输入增量更新，避免复用旧 dist；实测修改源文件会重建，未改变时跳过网页打包。

## 截图

以下均为 1920×1080，实际 Avalonia/Skia 或 Chromium 控件，使用明确的离线测试数据，不代表上面的真实报价：

- [概览](yahoo-live/dashboard-dark-1080p.png)
- [期权](yahoo-live/options-dark-1080p.png)
- [策略](yahoo-live/strategy-dark-1080p.png)
- [新闻](yahoo-live/news-dark-1080p.png)
- [图表最新价线](yahoo-live/chart-live-price-1080p.png)
- [QQQ GEX 当前价格通道](yahoo-live/qqq-gex-live-1080p.png)（测试归档为空，重点验证独立当前价通道）
