# S14 — News and fundamentals

## Core boundary

`easysellput.news-fundamentals` exports the unchanged read-only `get_news`, `get_fundamentals`, and `get_financials` contracts. Its independently signed core bundles the shared engine SDK and calls the existing routed providers. Sources, unknown publication times, financial periods/units and article URLs pass through unchanged. Installation requires all three stable operations; foreign ownership, changed permissions and schemas remain rejected. There is no browser execution or maintenance capability.

Native clients now share ModuleFacadeClient with liquidity, including authenticated discovery, execution/job/asset leases, exact request-owned host capabilities, cancellation and no resurrection after disable/uninstall. The native news page retains its existing QuoteHub/live presenter, provider/cache instances, exports and shared symbol context. MarketTimelineService and chart events remain chart-owned; personal pages and ArticleSplitView remain host-owned and have no app engine bridge.

News refresh gained generation fencing: results from an old symbol/hidden page cannot overwrite current content even if a provider ignores cancellation. Requests dispose their own cancellation source, stale completion cannot restart busy state/timers, and hidden timer callbacks do not issue new work.

## Delivery and test evidence

The third app uses the existing package writer, runtime pin, immutable installer and separate signed catalog. Automatic promotion checks each version sequentially after required main CI; manual recovery selects one app. New NEWS-test-package comes from the required integration job. No package is rebuilt in release jobs or promoted from work/PR.

Local core baseline run-ZUhgc8eg passed 1,062 .NET cases (two additional Windows-only skips), Python 80, SDK 9, all 58 real CLI/MCP capability cases and the complete cache/AppDev/persistent-MCP/GEX/maintenance suite. The actual signed news package passed Node framing/null publication/source-error checks and fixed-host A/B CLI/persistent-MCP, permission/bounds, data-retaining uninstall/reinstall and personal bookmark hash preservation. Real re-sign/catalog/provenance/promotion checks passed with all GitHub writes intercepted. Liquidity and GEX regressions also passed after extracting the shared native facade.

## UI modernization and acceptance

User requested modernization using the existing split component. Planned scope: reduce three-column overload, prioritize the article list, provide a clear news/fundamentals switch, reuse action cards and compact icon actions, retain readable sources and existing financial controls. Match the Claude design tokens and Lucide icons; no duplicate component system or page/layout animations. Original articles stay in the same left/right ArticleSplitView with resize/history/close behavior and WebView isolation.

Core-only scope: native layout/browser adapters remain host-owned. Current UI modernization and final native exact-commit CI are pending; S14 is not yet accepted. Fixture results do not establish complete live coverage or production signing/distribution. No main merge or public release is performed.
