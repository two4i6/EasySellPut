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
| Chromium `tests/offline-viewer.mjs` with computed pipeline DB and source PCS fixture | Expiry/revision refresh, tabs/charts/settings, live decision and presentation persistence passed; no script error/remote traffic |
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
and UI parity, desktop theme integration, latest-upstream integration,
native acceptance and real-history performance remain unfinished. Full migration
or excellent performance is not claimed.

Ignored local evidence: `test-results/qqq-computed-fixture.png`,
`test-results/computed-viewer.json`,
`test-results/import-comparison.json`. Test fixtures and synthetic benchmarks
never stand in for real complete market data.

## Checkpoint 27fe440 — integrated cbd0c4e

This section supersedes older counts/remaining-work descriptions above. The
normalized **v3 day / v7 importer** retains each original full row in an indexed,
hash-verified SQLite table. Day metadata references it; old v1/v2 archives remain
readable. Per-row hashes are pinned by the protected day hash. Selected profiles
are reconstructed without parsing all expiry histories. Original source HTTP
projection, macro feature/HMM/unified pipeline, routed macro inputs, completed-day
alignment, Unified/Overlay selection, live detail/evidence, saved lifecycle display
and historical lifecycle reads are connected. Live factors preserve current/model
observation times separately. Causal directional profile reads have complete and
partial/mixed-version factor-and-decision parity tests. Incremental research and
summaries match a one-shot source calculation. Cache clears preserve indexed rows.

Native theme/motion changes reach the existing document. `get_qqq_gex_lifecycle` adds a read-only date-scoped operation. All
**54** catalog operations have real CLI/MCP cases; Source lifecycle tests raise the
original suite to **155 tests / 854 assertions**. Data **144 pass / 15 live skips**,
Shared **110 pass**, Automation **77 pass**, Core **199 pass**, Analytics **209 pass**,
Python **54 pass**. Local live-display fixture tests cover actual import → source
OPEN/NOW/READY, lifecycle persistence, evidence and research-engine selection.

The actual full WPF suite aborted on Linux (WindowsDesktop runtime missing).
Latest Avalonia headless run: **55 failed / 85 passed**. Pure upstream cbd0c4e
NewsSplit reproduces the same `$Default` glyphTypeface failure; this establishes
only that specific failure's baseline origin, not that all failures are harmless.
Both desktop/test projects compile. No native Mac/Windows/ARM64 acceptance is claimed.

The new [normalized comparison](benchmarks/2026-11-16-normalized-comparison.json)
retains all row/profile/bar/summary fingerprints and matches original projected
PCS plus manifests. The [full-session comparison](benchmarks/2026-11-16-full-session-after-lazy.json)
uses **195 hypothetical times × 29 actual contract-shape expiries**, 5,655 snapshots
and 1,033,695 profile points, in seven isolated batches. It is not real history.
All source row hashes match the eager version. Peak import RSS fell **2,410 → 906
MiB**, total seven-batch import **152.1 → 125.1 s**, metadata **85.1 → 7.05 MB**;
final view query **2.15 s / 21.6 MB**. Physical DB remains **1.62 GB**, exposing
archive-size work still needed rather than proving excellent performance.
[Browser scale evidence](benchmarks/2026-11-16-full-session-browser.json): original
page/canvas rendered in **5.35 s**, matrix/heatmap interactions completed in **10.21 s**,
no script errors/remote traffic, sampled renderer JS heap **61.5/114.0 MB**. This is
Chromium fixture transport, not native WebView or peak renderer OS memory.

New genuine capture: 29 expiries, 2,239 complete observed 2-minute buckets,
98 same-date **premarket** buckets, zero regular buckets and 99 missing-IV contracts.
Publication was Nov 16 13:12:34 UTC; underlying/source alignment remains incomplete.
It was retained as partial, with no complete day published. Macro quote inputs were
incomplete/stale for six symbols; the source macro was explicitly unavailable and
PCS remained BLOCK/UNAVAILABLE. No dates, IV, snapshots or missing historical blobs
were fabricated. Repository metadata has no homepage; deployment lookup returned
HTTP 403 `Resource not accessible by integration`; Personal Context is unavailable
and room search returned no manifest URL. No original historical DB/blob access or
native machine connection was found. Source work is unchanged at d60e24b.

Outstanding: original historical DB/blob migration and the 2026-10-15 discrepancy;
fully exhaustive source UI/query acceptance and out-of-workbench navigation;
complete locale integration and native/trusted-package acceptance. Cache gzip,
smaller budgets, disk-full/crash recovery and reclamation are ongoing local work,
backed up independently and excluded from this checkpoint push until validated.


## Cloud cleanup checkpoint, 2026-11-16

Baseline work@5aa6787 retained upstream shared live quote changes and fresh embedded-asset build inputs. Retired local presentation surfaces and their dedicated loaders/resources are excluded from migration scope. The historical PCS desktop strip and viewer route were removed, while its recorded data and MCP reader remain protected. No user cache/history files were removed.

Dependency-root review retains317 imported files (311 original byte hashes plus6 reproducible presentation patches);339 unreferenced source files were pruned individually. The three production algorithm bundles remain byte-identical in clean before/after builds. Original source155 tests/854 assertions, local import/replay pipeline,45 exposure scope/mode/metric combinations and other kernel parity pass. Cloud empty/computed/live-price flows pass; private-route absence and debug-metadata packaging checks are covered. Core201/Data156/Automation95/Shared120 pass. Official SDK CLI/MCP process checks pass. Windows test assembly cross-build passes; native Windows fixes and Mac native acceptance await CI, not claimed passed.

Measured embedded GEX page assets3,396,995 ->1,646,412 bytes, including exclusion of unused debug build metadata; actual renderable assets decrease41,306 bytes. Vendored source decreases5,479,497 bytes. These figures are not full installer or memory reductions. Runtime/storage and missing-history limitations remain described in MIGRATION-MATRIX.md.

Follow-up on a09036c (2026-11-16, cloud only): Automation102/Shared120 and focused GEX Data11 pass; Windows desktop test cross-build passes (one existing nullable warning). Official SDK CLI/MCP process smoke passed on retry after an initial connection-fixture timeout during overlapping builds. Recovery browser test passed after setting the installed PLAYWRIGHT_BROWSERS_PATH; first attempt lacked that environment. Storage transaction-kill/SQLite FULL/low-space and48 MiB wire-capacity protection checks passed; 401-strike/three-page archive integrity passes.

Expanded original-kernel parity passes on both synthetic fixture and the existing real partial delayed174-snapshot/31,806-strike/9-bar archive: scopes/modes/metrics/empty-single-multiple strike selections, heatmap values/activity/current comparisons, overlays16 combinations, price reactions8 combinations and normalized2m/5m/1d chart series. Fixture also checks viewport label collision at320/1024 px. The available fixture has only two bars, zero reversal markers/observation zones and one observed-low marker; this cannot certify positive cohorts of every marker/band family. Real incomplete source quality remains explicit.

Cloud production follow-up (benchmarks/production-session-followup-20261116.json) exercises actual .NET QqqGexSession + Chromium, date/expiry/panel navigation, browser freeze, offline/online and12-second host pause/resume. No JS errors; six retained replay rows and protected profile digest preserved. Server peak498,120 KiB (~486 MiB), still variable and high; no stable desktop-memory improvement claimed. This is not Mac/Windows native or physical sleep acceptance.

Scenario follow-up additionally passes on the retained real partial sample: 3 expiry scopes ×3 gamma modes ×2 policies, default UI partial parity and forecast-band parity. Source work remote still equals8abee90a at verification.
