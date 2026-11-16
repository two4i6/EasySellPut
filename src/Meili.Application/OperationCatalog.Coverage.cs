using System.Text.Json.Nodes;
using Meili.Analytics;

namespace Meili.Automation;

public static partial class OperationCatalog
{
    private static JsonObject Obj(params (string Key, JsonObject Value)[] fields) => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject(fields.Select(f => KeyValuePair.Create<string, JsonNode?>(f.Key, f.Value))),
        ["required"] = new JsonArray(),
        ["additionalProperties"] = false
    };
    private static JsonObject Range(bool integer, double min, double max) { var f = Field(integer ? "integer" : "number", ""); f["minimum"] = min; f["maximum"] = max; return f; }
    private static JsonObject IndicatorSchema() => Obj(
        ("maPeriod", Range(true, 1, 250)), ("emaPeriod", Range(true, 1, 250)), ("bollPeriod", Range(true, 2, 250)), ("bollWidth", Range(false, .5, 5)),
        ("macdFast", Range(true, 1, 250)), ("macdSlow", Range(true, 2, 251)), ("macdSignal", Range(true, 1, 250)), ("rsiPeriod", Range(true, 1, 250)),
        ("kdjPeriod", Range(true, 1, 250)), ("kdjM1", Range(true, 1, 250)), ("kdjM2", Range(true, 1, 250)));
    private static JsonObject QuotesSchema()
    {
        var item = Obj(("right", Field("string", "", "Call", "Put")), ("strike", Range(false, .000001, 1e9)), ("premium", Range(false, 0, 1e9)), ("iv", Range(false, 0, 20)));
        item["required"] = new JsonArray("right", "strike", "premium");
        return new() { ["type"] = "array", ["items"] = item, ["maxItems"] = 1000 };
    }
    private static Operation[] CoverageOperations() => [
        Op("get_qqq_gex_live_decision","Evaluate the pinned source PCS daily/previous-close gate, timing and real-chain candidate from retained local routed inputs. Read-only, no remote fallback. Source delays, date alignment and stale/missing inputs remain explicit; never grants account/order permission.",false),
        Op("rebuild_qqq_gex_history","Resume bounded imports of locally retained normalized observations through the original algorithm. Each input commits independently; failures persist and are retried only when requested. Never fills unavailable history.",true,("limit",Range(true,1,400)),("retryFailed",B())),
        Op("get_qqq_gex_replay","Compute original causal directional replay from local imported history only. Range is bounded to 366 days; ranges above 32 days use original daily summaries; missing data/runtime is explicit and no remote source is consulted.",false,("from!",S("ISO-8601 range start")),("to!",S("ISO-8601 exclusive range end")),("page",Range(true,1,100000)),("pageSize",Range(true,1,200))),
        Op("calculate_qqq_gex_local","Run the bundled original GEX algorithm on the previously captured local normalized input and atomically publish its local display resources. Uses the bundled pinned Node runtime; reports unavailable or invalid input rather than installing a runtime or inventing data.",true),
        Op("capture_qqq_gex_input","Capture one coherent QQQ option snapshot from existing routed providers and complete 2-minute price buckets to local normalized input. Explicit network/write; preserves delay, gaps and provider snapshot times. Does not calculate or claim historical completeness.",true),
        Op("probe_data_sources","Actively probe configured provider identities using the desktop router. Results apply to this process and the probed endpoint only; not a test of every capability. No arbitrary URLs.",false,("sourceId",S("Optional registered provider id; omitted probes all"))),
        Op("clear_alert_history","Clear local alert history, retaining alert rules and monitor state. Explicit write.",true),
        Op("move_watchlist_symbol","Reorder one symbol within a watchlist group; target index is zero-based. Conflict-safe local write.",true,("groupId!",S()),("symbol!",S()),("toIndex!",Range(true,0,10000))),
        Op("get_chart_analysis","All desktop K-line indicators (MA/EMA/BOLL/MACD/RSI/KDJ) and real volume on provider bars, computed before pagination; incomplete OHLC remains null. Optional comparison is rebased only on common timestamps.",false,
            [("symbol!",S()),("interval",Field("string","default 1d","1m","5m","15m","30m","1h","1d","1w","1mo")),("from",S("ISO-8601 instant")),("to",S("ISO-8601 instant")),("adjust",Field("string","default split","split","total")),("indicators",IndicatorSchema()),("compareSymbol",S()),..Page]),
        Op("analyze_option_chain","Desktop option enrichment, IV smile, Greeks, spread/distance and previous local OI. Missing spot/quotes stay missing. Uses configured pricing assumptions; optional valuationTime makes time deterministic.",false,
            [("symbol!",S()),("expiry",S("YYYY-MM-DD")),("valuationTime",S("ISO-8601 instant; default chain snapshot time")),..Page]),
        Op("get_pricing_assumptions","Configured/fetched risk-free rate with origin and symbol dividend yield. Unavailable yield falls back to zero explicitly.",false,("symbol!",S())),
        Op("get_volatility_insights","Current IV, IV rank/percentile from existing local history, and up to eight ATM term expirations. Does not record new history; insufficient history is explicit.",false,("symbol!",S()),("valuationTime",S("ISO-8601 instant; default now"))),
        Op("record_option_snapshot","Record current IV and OI into the shared local SQLite history. Explicit write; no background monitoring. Does not invent past observations.",true,("symbol!",S()),("expiry",S("Optional OI expiration YYYY-MM-DD; IV remains IV30/ATM nearest 30 days"))),
        Op("list_strategy_presets","Discover every supported strategy preset and its near/far expiry requirements. Custom legs use analyze_strategy/save_strategy."),
        Op("build_strategy","Build any desktop preset from caller-supplied listed reference quotes using the shared Analytics strike selection. No network/save; reference premiums are not executable quotes.",false,
            ("kind!",Field("string","",Enum.GetNames<StrategyKind>().Where(k=>k!="Custom").ToArray())),("spot!",Range(false,.000001,1e9)),("expiry!",S("YYYY-MM-DD")),("quotes!",QuotesSchema()),("farExpiry",S("YYYY-MM-DD, later than expiry")),("farQuotes",QuotesSchema()),("quantity",Range(true,1,1000)),("wingSteps",Range(true,1,100))),
        Op("strategy_what_if","Position and per-leg values/P&L/facts at an assumed price, with optional future horizon and IV shift. No GUI state/save. Mixed expiry requires valuationTime.",false,
            ("legs!",Legs()),("spot!",Range(false,0,1e9)),("valuationTime",S("ISO-8601 instant; omitted means intrinsic settlement for same-expiry legs")),("horizonDays",Range(true,0,3650)),("rate",N()),("dividendYield",N()),("volatility",Range(false,0,20)),("volatilityShift",Range(false,-20,20))),
        Op("get_chart_drawings","Read a symbol's persisted local horizontal/trend lines; does not control chart windows.",false,[("symbol!",S()),..Page]),
        Op("add_chart_drawing","Persist a bounded horizontal/trend line in the shared drawing store with conflict protection. Trend lines need distinct time1/time2.",true,("symbol!",S()),("kind!",Field("string","","HorizontalLine","TrendLine")),("price1!",Range(false,0,1e12)),("time1",S("ISO-8601 instant")),("price2",Range(false,0,1e12)),("time2",S("ISO-8601 instant"))),
        Op("update_chart_drawing","Replace one persisted drawing by absolute zero-based index (offset + row index) using the revision from get_chart_drawings. Stale revisions fail without overwriting.",true,("symbol!",S()),("index!",Range(true,0,199)),("revision!",S("Exact revision from get_chart_drawings")),("kind!",Field("string","","HorizontalLine","TrendLine")),("price1!",Range(false,0,1e12)),("time1",S("ISO-8601 instant")),("price2",Range(false,0,1e12)),("time2",S("ISO-8601 instant"))),
        Op("delete_chart_drawing","Delete one persisted drawing by absolute zero-based index (offset + row index) using the revision from get_chart_drawings. Other drawings remain; stale revisions fail.",true,("symbol!",S()),("index!",Range(true,0,199)),("revision!",S("Exact revision from get_chart_drawings"))),
        Op("clear_chart_drawings","Clear persisted drawings for one symbol with conflict protection.",true,("symbol!",S())),
        Op("update_preferences","Patch allowlisted local preferences; omitted fields remain unchanged. No proxy URL/credentials, arbitrary paths or window control. Desktop reload/restart required after external changes.",true,
            ("language",Field("string","","zh-CN","en-US")),("theme",Field("string","","System","Light","Dark")),("upDownColors",Field("string","","RedUp","GreenUp")),
            ("closeAction",Field("string","","Ask","MinimizeToTray","Exit")),("guideDismissed",B()),("strategyHintDismissed",B()),
            ("pricing",Obj(("rateMode",Field("string","","Treasury13Week","Fixed")),("fixedRatePercent",Range(false,-1,20)))),
            ("alerts",Obj(("maxQuoteDelayMinutes",Range(true,1,240)),("failureThreshold",Range(true,1,20)))),
            ("charts",Obj(("dividendAdjusted",B()),("indicators",IndicatorSchema()))),("options",Obj(("compactColumns",B()))),
            ("network",Obj(("proxyMode",Field("string","Uses existing local proxy configuration; restart MCP to apply","System","AutoDetect","Manual","Direct")),("requestTimeoutSeconds",Range(true,3,120)),("maxRetries",Range(true,0,5)))))
    ];
}
