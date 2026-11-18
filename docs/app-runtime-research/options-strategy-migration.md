# S15 — Options and strategy

## Boundary

`easysellput.options-strategy` contributes twelve existing operations as one signed core. Generic calculate_option/calculate_indicators remain host-owned so registry recovery cannot disable general calculators. Shared Analytics, provider routing, full native chain receipts, quotes, private workbench rendering, transient drafts and original strategies.json/IV/OI history stay host-owned. Native full-chain loads deliberately retain complete provider snapshots rather than invoking a paginated engine for each 500 contracts or spawning a process per slider move. They hold verified domain execution leases through native processing. Save/delete use the authenticated app operation; source receipts are not new public DTO contracts.

## Write authority

Only the exact first-party save_strategy/delete_strategy/record_option_snapshot may declare its corresponding host write. Read sessions cannot grant writes. An explicitly authorized writer gets at most one host mutation with the original operation and arguments; altered arguments, another mutation, repeated calls and success without a successful host call fail. CLI and MCP use the same production dispatcher implementation; fixture hosts inject only test package verification/runtime dependencies. Desktop save/delete are async, preserve drafts on failure and retain name edits made while pending. StrategyStore applies its in-memory change only after the optimistic atomic file write succeeds. Uninstall retains original data and suppresses compatibility resurrection.

## Delivery and current evidence

Fourth-app packaging and sequential main-only catalog promotion reuse the shared SDK, writer, signing/provenance flow and protected release job. Required CI includes its artifact, signed engine framing and fixed-host A/B CLI/persistent-MCP cases on all four CLI platforms. Local checks passed Shared 142, Automation 200, Python 80, signed twelve-operation engine framing, A/B read/write permissions, retained entries/data/bookmarks and WPF cross-build. Native exact-revision CI is pending; this checkpoint does not close S15.

## UI work in progress

Reference: https://www.wealthsimple.com/en-ca/trade/options (retrieved 2026-11-18; headings include Intuitive trading experience, Stream quotes in real time, Trade faster with smart workflows and Build advanced strategies) plus the user-provided screenshot. Adopt centered strikes, paired bid/sell and ask/buy quote chips, a compact leg ticket and prominent cost/risk/payoff. Keep our Claude tokens, Lucide and existing components; do not reproduce broker orders, fees, account balances or execution promises. Native simulation and save semantics remain explicit. UI/browser acceptance and 1080p fixtures follow separately.
