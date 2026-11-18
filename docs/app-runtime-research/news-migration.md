# S14 — News and fundamentals

## Core boundary

`easysellput.news-fundamentals` exports the unchanged read-only `get_news`, `get_fundamentals`, and `get_financials` contracts. Its independently signed core bundles the shared engine SDK and calls the existing routed providers. Sources, unknown publication times, financial periods/units and article URLs pass through unchanged. Installation requires all three stable operations; foreign ownership, changed permissions and schemas remain rejected. There is no browser execution or maintenance capability.

Native clients now share ModuleFacadeClient with liquidity, including authenticated discovery, execution/job/asset leases, exact request-owned host capabilities, cancellation and no resurrection after disable/uninstall. The native news page retains its existing QuoteHub/live presenter, provider/cache instances, exports and shared symbol context. MarketTimelineService and chart events remain chart-owned; personal pages and ArticleSplitView remain host-owned and have no app engine bridge.

News refresh gained generation fencing: results from an old symbol/hidden page cannot overwrite current content even if a provider ignores cancellation. Requests dispose their own cancellation source, stale completion cannot restart busy state/timers, and hidden timer callbacks do not issue new work.

## Delivery and test evidence

The third app uses the existing package writer, runtime pin, immutable installer and separate signed catalog. Automatic promotion checks each version sequentially after required main CI; manual recovery selects one app. New NEWS-test-package comes from the required integration job. No package is rebuilt in release jobs or promoted from work/PR.

Local core baseline run-ZUhgc8eg passed 1,062 .NET cases (two additional Windows-only skips), Python 80, SDK 9, all 58 real CLI/MCP capability cases and the complete cache/AppDev/persistent-MCP/GEX/maintenance suite. The actual signed news package passed Node framing/null publication/source-error checks and fixed-host A/B CLI/persistent-MCP, permission/bounds, data-retaining uninstall/reinstall and personal bookmark hash preservation. Real re-sign/catalog/provenance/promotion checks passed with all GitHub writes intercepted. Liquidity and GEX regressions also passed after extracting the shared native facade.

## UI modernization and acceptance

The news workspace uses the host’s full-height ArticleSplitView. The left pane contains the page heading, symbol toolbar, quote/source summary and news list. The right pane initially contains fundamentals and financial statements. There is no news/fundamentals tab strip or nested split below the toolbar. Opening an article replaces the entire right pane with the existing isolated native reader; close/Esc restores the same fundamentals view and split ratio. The divider remains draggable, and changing articles retains browser identity. Leaving the workspace releases the article reader without deleting personal website sessions.

Both native implementations reuse Claude tokens, Lucide icons, AppActionCard, compact accessible refresh/export actions and existing financial controls. Empty metadata collapses; selection remains visible. Financial tables scroll horizontally in compact panes. No market-value, WebView or split-size animation is added. Inactive locale changes defer reload until activation.

Local full-height journey checks pass for default fundamentals, article replacement/reuse, Esc restoration, stable ratio and personal website navigation. Screenshots below are 1920×1080 Avalonia headless fixtures; the article region is a platform stub, not evidence of a rendered native website. Windows native WebView2 fixture coverage is included in the existing full desktop CI suite. Exact-commit native CI remains pending until the UI checkpoint is pushed and verified.

- [Default full-height split (fixture)](screenshots/news-fullheight-default-1920.png)
- [Article selection, dark (headless browser stub)](screenshots/news-fullheight-reader-dark-1920.png)

Core-only scope: native layout/browser adapters remain host-owned. S14 is not yet accepted pending final native exact-commit CI. Fixture results do not establish complete live coverage or production signing/distribution. No main merge or public release is performed.

## Visual fundamentals and consensus

Both native panes now share FinancialChart/AppFinancialChart: all available statement metrics can be selected as chronological annual/quarterly signed column charts; original statement tables remain under a disclosure. EPS history compares actual and consensus, followed by the source’s current/next quarter and year estimates. Revenue consensus is shown separately. Solid/outlined columns distinguish reported and estimated values; negative and zero values keep their meaning and missing actuals remain missing. Each column exposes exact values and source/range/analyst count through focus, click and tooltip. Small detail/disclosure feedback reuses reduced-motion-aware components; financial bars and split dimensions are not animated.

Yahoo earningsHistory/earningsTrend are an optional bounded eight-second request inside the existing thirty-minute managed fundamentals cache. An inaccessible or missing consensus endpoint preserves the usable company profile and exposes availability; user cancellation still propagates. The source’s fiscal labels/end dates, optional currency, fetched time, low/high estimates and analyst counts are retained. Forecasts are source consensus, not company guidance, guaranteed outcomes or locally extrapolated values. Coverage is limited to what the free source returns (currently EPS and revenue); ETFs and restricted symbols may have no estimates. Financial statement amounts retain original provider units; no unsupported currency normalization is implied.

The existing get_fundamentals CLI/MCP result gains additive financialCurrency/earnings/earningsAvailability fields. No new tool permission or browser capability is introduced. Actual signed core A/B CLI/persistent-MCP checks verify zero actuals, null future actuals, estimate intervals, source and analyst-count parity. Exports include the available consensus rows.

- [Visual fundamentals, 1920×1080 fixture](screenshots/news-financial-charts-default-1920.png)
- [Dark visual fundamentals, 1920×1080 fixture](screenshots/news-financial-charts-dark-1920.png)

The visual captures deliberately use labelled synthetic periods and amounts, not live company results. Source parser, unavailable-endpoint caching, signed shared zero/negative/null chart projection and actual signed CLI/MCP tests provide separate data-path evidence. New tests run under existing full Data/Shared/native desktop and four-platform CLI CI jobs; no narrower class allowlist replaces native regression coverage.

A deliberate live AAPL CLI check on 2026-11-18 returned Yahoo/USD, four EPS history comparisons and eight EPS/revenue consensus rows covering current/next quarter and fiscal year (twelve rows total). This demonstrates one successful free-source request, not a coverage guarantee. Quarter and fiscal-year charts are separated, with source period-end dates; no annual/quarterly magnitude comparison is implied.

Local visual follow-up checks: Data 162 passed (15 opt-in live checks skipped), Shared 138 passed, full Avalonia 145 passed (one opt-in live check skipped), updated split/personal-session journeys 4 passed, WPF cross-build passed and workflow policy validation passed. One concurrent Shared run hit an existing source-health timing deadline; the complete Shared suite passed on the isolated rerun. Actual signed A/B CLI/persistent-MCP forecast parity passed. WPF native execution is still delegated to full Windows CI, not inferred from cross-build.
