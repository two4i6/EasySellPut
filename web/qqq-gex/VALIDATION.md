# Local validation — 2026-11-16

Tested integration: upstream EasySellPut work `627a875`, local merge `3de30b6`,
plus this migration's local changes. Page/algorithms: option-seller work
`d60e24b56e308a81723f6c206fb52d22ddc0e9f8`. No push or deployment.
Latest read-only upstream check found cbd0c4e; it is not part of these results.

| Check | Actual result |
| --- | --- |
| `python tools/qqq-gex/verify-source.py` | 654 original hashes match |
| Three source-test groups listed in CI, Bun | 153 passed / 845 assertions; unchanged original test files |
| `npm run build`, `npm run build:runtime` | Passed |
| `node test-results/pcs-contract.mjs` | Source OPEN/NOW/READY, inherited BLOCK, stale/misaligned/unknown underlying trade rejection, no remote fallback; canonical signal/lifecycle readonly persistence and corruption checks passed |
| `node tests/local-pipeline.mjs` | Full profiles, atomic import/retry/idempotence, partial recovery, regular/extended split, observed gaps, replay/context/spread/windows, >32-day summary, revision regeneration and clear fencing passed |
| `node tests/import-comparison.mjs <baseline-import> <identical-input>` | Six alternating cold trials; complete row/profile/bar hashes and summary fingerprints identical; sampled source PCS and two manifests equal |
| Chromium `tests/offline-viewer.mjs` with computed pipeline DB and source PCS fixture | Expiry/revision refresh, original tabs/charts/research/settings, local ASK AI, live decision and presentation persistence passed; no script error/remote traffic |
| .NET Core full suite | 199 passed |
| .NET Data full suite | 139 passed / 15 deliberate live-provider skips |
| .NET Analytics full suite | 206 passed |
| .NET Shared full suite | 102 passed, including HTTP preference Origin/CAS/credential/size/reopen checks and no UI-context capture |
| .NET Automation full suite | 73 passed, including capture timeout/caller-cancellation behavior |
| Python guard suite | 54 passed |
| Real process CLI/MCP smoke and capability coverage | Passed; all 52 compiled operations represented with access rules |
| Cache maintenance against final extracted Linux package | Passed; wire cleared, normalized observations/signals/lifecycle/view preferences preserved |
| Windows project/test compilation | Passed with EnableWindowsTargeting, one existing nullable warning |
| Mac project compilation | Passed |
| Full WPF test execution | Aborted before test cases: Linux lacks Microsoft.WindowsDesktop.App 10.0.0 |
| Full Avalonia headless suite | **57 failed / 77 passed**; not green |
| Pure upstream 627a875 NewsSplit test | Failed with the same `$Default` glyphTypeface error; no migration files present |
| Linux x64 self-contained extracted package, path containing spaces | Actual pinned runtime/model/replay worked without system Node; modified extracted binary rejected |
| Source verification / `git diff --check` | Passed |

Avalonia suite totals changed from the previous bf4d77d run because upstream added
tests. Baseline reproduction supports that particular font failure's pre-existing
origin; it does not attribute every one of the 57 failures to fonts. Native
Windows/macOS, ARM64, WebView2/WKWebView, signing and final package GUI acceptance
remain unexecuted in this Linux environment. Footer DataSources smoke selection
was repaired by inspecting its actual command/control; remote CI #92 is not
claimed fixed without native rerun. See [UPSTREAM-STATUS.md](UPSTREAM-STATUS.md).

## Performance and real data

[Comparison report](benchmarks/2026-11-16-comparison.json): exact SHA-256
`5d231d02a166582623723377cc01784d8482b9b2cf812eb6e1d4e82bff56a092`,
8,618,585 bytes, five dates, 600 snapshots, 96,000 contracts and 75 bars.
Node 24.22.1/Linux x64, Xeon 8573C, four visible CPUs. Each run uses a fresh DB;
versions alternate three times. Other verification jobs shared the host.

| Median / retained size | Before (8d33943) | After |
| --- | ---: | ---: |
| Cold import | 12.62 s | 3.63 s |
| Peak child RSS | 780.8 MiB | 454.4 MiB |
| SQLite file | 562.0 MiB | 83.1 MiB |
| Logical derived wire | 248.9 MiB | 23.0 MiB |

CPU profiling implicated repeated archive serialization, hashing and wire
projections, with GC, rather than gamma pricing as the main bottleneck. V2 retains
one copy of full rows, reconstructs original expiry display on demand, keeps a
small hashed context projection and prewarms one canonical overview/all-expiry
archive. It drains stdout before exit so large reconstructed responses are not
truncated. No numeric profile/indicator fields were dropped. The older one-off
16.1 s / 737 MiB report remains in [the original report](benchmarks/2026-11-16.json).
These are synthetic observations, not representative real-history acceptance;
454 MiB still warrants monitoring on large archives. No VACUUM/history deletion.

Fresh real provider capture at 12:10 UTC: all 29 expiries, 2,245 complete observed
2-minute buckets, 43 same-date buckets (premarket), 86 positive-OI missing-IV
contracts. Source publication 11:06:40 UTC; underlying last trade Nov 13 15:59:59 ET.
The archive was retained as partial, with zero published complete dates. Routed
daily QQQ/VIX/VIX3M/VXN inputs were retained. The actual local decision read at
12:45 UTC returned DELAYED, completed close Nov 13, daily/prior-close BLOCK,
INSUFFICIENT_DATA timing, UNAVAILABLE candidate, zero canonical alerts/lifecycle
points. No timestamp shift, missing IV recovery or invented candles occurred.

Real complete historical database/blobs remain unavailable, including the missing
2026-10-15 snapshot; no claimed validation of that historical discrepancy. Original
macro/regime orchestration, lifecycle chart binding, exhaustive dynamic queries
and UI parity, AI inference/desktop theme integration, latest-upstream integration,
native acceptance and real-history performance remain unfinished. Full migration
or excellent performance is not claimed.

Ignored local evidence: `test-results/qqq-computed-fixture.png`,
`test-results/qqq-ask-ai-local.png`, `test-results/computed-viewer.json`,
`test-results/import-comparison.json`. Test fixtures and synthetic benchmarks
never stand in for real complete market data.
