# Local validation — 2026-11-16

Base: EasySellPut work, upstream bf4d77d merged as 04e0e13 after preservation bbb2f23.
Original algorithm source: option-seller work d60e24b. No remote CI, push or deployment.

| Check | Result |
| --- | --- |
| Source manifest | 649 hashes match pinned source |
| Original algorithm tests | 107 tests / 680 assertions, plus 3 daily-summary tests / 7 assertions passed |
| Core full suite | 199 passed after fixing new silent-catch logging violations |
| Data full suite | 139 passed; 15 deliberate live-provider skips |
| Analytics offline suite | 206 passed |
| Shared full suite | 92 passed after updating the storage-category test for the added GEX segment |
| Automation full suite | 72 passed |
| Python guard suite | 54 passed |
| Real CLI/MCP operation parity | All 51 operations passed, schema/permission/result checks |
| Production cache maintenance | CLI aliases, read-only MCP, long-lived MCP reload, GEX registration/generation and historical/user data preservation passed |
| Node local pipeline | Calculation/SQLite, incremental/idempotent inputs, partial-to-aligned promotion, failure/resume/retry, raw replay/context/windows, 33–366-day summary, gex/bars paging/causal association, expiry selector, evicted exposure regeneration/revision mismatch and cross-process clear fencing passed |
| Chromium fixture | Expiry switch, local revision refresh without navigation, mode controls, observation tabs, Kline/matrix/heatmap, research/chart settings and local ASK AI prompt passed; no remote request/script error |
| Chromium retained real partial input | 29-expiry partial overview rendered; no invented bars or remote traffic; quality-panel layout checked |
| Windows/Mac compilation | Both projects passed; WPF test project compiled with a pre-existing nullable warning |
| Linux self-contained package | Actual linux-x64 archive checked/extracted into a path with spaces; bundled model/replay worked without system Node, tampering rejected; packaged cache maintenance passed |
| Release policy / whitespace | Workflow guard and git diff --check passed |

`bash build/test-headless.sh` was **not green**: it initially caught logging issues
(fixed/retested), and the Avalonia suite had **53 failures / 73 passes**. The common
failure was `Could not create glyphTypeface. Font family: $Default`. A source-only
archive of upstream bf4d77d, without migration changes, reproduced the exact same
NewsSplit failure. This is evidence for that failure's baseline/environment origin,
not proof every failing test has the same cause. Native macOS acceptance is absent.

The full WPF suite was attempted; testhost aborted on Linux because
`Microsoft.WindowsDesktop.App 10.0.0` is unavailable. It did not execute test cases.
Neither cross-build nor Chromium establishes WebView2/WKWebView or code-signing trust.

## Data and performance limits

Actual retained CBOE input: 29 expiries, 10,602 contracts and 84 positive-OI contracts
with zero IV. Source publication is 2026-11-16 04:42:22 UTC (Nov 15 ET), whereas the
raw underlying last-trade field is Nov 13 15:59:59 ET. These are distinct source
fields; the publication timestamp is not shifted to the underlying last trade.
2,262 complete observed two-minute price buckets cover Nov 9–13. No complete
aligned real day was accepted. Original provider bytes and partial computed profiles
remain retained; arbitrary missing candles/IV/history were never invented.

[Measured reports](benchmarks/2026-11-16.json) include environment, input size,
wall time, peak child RSS and limitations. Synthetic five-day/600-snapshot/96,000-
contract workload: cold import 16.1 s / 737 MiB peak RSS; verified repeated imports
1.01–1.11 s / ~471 MiB, original summary query ~80 ms. Earlier repeats without
receipts took 16.6–20.6 s and reached 1.23 GiB. These were single-machine runs with
other tests active, not controlled comparative trials. Cold import/storage/memory
remain bottlenecks. Physical SQLite file ~562 MiB includes retained data and free
pages; the wire logical budget is independently capped at 256 MiB. No VACUUM or
historical deletion is used to make a benchmark look smaller.

Real retained partial input measured 0.67–1.26 s / ~259 MiB before receipt reuse;
this is partial capture/calculation/persistence, not full real history-to-native-UI
performance. Missing original database/blobs prevent representative full real
historical acceptance. The 2026-10-15 discrepancy and missing snapshot remain unverified.

Remaining implementation/acceptance is explicitly listed in README. Full migration,
excellent performance, all query combinations, native platform acceptance and remote
CI success are **not** claimed.
