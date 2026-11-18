# S15 — Options and strategy

## Boundary

`easysellput.options-strategy` contributes twelve existing operations as one signed core. Generic calculate_option/calculate_indicators remain host-owned so registry recovery cannot disable general calculators. Shared Analytics, provider routing, full native chain receipts, quotes, private workbench rendering, transient drafts and original strategies.json/IV/OI history stay host-owned. Native full-chain loads deliberately retain complete provider snapshots rather than invoking a paginated engine for each 500 contracts or spawning a process per slider move. They hold verified domain execution leases through native processing. Save/delete use the authenticated app operation; source receipts are not new public DTO contracts.

## Write authority

Only the exact first-party save_strategy/delete_strategy/record_option_snapshot may declare its corresponding host write. Read sessions cannot grant writes. An explicitly authorized writer gets at most one host mutation with the original operation and arguments; altered arguments, another mutation, repeated calls and success without a successful host call fail. CLI and MCP use the same production dispatcher implementation; fixture hosts inject only test package verification/runtime dependencies. Desktop save/delete are async, preserve drafts on failure and retain name edits made while pending. StrategyStore applies its in-memory change only after the optimistic atomic file write succeeds. Uninstall retains original data and suppresses compatibility resurrection.

## Delivery and acceptance

Fourth-app packaging and sequential main-only catalog promotion reuse the shared SDK, writer, signing/provenance flow and protected release job. Required CI includes its artifact, signed engine framing, intercepted release promotion and fixed-host A/B CLI/persistent-MCP cases on all four CLI platforms. Main-only publication and the independent release switches are unchanged. No release is published from work.

Exact-revision native acceptance is pending for the UI checkpoint. The preceding core checkpoint is `28720ac`; its four-platform Apps build passed, while integrated CI exposed a catalog test still expecting three applications. That test now verifies all four entries and the next catalog generation; no check was removed.

## UI and interaction

Reference: https://www.wealthsimple.com/en-ca/trade/options (retrieved 2026-11-18; intuitive trading, streaming quotes, workflows and advanced strategies), together with the user-provided screenshot. Reuse our Claude tokens, Lucide aliases, popovers and shared Web components; this remains simulation, without brokerage orders, fees or account balances.

- Workbench: centered strikes, Call/Put on either side, observed Bid/Sell and Ask/Buy chips. A second click removes the matching draft leg. Missing/crossed quotes cannot create legs; C# resolves source prices, not HTML input. Refresh and quantity edits preserve entry prices.
- Right ticket: compact legs, side/quantity/remove controls, prominent net cost, maximum profit/loss and breakevens. Existing Greeks, margin and source/model details remain available. Payoff shading uses the existing C# samples and configured gain/loss colors.
- Native pages: refresh/export/saved controls use consistent icon buttons. Four leg actions share one popover. New profiles default to compact option columns; an explicitly stored expanded preference remains unchanged. Strategy presets and quantity controls retain accessible names without redundant labels.
- Help and model notes are progressively disclosed. Data failures, missing quotes and coverage limits remain visible. Small control transitions respect reduced motion; market values, charts and split resizing are not animated.
- Desktop keeps native and private WebView presentation. This is a core-only independent package, not an independently delivered options Web UI. The paginated public chain and full native provider snapshot are intentionally different contracts.

## Screenshots and test scope

The following are 1920×1080 real Chromium renders backed by the C# workbench fixture host. Prices, expiry and source are fixtures, not live market evidence. Native headless tests separately cover toolbars, alignment, locale/theme and narrow layouts; their WebView placeholder does not prove native browser rendering. Native CI remains required.

![Dark workbench: paired quotes and strategy ticket](screenshots/s15-workbench-dark-1920.png)

![Light workbench](screenshots/s15-workbench-light-1920.png)

Browser journeys cover quote selection/toggling, locked entry prices, quantity/side/removal, recomputation, filters, payoff zoom/pan/fit, what-if, help, theme/locale and 480px layout. Shared regressions cover corrupt-registry navigation, compact preference persistence and failed atomic-save memory state. Signed process tests cover all twelve original operations, explicit write authority, read-only MCP, A/B update/rollback and retained user data.
