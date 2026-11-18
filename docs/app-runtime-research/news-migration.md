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
