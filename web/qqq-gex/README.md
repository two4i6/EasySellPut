# QQQ GEX workbench migration (in progress)

Source: option-seller `work@d60e24b56e308a81723f6c206fb52d22ddc0e9f8`.
654 byte-preserved files are tracked in `source-manifest.json`.
`python3 tools/qqq-gex/verify-source.py` verifies fidelity. Original calculation,
research, indicators, replay and archive algorithms remain the single implementation.
Next component/worker, local transport and storage adapters are maintained here.

EasySellPut upstream `work@627a875` was merged
locally as `3de30b6`, after preserving prior work in `bbb2f23` and an external
archive. See [UPSTREAM-STATUS.md](UPSTREAM-STATUS.md). Nothing was pushed/deployed.

## Run and transport

`npm ci && npm run build && npm run build:runtime` builds the original React
page/workers and local model. WPF and Avalonia navigation entries serve embedded
assets through tokenized loopback HTTP with host/origin checks, bounded clients,
deadlines, CSP and no remote fallback. The system WebView2/WKWebView is required;
no Chromium is shipped. Private page downloads/popups/navigation/bridges are denied.

Visible desktop sessions capture routed QQQ providers every two minutes and run
the original model. Live observation uses the existing QuoteHub/QuotePump, releases
subscriptions while hidden/disposed and labels source time, declared delay and
expiration. Quotes and GEX capture times remain separate. This replaces the source
Yahoo SSE transport; it does not manufacture tick streaming or live eligibility.
History mode preserves date selection. Revision notifications refresh data without
reloading the WebView. ASK AI previews/copies the original selected-snapshot context
and prompt locally, without credential entry, automatic transmission or MCP writes.

## Data and cache ownership

`cache/qqq-gex.db` retains original CBOE bytes, normalized observations, full profiles,
partial/full days, real two-minute bars, summaries and import progress. Original
provider source/as-of/receipt/delay and model versions are preserved. All expiry
reads must agree on source/time/spot/raw revision. Only closed consecutive one-minute
pairs become two-minute bars. Missing IV/OI/timestamps/candles remain missing.
No snapshot time is shifted to another trading date.

A no-bars input is retained as a hash-verified partial day with visible per-expiry
metrics and quality. It cannot authorize the original full page/replay. Later real
aligned bars atomically promote retained captures; no candle is synthesized.

**CacheManager** registers `qqq_gex_wire` in desktop, CLI and MCP. Settings exposes
the category; stats include entries, expired and logical response bytes. Derived
wire responses have explicit expiration and a 256 MiB budget; oldest source times
are evicted first. `wireCoverage=capacity-limited` is explicit when applicable.
Clearing invalidates wire/receipt reuse and advances a shared SQLite generation;
calculations started before clearing cannot publish stale results. Maintenance never
deletes original observations, partial/full archives, summaries or database files.
The storage chart separates the mixed GEX database from other caches. Physical
SQLite file size is not reclaimed bytes. See [cache policy](../../docs/47-统一缓存管理.md).

Retained archives have no TTL; wire freshness is separate from historical validity.
Exact input reuse checks its receipt, scoped revisions and hashes. Cache clearing
invalidates reuse. Exposure manifests/windows can regenerate read-only from retained
profiles using the original manifest/wire code, with exact source-window validation.

## Local queries

- Exact wire variants, date/day projections, full/all-expiry exposure manifests and
  NDJSON windows; mismatched window revision fails closed.
- Original gex/bars history pagination, expiry selectors, compact profile projection
  and closed-bar causal join; retained full profiles are never replaced by compact ones.
- Original directional raw replay up to 32 days; 33–366 days aggregate persisted
  original daily summaries. Original source day-completeness criteria are extracted
  at build time rather than maintaining another algorithm. Incomplete days remain
  excluded by the source summary algorithm. Reads have explicit size/range bounds.
- Inclusive same-day PCS windows up to 90 minutes; context DTE 0–60 (all/volume),
  actual preceding 20 trading-day references and explicit missing-reference coverage.
- Exact historical two-leg quote lookup with the source five-minute causal cutoff.

CLI/MCP use `capture_qqq_gex_input`, `calculate_qqq_gex_local`,
`get_qqq_gex_replay`, `rebuild_qqq_gex_history`. Rebuilds resume batches up to 400
retained inputs with per-input commits, durable failures and explicit retry.
Unknown dynamic variants are unavailable; they do not trigger remote requests.

## Runtime and checks

Pinned official Node 24.22.1 archives/executable hashes cover Windows/macOS x64/ARM64
and Linux x64/ARM64. Packagers download at build time, verify pinned SHA and ship
license/provenance. The app extracts only the executable, verifies it on every run
and invokes its absolute path with NODE_OPTIONS/NODE_PATH/NODE_ICU_DATA cleared.
No user Node installation or application-side runtime download is required.

`npm run test:pipeline` covers algorithm-to-SQLite publication, hashes, incremental
history, idempotent reuse, partial recovery, queries, long-range summary, exposure
regeneration and cross-process invalidation. Original source tests are listed in
CI. `tests/offline-viewer.mjs` exercises Chromium (fixture transport, never native
acceptance); `QQQ_TEST_DB` selects computed or real retained partial data.
Generated screenshots/JSON live in ignored `test-results`; compact measured reports
are in [benchmarks/2026-11-16.json](benchmarks/2026-11-16.json).

## Actual evidence and remaining work

Retained real CBOE input contains 29 expiries/10,602 contracts; 84 positive-OI
contracts have zero IV. Seven-day prices contain 2,262 complete two-minute buckets
on Nov 9–13, while the chain's ET capture date is Nov 15. All 29 computed profiles
are retained and displayed as partial; no complete real day was published.
No missing option-seller database/blob history or 2026-10-15 snapshot was invented.

The controlled-input comparison in [benchmarks/2026-11-16-comparison.json](benchmarks/2026-11-16-comparison.json) uses the identical five dates / 600 snapshots / 96,000 contracts / 75 bars, alternating three fresh databases per version. Median import is 12.62 s → 3.63 s; median child peak RSS 780.8 → 454.4 MiB; database 562 → 83.1 MiB; derived wire bytes 248.9 → 23.0 MiB. All full row/profile, bar and summary fingerprints match, as do the sampled PCS wire response and two all-expiry manifests. These are synthetic shared-host results, not real-history or native performance acceptance. The older 16.1 s result remains in the dated original report.

The lossless v2 archive stores each profile once; original historical display algorithms reconstruct expiry projections on demand. Only all-expiry exposure and one canonical overview are prewarmed. Unsupported variants remain unavailable. Regular versus extended-session buckets and observed-span gaps remain explicit; no outer/full-day coverage is inferred.

The local PCS evaluator extracts the pinned route's original pure functions and factor-building pipeline at build time, reusing its daily eligibility, prior-close gate, intraday timing, contract-profile/target and actual-chain candidate rules. Captures retain routed daily QQQ/VIX/VIX3M/VXN observations and their provenance. Completed close dates must align; stale or missing inputs block qualification. Native quote subscriptions and model capture timestamps stay distinct. Canonical alerts and source lifecycle points are persisted only by fresh capture/calculation writes; reads do not invent alerts or historical observations. `get_qqq_gex_live_decision` exposes this read-only result to CLI/MCP. Source contract fixtures verify OPEN/NOW/READY, stale/misaligned/inherited BLOCK and no network fallback.

Presentation preferences use a token/Origin-protected local endpoint and SnapshotFile compare-and-swap at `qqq-gex-view.json`; this is a UI-state exception, not a business operation or credential store. Only named GEX/PCS presentation prefixes, bounded keys/values and partial patches are accepted. Conflicts surface in the page rather than overwriting another session. Random loopback ports no longer discard selected date, mode or chart options. CacheManager does not remove this file.

A newer actual capture at 2026-11-16 12:10 UTC retained all 29 expiries, 2,245 complete observed two-minute buckets (43 same date, all premarket), and 86 positive-OI contracts without IV. Option publication was 11:06:40 UTC; underlying last trade remained Nov 13 15:59:59 ET. It was correctly retained as partial with no complete day. The live source PCS evaluation produced BLOCK using Nov 13 completed daily close, PREMARKET/INSUFFICIENT_DATA and no candidate or saved alert. This is genuine partial-data evidence, not successful full live-to-page acceptance.

Remaining: complete original macro/regime source orchestration and additional route variants, historical lifecycle chart integration and exhaustive source page interactions/golden fixtures; original external historical database/blobs and unresolved 2026-10-15 discrepancy; theme/locale integration; native Windows/macOS execution/trust; representative complete real-history end-to-end performance. ASK AI remains explicit prompt export rather than source credential-backed in-page inference. Full migration is **not yet accepted**.

Linux full offline run: Core's new logging violations were fixed and 199 tests
repassed; Data/Analytics/Shared/Automation and Python/process checks are recorded
in the task results. Avalonia had 53 failures (73 passes), chiefly glyphTypeface;
the same NewsSplit failure reproduced on a pure upstream bf4d77d archive. Windows
WPF testhost cannot run here because Microsoft.WindowsDesktop.App is unavailable.
Cross-builds and Chromium are not native validation. See [VALIDATION.md](VALIDATION.md)
for the newest commands/outcomes; no remote CI green status is claimed.
