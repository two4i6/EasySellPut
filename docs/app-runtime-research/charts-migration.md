# K-line application migration

## S16a: signed compatibility core

`easysellput.charts` packages eight existing operations: get_bars, get_chart_analysis, get_market_events, get_chart_drawings, add_chart_drawing, update_chart_drawing, delete_chart_drawing and clear_chart_drawings. Schemas, envelopes, errors, permissions, pagination and source provenance are unchanged. Generic calculate_indicators, live quote/bar sampling and shared transport remain host capabilities.

The app reuses host providers/cache, Analytics, MarketTimelineService and ChartDrawingStore; no second socket, data relocation, synthetic candle or duplicated financial model. Four drawing writes extend the existing exact-argument single-use request grant. Changed arguments, cross-domain mutation, duplicate invocation, denied reads, missing host commit and failed store writes cannot become successful mutations. Existing revision and atomic-write protection remains intact.

The shared package writer and SDK produce a core-only artifact. Independent four-platform app CI and required host CI validate it. Main-only release promotes the exact tested CHARTS-test-package sequentially with the other apps into the separate signed non-Latest catalog. Repository switches and trust pins are unchanged; no release is dispatched from work.

## Verification checkpoint

Local Automation 205 and Python 80 passed. Real signed engine framing covers eight operations and source errors. A fixed host with persistent MCP runs A → B, checks all eight operations against real CLI, retains one process, verifies read-only discovery/denial, stale drawing revisions, disable/enable and uninstall/reinstall, and preserves drawings, app data and unrelated bookmarks. Actual release re-sign/catalog/promotion checks passed with all GitHub writes intercepted and ephemeral test trust isolated to test hosts.

S16b native lifecycle and S16c exact-code native acceptance remain pending. This checkpoint changes no UI layout; existing chart screenshots are not new visual acceptance. The renderer and full native receipts remain host-owned, so this is core independence, not independently delivered chart UI.

## S16b: native chart lifecycle

Shared composition now supplies ChartAppClient. Activation verifies installed domain operations under an execution lease; stale activation results dispose their lease. Hiding cancels activation/source work, releases the domain and shared quote demand, and fences hidden drawing gestures. Late source responses cannot populate a hidden/replaced load. Corrupt registries and suppressed apps fail explicitly without repair or silent compatibility resurrection. Navigation uses the same availability state.

Full provider receipts, Analytics, LiveBarStitcher, event bucketing, article splitting and native drawing gestures remain shared host capabilities. The authenticated visible-domain lease pins the compatibility package while the page is active; leave the page before updating/disabling/uninstalling. Direct native drawing gestures retain original SnapshotFile/revision checks; public CLI/MCP mutations run through the single-use app grants. No process is spawned per pointer move and no provider snapshot is truncated to public pagination. This presentation exception is recorded in desktop_capabilities.json.

Local Shared 154 and real Chromium 19 passed (including drawings, 28-event grouping, sessions/live gaps and ATM). The full Windows test project cross-build and native smoke build passed; these are compilation, not native execution. Existing CI runs full WPF, native WKWebView/WebView2 and extracted packages/updaters on all three desktop targets. Its chart browser journey now exercises the new domain activation too. Final code CI and full offline acceptance are still pending. The UI is unchanged, so no new visual design is claimed.
