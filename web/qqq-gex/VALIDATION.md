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

Bounded UTF-8 runtime-output follow-up: keep original JsonDocument.Parse + owned clone contract, remove the full UTF-16 stdout intermediary. Same3,831,069-byte latest-display response hashes match in six fresh before/after processes. Median query allocations38,650,728→30,801,184 bytes (~20.3% less), process peak76,840,960→65,662,976 bytes, elapsed1389→1292 ms in three alternating trials. These are limited query-process measurements, not stable whole-app/native memory claims. Reproduce via cloud test harness `--measure-query DATA_DIRECTORY ALLOWLISTED_QUERY`; see benchmarks/runtime-utf8-query-20261116.json.

Final UTF-8+clone cloud regression: Automation102 passed; same protected profile digest, six replay rows, no JS errors, freeze/offline/12-second host pause recovery passed. This repeat measured cold3.37s, warm12.82s first canvas and525,924 KiB server peak. The warm outlier remains unexplained (recorded API responses all200 and below2.1s); earlier runs were1–3s. Do not report stable load-time or whole-server memory improvement from the query allocation reduction. Full report: benchmarks/production-utf8-followup-20261116.json.

Chart/discovery follow-up: source210 pass/1054 assertions/27 files; Automation108 and Shared120 pass. Original positive bottom/top confirmation and zone cases,64 native ribbon selections,32 discovery selections ×3 windows (including positive touch events), original event/track/skew/band series, and a persisted synthetic directional marker all pass. Full chartStudies result matches original full-day-input kernels on the retained real partial sample for3 scopes ×3 presets. Linux packaged runtime without system Node passes2000-filter read-only MCP call (last valid strike retained), original calculation and tamper rejection. Official SDK process smoke passes. These do not establish full real-history or Apple Silicon native acceptance.

Instrumented browser trace: cold/warm/warm-repeat2.24/1.05/1.04s first canvas, six visible rows and protected hashes unchanged, no JS errors, assets local. Deliberate pause produced an event-stream disconnect and recovery; expiry/view changes aborted superseded exposure requests. Earlier12.82s warm outlier remains unreproduced, so slow-load root cause is not declared solved. Peak432,800KiB remains one variable sample; see load-diagnostic-20261116.json.

Entry-point read-only review (requested separately, no removal): cloud switching confirms history→select newest date sets dateMode=follow and reads latest retained PCS display; switching latest sets outerMode=latest, enables quotes/PCS local-decision and localLive=1, with the same six GEX rows. Returning to history sets fixed and hides quote/PCS panels. Current sample localLive response changes view.mode to live and evaluation asOf to current time while model capture remains old; it is not real-time GEX proof. A wiring gap remains: localLive returns directional at top level, while original monitor consumes intraday.directional; don't claim reminder parity or delete the entry as wholly redundant. Evidence: benchmarks/mode-observation-20261116.json.

Directional/entry follow-up: localLive now supplies the original monitor's intraday.directional DTO from the same read-only localDirectional result used by PCS review/MCP. Detail and compact evidence match current/canonicalSignals/storage availability under a fixed fixture clock; repeated reads do not write alerts, closed session cannot promote an actionable alert, and missing alert storage disables availability. local-decision now holds a SQLite read transaction across its constituent reads. No new alert algorithm or history is created.

Cloud Linux Chromium repro (benchmarks/mode-directional-followup-20261116.json) distinguishes initial history fixed, history latest-date selection follow, latest observation follow, reload latest follow, and history-button fixed. All five eventually render the same six retained partial snapshots. History-follow reads retained historical display without localLive; it is not live evaluation. The original hook selectGexDate sets follow before its same-date early return; build.mjs adapts the toolbar mode event. Startup previously forced fixed even with saved latest; startup now honors saved latest only for today's retained date. Both entrances retained. Actual fresh market notification delivery and cloud Apple Silicon package acceptance remain unverified.

This follow-up reran runtime build/live-display, local-pipeline, storage-faults, wire-capacity and Chromium recovery successfully; CloudHost build succeeded. Storage tests preserve unique history. #116 Windows x64 packaged desktop failed dark pixel theme check (1000,400 lightness0.96; no unhandled errors), while the same c184124 code's #117 Windows x64 desktop passed. Root cause is not established. At review time Apple Silicon26/15 jobs remained queued; neither is passed acceptance.

Cloud follow-up after39606fb: two explicit real public-CBOE acquisition/calculation processes retained58 rows across29 expiries at two source cutoffs20:09:45Z/20:13:45Z;171 regular bars, SQLite integrity_check=ok. Capture input was partial (161 then349 missing IV), about15min delayed. Current original directional decision was INSUFFICIENT_DATA with zero saved alerts; no real fresh actionable alert delivery is certified. UI/application-MCP context/evidence/manifest and all exposure-window chunks match, plus9 retained original analysis operations; the spread parity response is empty/stale, not positive quote proof. See benchmarks/fresh-delayed-validation-20261116.json. Historical coverage remains only supplied observations, not an entire session or backfilled historical corpus.

HTTP query serialization now emits UTF8 directly instead of materializing a full raw UTF16 string. Same3,721,734-byte retained real response matches exactly;10 iterations allocate37,217,640 vs111,065,000 bytes (-66.5%), but micro CPU rises296.8 vs189.9ms. Whole-page follow-up cold/warm/repeat2.96/1.49/1.53s and peak523MiB vs prior2.37/1.04/1.65s and542MiB are noisy (after run overlapped a Windows cross-build), not a causal overall speed/RSS improvement claim.8.3MB decoded historical day response remains a bottleneck. Benchmark details in benchmarks/http-query-wire-20261116.json.

CI116 and118 Windows x64 packaged dark-theme failures show the sample landing on a light selected option row, not an unhandled GEX exception. The chain used standard WPF ListView's system selection template; changed to the existing bundled WPF-UI ListView/item template, retaining original row/ATM behavior and original smoke thresholds. Added a selected-row light/dark/light resource/template regression. Windows cross-build passes; Linux cannot execute WPF, so native test/smoke confirmation is pending CI.117 Windows desktops/Mac Intel desktop+CLI/Linux passed at c184124; Apple Silicon15 remained queued.118 at39606fb Web/UI/Windows CLI+ARM desktop/Linux/Mac Intel desktop passed, x64 desktop failed the same pixel check; Apple Silicon26 queued. No canceled/queued task is accepted as passed.

Day-memory follow-up aftera86c18a: retain only day row references and hydrate/hash-check/write one lossless profile at a time within the same SQLite read transaction; decode retained UTF8 directly rather than repeated UTF16 conversion. Temporary output buffers are cleared on return to ArrayPool. No profile/expiry/bar/field removed and no persistent cache/retention change. The real partial day response remains8,307,085 bytes with identical SHA2567406fbc9fcbc41320b5669387f56aa34ee644f3c14d21371a1b56d7caa1f5bcd. Five-read warm allocation68.8→44.3MB (-35.6%), warm median262.6→146.4ms; standalone benchmark peak282→253MiB (GC-dependent; intermediate pool-only157MiB is not final). Same no-concurrent-build page sample cold2159→2027ms, warm2241→1037ms, warm-repeat1045→1126ms, host peak425→405MiB. Small workload samples and warm variance do not establish broad stable speedup or native application RSS. Full historical-corpus scale remains unmeasured.

Process decomposition adds100ms Linux RSS/anonymous/file samples and test-host-only250ms managed/GC counters (no forced GC). Final host peak405MiB, managed sample max222MiB, GC committed max232MiB; file mappings about37MiB. Values are different moments/GC snapshots and cannot be summed. No query child was observed in this canonical-warm flow; browser JS heap41/48/35MiB is not browser OS memory. See benchmarks/day-streaming-memory-20261116.json. Full page tests preserve profile digest,6 visible rows, offline/freeze/host-pause recovery, no JS errors.

CI119/120 Windows desktop native regression failed the newly added selected-row test before its color assertion: hidden handle-only Window did not realize a visual-tree ListView. Test now shows its off-screen cloud test window, resolves the named control, checks actual generated row/template resources, and explicitly deactivates the Options subscription.120 ARM also reported residual SPY in QuoteHubIntegrationTests; cleanup is corrected, but its relation to the failed theme test remains an inference until native rerun. Existing original smoke thresholds remain unchanged. Final local Data156 pass/15 deliberate live skips, Shared121 pass, Windows test cross-build pass; native confirmation still pending. Apple Silicon15/26 jobs remain queued, not passed.

Round closeout at product code72887f1: CI121 Windows x64 and ARM64 native desktop regression159 + packaged-app/updater smoke pass; Windows/Linux/Apple Silicon CLI/MCP pass. Apple Silicon macos26 job133603396016 assigned an actual runner and passed protocol, shared cache preservation, packaged GEX calculation/2000-strike read without system Node and runtime-tamper rejection. CLI artifact14271985710 is90,685,711 bytes with SHA256 f61dd6b25b6f3e474c80f02006d5a00034bebcb20af8816e06a17f9dda0a178b. These package tests use explicit fixtures, not complete live market acceptance. Windows theme smoke downloaded and dark/light pixels inspected; original thresholds untouched, page0.12/0.98, no unhandled errors.

CI121 UI Layout job failed the existing dashboard action test (expectedSPY/actualAAPL) ; the assertion compared a card's mutable CommandParameter again after navigation. The test now captures the clicked symbol before execution and checks navigation against that same value; no production navigation change. Corrected focused1 and complete138 Avalonia headless tests pass with FONTCONFIG_FILE=build/ci-fonts.conf. First local attempt lacked this CI font configuration and failed glyphTypeface; that run is not a product-failure or passing claim. Native Apple Silicon desktop job133603396071 was canceled without execution and is not accepted as passed. A full native GEX user flow and actionable fresh-market notification remain unverified; CBOE delay/IV gaps and missing original history continue to block complete real acceptance.

MIGRATION-MATRIX now reconciles stale follow-up notes and separates verified fixture/partial-real/native subsets, data-blocked real cases, presentation exceptions and explicitly removed features. Retained source work remains8abee90a260071cbe9b1519a56548e8bf5a8d18e. No new observations were fabricated, no histories cleared, and both toolbar entrances retained.

Final CI reconciliation:122 at6af4339 passes the corrected UI/Layout and both native Windows desktop suites/packages; its GEX Web job stopped at check-surface.py because the acceptance matrix literally named a removed AI presentation. The matrix now describes the removed item without reintroducing its retired identifier; the guard itself is unchanged. This is a documentation scan failure, not evidence of a restored runtime.121 Apple Silicon CLI/MCP passed;121/122 Apple Silicon Desktop canceled, and122 Apple Silicon CLI/MCP canceled. Cancellation is not native acceptance. A fresh CI is needed for this corrected documentation commit. Source/runtime algorithms and historical data remain unchanged in this closeout.

Apple Silicon desktop blocking evidence: GitHub check133603396071 annotations report repeated failure to acquire a hosted runner and macOS arm64 capacity constraints. Job metadata has empty runner_name and steps. This establishes a cloud runner acquisition blocker for that canceled job, not an executed product failure; no user computer was accessed. Local closeout reran front-end/runtime builds, surface guard, source hash/dependency checks and directional live-detail/evidence/MCP consistency tests successfully.

CI123 actual failures: Windows x64 native ThemePerformanceTests expected zero redundant palette notifications but observed1; Intel CLI/MCP Data CboeChainCostTests parsed3492 contracts in1534ms, exceeding its original1500ms bound. Web/UI/Windows ARM desktop and other executed CLI checks passed. Apple Silicon desktop check133620014478 annotations explicitly report hosted runner acquisition failure/arm64 capacity limits, not product execution.

Follow-up fixes: ThemeService.Apply now establishes semantic palette/precedence even when the framework theme already matches and emits no Changed event; identical frozen palette reordering does not republish ColorsChanged. Added deterministic stale-semantic + unrelated-dictionary regression, preserving original counts, screenshot thresholds and native suites. CBOE parsing indexes fields per contract and reuses exact timestamps within one request only; no cross-request cache, no data-source/IV/Greek/time substitution. Added duplicate-last-property/numeric-wrapper/missing-next-row/time/source tests. Cost test still asserts3492 contracts and1500ms; its warm-up document is now disposed before timing. Local same3492 sample81→68ms is a single Linux observation, not proof of Mac performance or a stable latency distribution. No GEX algorithm/history/entry changed; native fixes still require the new CI.

Bounded ARM closeout (2026-11-16T22:21Z): CI124 at5ad7f8b completed all non-ARM jobs successfully, including Windows x64/ARM64 native desktop, Intel desktop/CLI, Linux CLI/MCP, Web and UI. Original ARM desktop133636455621 and CLI133636455540 canceled with no runner/steps; both check annotations state repeated hosted runner acquisition failure and macOS arm64 capacity constraints. This is infrastructure evidence, not an executed product result. One targeted rerun of desktop only was accepted (run43963410705 attempt2, job133656214605, macos-26, same5ad7f8b). It remains queued without runner/steps at the recorded time. The CLI row in attempt2 remains canceled; it was not independently retried. No automatic retry loop or additional full-workflow dispatch was added. Earlier macos15 attempts also failed to acquire capacity; no user Mac or unapproved self-hosted machine is used. If this retry cannot acquire a runner, stop this round and resume the same targeted check after hosted capacity recovers, or use a separately authorized cloud Mac. A Linux ARM build or cross-compile cannot replace native macOS GUI acceptance. This documentation-only commit skips CI to avoid launching a new workflow while the original targeted retry is queued; product code remains5ad7f8b.

Remaining data gates: public CBOE observations are about15min delayed and have missing IV (161 then349 in the recorded acquisition); actual source decision was INSUFFICIENT_DATA with zero canonical alerts. Fresh actionable notification/audio delivery is not certified, and source-time replay/fixtures cannot substitute for an actual qualifying market-session event. Original source session/freshness/storage/opt-in/permission gates must remain intact. Actual retained cohorts are one day29 expiries×6 snapshots/9 bars and a separate two-process cohort29×2/171 bars, not a complete session or historical corpus. >32-day/366-day behavior is fixture/bounded transport verification, not complete real-history performance. Existing memory tests and~699MiB/session archive extrapolation are small-sample measurements/models; full-session/multi-day growth, native ARM RSS and long-running scheduler cadence remain unverified. No missing history, IV, bars, signal or notification was synthesized; no unique history or toolbar entrance was removed.


2026-11-17 cloud continuation (test-only; source baseline unchanged): expanded the existing kernel parity runner to compare replay table rows/deltas across every retained cursor and selected/0D/all scopes, and pulse values against the pinned UI preparation path (option observation receipt timestamps, date-scoped spot index, closed-bar prefix, RV/IV and RVOL baseline). Added a separate temporary-database synthetic cohort runner with 22 observations per expiry, two expiries, a continuous opening and an explicit missing-bar variant. Assertions exercise positive RV/OR30, gap-induced nulls, short-window recovery, absent historical volume baseline and first-row/no-future replay behavior. Each cohort is explicitly marked synthetic, not retained real market evidence; it never modifies user caches. The CI Web gate invokes it after the existing kernel parity runner. No source algorithm, application behavior, assertion threshold or retained history was changed.

Original CI124 targeted Apple Silicon retry was checked again: desktop job133656214605 and CLI133656217400 canceled without an assigned runner (no product execution). Existing non-ARM checks were green, aggregate failed; this does not close native ARM acceptance. No user computer was accessed. A complete historical corpus, full-session acquisition/size measurements and an actual fresh qualifying source signal/audio delivery remain external-data/native-runner gates. These are not replaced by the additional fixture tests.

Executed in this cloud checkout: npm ci with a writable temporary cache (initial default-cache attempt failed because /home/agent/.npm was unavailable); frontend build; runtime build; the new two-cohort parity test; PCS contract, live display, SQLite killed-import/FULL/low-space tests, wire capacity, archive pagination, local pipeline, analysis fixture, kernel parity, positive chart and chart projection parity; source hash and removed-surface guards. All final commands passed. Focused .NET Data QqqGex tests:11 passed,0 skipped. No native desktop execution, complete retained-market history, new live capture or genuine actionable alert was performed in this round. No algorithm or product changes were needed for these tested cases.


CI125 and private-session endurance follow-up (2026-11-17): exact commit7d2fc1fea492b52775b841b974005e8a624d191d, run44028392335, all13 jobs success. Apple Silicon desktop133854145247 and CLI/MCP133854145095 actually executed; earlier runner-capacity cancellations no longer block this package/startup subset. Desktop artifact14303424653 (189,593,795 bytes; artifact SHA256 e4db32f5f7a0517c8a87b3c70d2744ac098afc88a4954197d244fbc865aca604), evidence14304362292. This does not certify full native GEX interaction or genuine notification delivery.

New tests/session-soak.mjs drives the production private QqqGexSession in Linux cloud Chromium, with an isolated synthetic database (32 captures,2 expiries,101 strikes/profile,16 bars). Two process generations retain the same preference/database directory. All10 analysis tabs and3 chart modes are repeatedly selected, browser freeze/resume and offline/online are exercised,16 snapshot rows survive each cycle, local-state remains ready/idle with unchanged revision, and lossless row hashes remain unchanged. No JS errors, error boundary or remote browser requests. Screenshots were visually reviewed at1440x1000: chart, controls and retained table render. Extended32 cycles/process passed in88.0s; this is finite stress, not a full trading-session soak or memory-leak proof. Default12 cycles/process also passed. p95ReadAndRenderMs measures HTTP plus table readiness, not backend-only latency. RSS is sampled process RSS, not container peak. CI now builds the private host with its checksum-pinned runtime and runs this bounded smoke, uploading JSON/screenshots with existing evidence.

Cloud checks: focused Shared QqqGex14 tests passed; capability-coverage13 and release-policy13 Python tests passed. Test development corrected a persisted Heatmap/Kline canvas assumption and made table readiness/count atomic; no application algorithm, retained data or acceptance threshold was relaxed.

New actual public acquisition: benchmarks/fresh-delayed-validation-20261117.json. CBOE source cutoff2026-11-17T04:58:10Z,28/28 expiries,212 missing IV,0 missing OI,2248 supplied price bars (195 matching regular-session bars). Both acquisitions returned the same chain cutoff, so retained28 expiry rows represent one source observation, not two or a complete session. SourceMarketAt is null, sourceTimeAligned=false, sourceDelayMinutes=15. Both imports correctly remain partial for2026-11-16 with no complete date published. SQLite integrity_check=ok; isolated database about5.3MB. Actual decision timing INSUFFICIENT_DATA, candidate UNAVAILABLE, macro inputs stale/missing; no genuine qualifying alert was observed/certified. The source option timestamps/IV, full-session chain history and actual qualifying event remain necessary for complete real-market acceptance. No user machine was accessed, no historical gap or quote was synthesized, and nothing was deployed.


CI126 closeout and source/native follow-up (2026-11-17): run44032920858 at81f2b4d7673da9b7094115f4d0b3c7fab3b14798 completed with all13 jobs green, including the new private-session recovery/rendering smoke and all4 native desktop/5 CLI targets. This supersedes the earlier pending status.

Independent live provider audit is recorded in benchmarks/source-and-cloud-observer-20261117.json. CBOE's source root actually reports04:58:10Z publication and previous-day15:59:59 Eastern underlying trade; its zero IV values are genuine raw source values. No timestamp shift or IV inversion was applied. Yahoo earliest-expiry sample has286 contracts versus CBOE348, zero missing IV among returned OI contracts, and previous-close21:00Z embedded underlying time. This cannot certify every expiry, replace absent CBOE contracts, or prove fresh option quote timestamps. Nasdaq lacks source time, IV and OI. The audit found Yahoo GetChainAsync omitted download receipt metadata, causing provenance-aware capture to reject it even when source time existed. It now records actual response receipt separately from AsOf and preserves it across cache hits; regression checks ensure embedded market time/delay are unchanged. All158 offline Data tests pass,0 skipped. Default routing/source algorithms are unchanged; no provider blending was introduced.

Native GEX acceptance extension: the existing platform smoke previously proved only the empty-cache shell. A new test-only probe imports isolated synthetic observations with the checksum-pinned runtime and opens the actual private GEX page in WKWebView/WebView2, exercises3 chart modes/10 tabs, checks8 retained rows and canvas, and reloads the document. Test-only native JavaScript evaluation is limited to its own local page; no production bridge/API was added. Both platform variants compile locally; actual execution is deferred to resulting exact-commit native CI and must not be counted passed before those jobs finish.

New tests/cloud-market-session.mjs is an explicit MEILI_LIVE=1 cloud acceptance harness: bounded9h window,2-minute serial capture/calculation cadence using existing routed providers and original bundled kernels, private browser live view, read-only decision/canonical signal observation, real AudioContext/Notification call observation, screenshot/JSONL evidence,512MiB directory bound and256MiB free-space reserve. It stops without evicting unique history. A65s actual cloud run passed, one source cutoff, no JS errors, no canonical signals or notifications. Full-session and delivery flags remain false pending independent evidence review; enabling sound is only a test tone, and API calls do not prove audible/native OS delivery. No scheduling/deployment was added. GitHub-hosted job time limits cannot cover a6.5h session in one job; a persistent cloud process is required, and environment suspension interrupts it. Existing provider omissions remain explicit even if the observer runs the entire session.


MCP-first follow-up: paused the waiting full-session cloud process at2026-11-17T07:05:54Z, before any capture (0 samples), to follow owner priority. CI127 atc631aa55959058df5d2087ae2e9ff0897e0839e7 failed both Mac desktop native probes at populated snapshot table; Windows native probes and other checks passed. The timeout logs and injection immediately after Navigate suggest an initial-document race: WKWebView can still be on its initial document and discard that polling on commit. This remains an explanation to verify with the native rerun, not a confirmed product diagnosis. The probe now waits for the actual populated local document title before DOM polling (and after reload); no assertion or product algorithm was weakened. Exact-commit native revalidation is required.

MCP gaps corrected: original wall-touch filtering/histogram/table projection and reference-incomplete suppression; workspace persisted settings/observed analytical selections and timestamped native capture/quote/storage/palette state; partial-only metadata and lossless archive access; original provider index/raw bytes without arbitrary paths; spread full original option-observation preparation/spot-at-cutoff and desktop-equivalent historical two-leg fallback. The source wall projection is extracted at build time from the pinned UI rather than maintaining a second business algorithm. UI observation adapters leave pinned originals untouched and use the existing bounded preference bridge. Workspace/provider/partial MCP reads do not record market observations or start monitors.

Executed final local checks: Data158, Shared121 and Automation115 tests passed with0 skipped; actual CLI+MCP capability coverage58 operations passed using the rebuilt Debug protocol test host (initial attempts used the production CLI or stale Release host and correctly failed fixture expectations; no product fix was inferred). UI/private-session test with application workspace read passed2 processes×12 cycles, no browser errors/remote requests, history hashes unchanged.192 original wall filter combinations and48 positive synthetic spread cases pass; provider index and partial-only pagination/revision/integrity checks pass. Existing PCS/live-display/lifecycle/archive/pipeline/kernel/pulse/chart suites were rerun; see current command outcomes. Source hash and retired-surface guards remain unchanged. Broad real historical and executable quote cohorts, exact-commit native CI, genuine notifications and ephemeral pointer/focus state remain unverified; no merge/deployment/user computer access occurred.

Actual retained-data follow-up: benchmarks/mcp-partial-actual-20261117.json records application operation reads of the real retained CBOE partial day2026-11-16:28 expiry snapshots, first expiry174 lossless strikes, sourceTimeAligned=false, one original provider body with matching SHA on raw-byte chunk. These reads required no desktop session or new fetch and did not promote the partial date. Provider/partial data absence remains explicit.

Final private-session run after workspace changes passed24 cycles/2 processes in25.45s, retaining all16 displayed rows and unchanged history hashes. The workspace assertion now waits until browser preference JSON equals persisted native JSON and compares the actual scope/cursor rather than assuming selected: restored matrix mode may legitimately produce all scope. No scope behavior was changed to satisfy the test. Native pointer/focus state is still not certified/readable; this is explicitly retained as an open boundary, not a waived exception.

CI128 at a06fe02c97dc1c8f3beb003bf0e15f3001ae272a: Web passed, overall failed. CLI/MCP jobs hit Core NoSilentCatchTests for the workspace unavailable-state catch (functional Data/Analytics/Shared/Automation suites passed); added sanitized warning and full Core201 tests now pass. Native populated probes also failed: the newly required exact title was incorrect because historical bootstrap legitimately sets `QQQ GEX · <date> · 本地历史` without requiring a PCS request. Replaced that incorrect title condition with committed local-document identity and retained actual8-row/canvas/tab assertions; added native activation and bounded DOM/fetch/resource diagnostics. This is not accepted as native pass until exact-commit rerun.

Screenshot review found an existing preference bridge permanently blocked after a transient offline event, newly exposed by frequent observed-selection updates. The bridge now pauses offline, retries transient failures at bounded cadence, reconciles a lost committed response against the full known preference map before adopting a revision, and still blocks real concurrent changes without overwriting drafts. Real Chromium tests cover offline/503/lost acknowledgment/external409 conflict, preserving external values and local draft. Private-session recovery now rejects the permanent save-failure UI and passed24 cycles/2processes after the fix. No historical or analytical source data was changed.

CI129 atb87df0b: Web passed; Apple Silicon native log explicitly passed the populated GEX3-mode/10-tab/canvas/reload test. Its subsequent unrelated menu-bar probe failed at Single(screen match) on an unshown Window. The test now shows its native probe window and waits for nonzero AppKit display registration plus the same exact CGDirectDisplayID match before retaining all anchor-coordinate assertions. No primary-display fallback or skipped assertion was introduced. Exact-commit CI remains necessary.


Accepted code closeout (2026-11-17): product commitfe95f121bd28c144ce8f1956c7d3f677cfebcc6b passed CI130 run44045554607, all13 jobs including CI Required checks. All5 CLI/MCP targets and4 native desktop targets actually executed successfully; populated GEX3-mode/10-tab/canvas/reload, native status display-registration assertions, extracted packages, bundled runtime/tamper, updater and Web/UI checks are green. CI128/129 were not counted passed. This documentation-only closeout changes no product code and cites that unchanged code result; any new documentation-only CI is not retrospectively called passed.

MCP read additions are covered by the matrix: workspace preferences/decoded analytical selections/last desktop state; native partial-capture projection and separately paginated partial archive; indexed immutable original provider bytes; original wall-touch filters/qualified missingness/histogram/table; original spread observation preparation/spot/fallback. Functional checks passed, while full real historical corpus, genuinely qualifying alerts/audible/native OS delivery, all visual/native journeys, instantaneous pointer/focus state and full-session storage/memory/latency remain explicitly unchecked. The live whole-session collector remains paused with0 samples to honor MCP-first priority. No release, deployment, merge or user-computer operation occurred.


Interaction follow-up integrates remote work@b863eaa (including live overnight charts) before changes. CI132/run44048381348 atthat commit failed only UI Layout & Charts: Selected_actions_group_keyboard_and_hidden_fields_keep_the_same_state checked navigation before queued dispatcher/bindings settled (SPY expected/AAPL observed). The test retains the captured clicked symbol and exact page/context assertions and uses its existing async Settle helper after command dispatch; full142 headless tests pass with build/ci-fonts.conf. No production navigation algorithm changed.

Local interaction checks:117 Automation tests and142 font-configured headless UI tests passed, zero skipped. Real Chromium observer fixture passed input redaction, source-shaped hover/tooltips, focus/control state, lifecycle clearing and explicit size bound. Native probe additions must pass exact-commit hosted native CI before acceptance. Initial compile attempts caught incorrect test-only palette property/namespace and were corrected; synthetic DOM mouse dispatch failed to activate the chart and was removed rather than certified. Actual Chromium pointer hover remains tested against the original renderer payload and application MCP read. Full-session/history/real-alert and physical native-input TODOs remain open; no deployment or merge.

Final local private-session run passed24 cycles/2processes in27.41s,16 retained rows, actual pointer hover and focus→application MCP equality, no browser errors/remote requests and unchanged history hashes. Screenshots reviewed show the source K-line tooltip with timestamp, price, VWAP/GEX and native-data missingness; this is synthetic input, not real-market acceptance. Mac and Windows native probe cross-builds both passed with0 warnings/errors; executing those probes still requires hosted native CI. Source verifier316 unchanged/6 reviewed patches and retired-surface guard passed.

CI133 at89c7d02: UI Layout & Charts passed, confirming the CI132 navigation-test fix. Web failed the new exact hover equality: a cursor time can stay constant while asynchronously loaded GEX/walls replace null. Test now waits for the complete source payload, preserving exact equality. Windows native probes failed all-expiry observation even though the diagnostic UI had rendered2-expiry rows with no JS errors; local selection observation used a cleanup-canceled300ms debounce that can starve under repeated renders. The build observer now writes only semantically changed state after commit (the native bridge remains bounded/coalesced), avoiding cancellable per-render timers and unchanged-state writes. Invalid old observer JSON no longer blocks replacement. Native rerun is required to verify this explanation/fix. Local expanded scope/hover/focus/recovery run passed24 cycles/2processes in25.57s. The official-SDK read-only MCP stdio process also returned the exact isolated interaction fixture and validSHA without modifying preferences or creating a market DB. CI133 is not an accepted run.

CI134 ataccdda9: Web passed the full original suite and expanded private-session hover/scope/MCP assertions. Windows x64 native still timed out at all-expiry observation, so debounce starvation is not an established explanation for that native failure. Native probe now waits across activation paints before sending a scope change (source mode activation resets preferredScope in a passive effect), retaining exact scope assertions; diagnostics also record actual select values and persisted observer JSON. This is a synchronization hypothesis awaiting exact native rerun, not a certified product fix. Desktop capability inventory now explicitly maps these read-only GEX observations rather than treating them as waived presentation-only data.

CI135 at0fa00e4 identified the actual Windows gap: native select value was all but observedExposure was null. The esbuild observer adapter matched slash paths only, silently bypassing all Windows backslash paths; the chart observer also required LF-only anchors. Adapter now normalizes in-memory paths and CRLF before strict source matching. New regression transforms the actual4 pinned components using Windows/Unix conventions, requires byte-identical instrumented TSX and compiles both; passed locally. Source files/kernels remain untouched. This supersedes the earlier debounce/activation hypotheses for the Windows absence.

CI135 Web revealed another asynchronous observation race: waiting for a fixed whole hover payload can wait forever if it gains GEX/walls before publication. The test now waits for a coherent complete renderer/browser/native/application snapshot, retries changed observations and retains exact full JSON equality, SHA/revision semantics and explicit failure bounds. No numeric assertion was removed.


CI136 at a64ae9faf4217610c82137379f7e0a517c08761c completed all13 jobs successfully, including both previously queued Apple Silicon jobs and Required checks. Actual native logs passed3modes/10tabs, focus→MCP, scope changes, light/dark, compact/wide, hide/show/reload and packaged2000-strike read/tamper checks. No release/merge/deployment occurred.

New heatmap inspection extension: cloud Chromium passed24cycles/2processes in41.36s, exact original raw inspector→application workspace comparisons for Home/End/ArrowLeft/ArrowUp/Escape and pointer, historical/scenario provenance, unchanged history hashes and no JS errors/remote requests. Initial ArrowDown assertion targeted the lowest strike where the source correctly stays at its boundary; test now exercises ArrowUp and retains strict movement/time/strike assertions. Fixture tests passed null/missing-IV semantics, hidden-state clearing, tooltip omission counts, bounded overflow, redaction and same-observation retry after a simulated transient storage failure. Both native probe variants cross-built with0 warnings/errors; an initial concurrent Mac/Windows restore raced on shared obj assets, and the Mac build passed after a sequential rerun. New exact-commit native keyboard execution is pending CI, not inferred from CI136. Scenario screenshot review found an original overlay-label/inspection overlap, explicitly retained as a renderer TODO.
