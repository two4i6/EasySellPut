# K-line application migration

## S16a: signed compatibility core

`easysellput.charts` packages eight existing operations: get_bars, get_chart_analysis, get_market_events, get_chart_drawings, add_chart_drawing, update_chart_drawing, delete_chart_drawing and clear_chart_drawings. Schemas, envelopes, errors, permissions, pagination and source provenance are unchanged. Generic calculate_indicators, live quote/bar sampling and shared transport remain host capabilities.

The app reuses host providers/cache, Analytics, MarketTimelineService and ChartDrawingStore; no second socket, data relocation, synthetic candle or duplicated financial model. Four drawing writes extend the existing exact-argument single-use request grant. Changed arguments, cross-domain mutation, duplicate invocation, denied reads, missing host commit and failed store writes cannot become successful mutations. Existing revision and atomic-write protection remains intact.

The shared package writer and SDK produce a core-only artifact. Independent four-platform app CI and required host CI validate it. Main-only release promotes the exact tested CHARTS-test-package sequentially with the other apps into the separate signed non-Latest catalog. Repository switches and trust pins are unchanged; no release is dispatched from work.

## Verification checkpoint

Local Automation 205 and Python 80 passed. Real signed engine framing covers eight operations and source errors. A fixed host with persistent MCP runs A → B, checks all eight operations against real CLI, retains one process, verifies read-only discovery/denial, stale drawing revisions, disable/enable and uninstall/reinstall, and preserves drawings, app data and unrelated bookmarks. Actual release re-sign/catalog/promotion checks passed with all GitHub writes intercepted and ephemeral test trust isolated to test hosts.

S16b native lifecycle and S16c exact-code native acceptance remain pending. This checkpoint changes no UI layout; existing chart screenshots are not new visual acceptance. The renderer and full native receipts remain host-owned, so this is core independence, not independently delivered chart UI.
