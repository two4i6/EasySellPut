# QQQ GEX UI → MCP acceptance matrix

Source: option-seller `work@8abee90a260071cbe9b1519a56548e8bf5a8d18e`. Current dependency closure: 317 files, zero unresolved imports; 311 originals and 6 reviewed local presentation patches. Source work advanced from d60e24b in standalone research catalog/loader/dependencies; GEX kernels were unchanged; local presentation reductions are separately recorded. Old closure and pre-update patch are backed up outside the repository.

**Overall status: incomplete.** Full coverage is a completion gate; source import, compilation, or a smoke call cannot satisfy it. “Implemented” below is a local implementation state, not proof the installed client has received it. Read tools never capture remote observations. All results preserve or explicitly disclose retained-only coverage; transport SHA/revision verification does not certify complete historical inputs.

| UI capability / data | MCP mapping | Implementation | Verification and remaining gate |
|---|---|---|---|
| Date discovery | get_qqq_gex_archive resource=dates | Implemented | Bounded 50,000-date index, page <=200, mandatory continuation revision; fixture checked |
| All expiry/snapshot metadata | archive snapshots, date/expiry | Implemented | Retained source times, causal timing, quality/version preserved; real sample 29 expiries ×6 observations |
| Complete per-strike profiles | archive profile, exact capturedAt/expiry | Implemented | 401 points over 3 pages byte/value lossless incl null IV/nested fields; corrupt rows and revision change rejected |
| Real 2-minute candles | archive bars | Implemented | Source-aligned complete adjacent minute buckets only; no invented missing buckets; real sample has only 9 bars |
| PCS display / overview / expiry | get_qqq_gex_view display | Implemented | Fixed latest or <=90-minute window, no arbitrary URL; complete variant matrix not accepted |
| Display evidence | view evidence | Implemented | Actual desktop HTTP/application MCP JSON parity on retained sample |
| Exposure manifest | view exposureManifest | Implemented | Date + optional expiry only; rejects from/to/source; HTTP parity passed |
| Full exposure windows | view exposureWindow | Implemented | Exact manifest from/to/source, <=1 hour; 505,588 bytes reassembled across chunks match desktop NDJSON exactly; closing manifest reread is caller responsibility |
| Context / DTE / 20 previous trading days | view context | Implemented | HTTP parity; missing dates and uncertified reference explicit; `at` fixes response timestamp for chunk consistency |
| Historical two-leg quote | view spreadQuote | Implemented | HTTP parity; date/expiry/cutoff/legs; no model quote substitution |
| GEX/Gamma/Delta/Charm, call/put modes | view analysis=exposure | Implemented | 3 expiry scopes ×5 modes ×3 metrics numerically equal original UI kernels on fixture; real incomplete inputs remain partial |
| Strike distribution / OI / volume / comparison windows / concentration | analysis exposure, metric and strikes | Implemented, partial acceptance | Original functions reused; modes/scopes/metrics parity; exhaustive selected-strike/filter boundaries pending |
| Heatmap cell history / activity | analysis heatmapField | Implemented | All cells returned with frame identity/time, no truncation; kernel route fixture passes; rendered-cell equivalence pending |
| Aggregate repricing across available expiries | original prepareAggregateGammaFrames used for all scope | Implemented | Numeric scope parity passed; broad heterogeneous real-data acceptance pending |
| Gamma map / volatility trigger | analysis gammaModel | Implemented, partial acceptance | Original observation-only quality filter + model; route tested; independent complete golden dataset pending |
| Snapshot table / common-strike deltas / cursor | analysis replayTable + at | Implemented, partial acceptance | Original table/delta functions, causal frame required; before-cursor behavior; all cursor/filter interactions pending |
| Chart projection / matrix expiry columns | analysis chart | Implemented, partial acceptance | Original preparation and projection functions; fixture route tested; every marker/overlay/rendered series equivalence pending |
| VWAP / delta / ATM IV / put-call overlays | analysis overlays | Implemented | Original series; numerical parity for 3 expiry scopes on fixture; all UI toggles pending |
| Structure events / skew / expected bands | analysis structureEvents | Implemented | Original discovery series; numerical scope parity fixture passed; all event cohorts and presentation selections pending |
| Activity and rehedging response | analysis activityResponse, minutes=2/10/30 | Implemented | Original full series and window; numerical parity passed; observed activity never labeled directional order flow |
| ATM IV history and change | analysis atmIv | Implemented | Raw OI-provenance frames retained; numerical fixture parity; real missing IV remains null |
| Max Pain history | analysis maxPain | Implemented | Original double-sided OI requirements; fixture parity; no zero fill |
| Intraday pulse / RV-IV / VWAP bands / OR30 / RVOL | analysis pulse + context | Implemented, partial acceptance | Original kernels and retained reference baseline; route tested; full-day/cutoff numerical acceptance still pending |
| Prior-day wall-touch statistics | analysis wallTouches | Implemented, partial acceptance | Original events/summary, missing reference dates explicit; route tested, full horizon golden dataset pending |
| Frozen inventory day/time scenario | analysis dayScenario | Implemented | Original typed-array field serialized as arrays; numerical scope parity on fixture; real sample lacking valid price yields original unavailable reason |
| Spread study / IV shock / fees / manual credit | analysis spreadStudy | Implemented, partial acceptance | Original kernel; missing-leg test rejects invented quote; valid executable-basis numerical dataset pending |
| Directional replay / >32-day summary | get_qqq_gex_replay | Implemented, partial acceptance | <=366 days, page<=200; long ranges exclude uncertified days; complete real historical corpus missing |
| Recorded lifecycle | get_qqq_gex_lifecycle | Implemented | Date scoped, <=1,000 retained points, hash checked; no reconstructed historical points |
| Daily/previous-close eligibility / macro regime / timing / candidate | get_qqq_gex_live_decision | Implemented | Source contract fixtures, unified/overlay; stale/delayed/misaligned inputs cannot qualify as realtime |
| Source delay / missing IV / model versions / partial state | archive snapshot, display/evidence, analysis envelope | Partial acceptance | Preserved per-source/per-row; derived-map provenance and every missing-value explanation need complete audit |
| Cache capacity / health / protected history | get_cache_status | Implemented | CacheManager ownership, clear/compact is WRITE; desktop capture phase is process-local and is not an MCP-process capture claim |
| Theme / chart settings / play speed / saved selection | caller query scope; local presentation preferences | Presentation exception, partial | No desktop window control; persisted GEX view preferences not yet exposed; layout itself is not market analysis |
| Raw provider and normalized observation bytes | Stored locally, no arbitrary file MCP API | Not exposed | UI does not display raw files, but archival export/read access remains a separate missing capability |

## Transport and permission contract

`get_qqq_gex_archive`: dates/snapshots/profile/bars, max 200 items per page. Page >1 requires first revision; revision_changed means restart at page 1. Full profile points preserve absent/null/zero and source row SHA, never compact backtest rows.

`get_qqq_gex_view`: display/evidence/context/exposureManifest/exposureWindow/spreadQuote/analysis. Exact JSON/NDJSON bytes, base64 chunks default 64 KiB, max256 KiB. Continuation needs first SHA256 and nextOffset; changed content rejects mixed chunks. Decode all chunks, verify full SHA, then parse. Context requires caller `at` to freeze response timestamp, not to backdate data. Exposure callers fetch every window then reread manifest. Large analysis requests currently recompute for every chunk; derived-response reuse/performance needs further work.

Analysis uses the pinned original functions, never a parallel formula implementation. Maps serialize to entry arrays, typed arrays to arrays, non-finite values to null. `complete=false` explicitly declines to certify a complete historical corpus; inspect individual row quality, gaps and model metadata.

Default read-only MCP advertises/permits the read tools. capture_qqq_gex_input, calculate_qqq_gex_local, rebuild_qqq_gex_history and clear_cache remain explicit write operations requiring --allow-writes. Reading analytical runtime resources may create derived runtime extraction files, but never new observed market history.

## Acceptance evidence and unresolved failures

Cloud tests: Core199, Data151, Shared116, Automation86; source155 (110+45); pinned PCS contract and local pipeline; recovery-boundary privacy/automatic-retry bounds; official SDK CLI/MCP process handshake/discovery/read/write permissions. Windows cross-build passed, Mac focused headless3 passed. These are not full native user acceptance.

CI #107 at6233660: Windows x64/ARM64 CLI/MCP pass, Linux and Intel CLI/MCP pass, Intel/Apple Silicon/Windows ARM Desktop pass; Apple Silicon CLI/MCP canceled. Windows x64 Desktop failed its native OptionsPage dark-theme screenshot assertion (background lightness0.96 at1000,400), not a GEX tool failure. Current newer phase still needs CI/native validation.

Actual delayed sample: 174 expiry snapshots,31,806 strike points; six replay rows retained after browser freeze, offline/online and 12-second service SIGSTOP/SIGCONT. Protected profile digest unchanged. No physical Mac sleep test. The screenshot's original React exception stack is unavailable; new whitelisted type/category/asset-coordinate diagnostics and bounded/manual view recovery do not establish its original cause.

Performance is unresolved: repeated production-session peaks varied from about533 MiB to814 MiB despite a first apparent32% reduction. One later owned-document test measured526 MiB. Do not claim a stable reduction. Cold/warm first canvas roughly1.5–2.2 seconds on this small cloud sample, not native Mac/full-day acceptance. Report source revision and current host build for each run.

Storage: same six real observations,155.4 MiB database ->69.8 MiB losslessly compressed with warm wire ->21.9 MiB after clearing regenerable wire and compaction; protected decoded digests unchanged. Runtime adds~122 MiB on Linux. Wire soft target48 MiB/hard logical cap64 MiB; unique archive warning1 GiB, never automatic history eviction. Simple195-observation/day extrapolation~0.7 GiB/day is not an actual full-day benchmark or protected-history size cap. See STORAGE.md.

Read consistency follow-up: day and spread reads now share one SQLite read transaction across metadata/profile hydration. Concurrent test passes 50 atomic replacements and 100 reads, each revision matching its profile. Owned JsonDocument lifetime avoids duplicate full-profile clones. Windows #107 evidence archive download returned HTTP403 from artifact storage, so its failed screenshot pixels could not be inspected; log evidence alone does not establish a theme root cause.

Local presentation scope follows the latest user instruction: the right-side historical validation tab and its dedicated rendering/loading resources are excluded. Shared calculations, historical summaries and MCP-accessible metrics remain retained. The source checkout is unchanged. Reproduce and verify reviewed presentation patches with tools/qqq-gex/verify-source.py --upstream <read-only-source-checkout>. Retired surfaces are not migration backlog.

## Inherited-source inventory before authorized pruning

Full 656-path inventory with dependency evidence and limitations: benchmarks/source-inventory-20261116.json. Source total8,536,989 bytes; current emitted browser outputs1,621,231 bytes. Already authorized presentation removal reduced source by75,997 bytes and removed12 development packages; that is not a measured installer/RSS saving.

| Category | Concrete paths | Dependency / deletion risk | Measured source size / benefit |
|---|---|---|---|
| Keep algorithms/data | upstream/src/lib/qqqGexCalculation.ts, qqqExposureWorkbench.ts, qqqMaxPain.ts, qqqIntradayDirectionalSummary.ts, engines/analysis/QqqGexResearch.ts; runtime/, Data/Cache and CacheManager | Desktop and MCP use these same calculations and retained metadata; a Research filename does not mean a removable view | Algorithms/engines source5,049,164 bytes as a broad group; not a deletion budget |
| Keep extraction inputs despite server-shaped names | upstream/src/app/api/analysis/qqq/pcs/route.ts; upstream/src/services/orchestrators/macroDataService.ts | source-pcs.mjs/source-macro.mjs extract pure rules; whole-file deletion breaks build or semantics | PCS route148,471 bytes; no safe whole-file saving |
| Hosted boundary candidates, review only | upstream/src/lib/{supabase.ts,supabaseCachedFetch.ts,embeddedRedisCache.ts}; lib/backtest-scripts/{standalone-auth-v1.ts,standalone-jobs-v3.ts}; other original app/api routes | Remote DB/Redis/job bearer service is not local desktop security. Current browser output excludes those packages. Review import/extraction boundary before authorized removal | Five named DB/cache/job/auth files27,881 bytes; routes other than PCS23,259 bytes; no promised installer benefit |
| Remote adapter candidates, review only | upstream/src/services/adapters/{apiManager.ts,yahooFinance.ts,yahooFinanceServer.ts} | Native routed providers/QuoteHub replace their I/O; macro extraction still reads original source. Never remove YahooQuoteStream/LiveBarStitcher in native code | See per-file JSON; no deletion performed |
| Non-emitted backtest/provenance support, requires audit | upstream/src/lib/backtest-scripts/, upstream/scripts/research/; engines/leveraged-overlay/{v2/overlay-runner.ts,v2/backtest/day-loop.ts,artifacts/slow-subregime-sr-v1.json} | Current outputs omit these large files, but historical strategy/calibration parity may require them; do not delete based on directory name | Backtest scripts1,285,046 bytes, research scripts181,448; three large files2,152,694 bytes, overlapping groups; not additive |
| Shared local runtime/security, keep | runtime/node-lock.json, build/bundle-qqq-runtime.py, QqqGexCalculationRunner, QqqGexSession token/Origin/CSP checks | Node runs GEX algorithms independently of retired UI; localhost isolation is required even when hosted login is unnecessary | Bundled runtime/package measurements separate; no removal |
| Visible features requiring a product decision | monitor/conditions; pulse/spread/wall-touch/ATM IV/Max Pain panels | Beyond the two explicitly retired surfaces. They contain requested indicators or saved observations; no deletion authorized | UI space rather than significant package bytes; measure before optional consolidation |

No hosted login page, entire Next deployment, .env credentials, or remote database content was imported as an application feature. Original route/auth source provenance is distinct from an enabled hosted service. The next section records the subsequently authorized, dependency-proven cleanup.

## Authorized cleanup and retained dependencies

Integrated baseline: work@5aa6787, preserving the upstream fresh-asset build target,1080p test viewport and shared native live prices. The three retired local presentation surfaces are no longer migration backlog. The historical PCS strip, its historyDate/historyLifecycle state, date bridge, request and test fixture handler were removed. Its private desktop HTTP route now returns404. No unique historical records were deleted.

Retained because still used: QqqIntradayLifecycle for the live PCS detail view; QqqGexResponseStore.ReadLifecycle and qqq_gex_pcs_lifecycle for get_qqq_gex_lifecycle; original Greek/GEX/replay/research-metric kernels and CacheManager preservation. There was no strip-specific stylesheet rule; generic details styles remain needed by other panels. The other native/shared AI client connection features are untouched.

The conservative browser/runtime/build/test dependency graph retained317 source files and identified339 unused files. Those files were removed individually using the reviewed selection, including unused original Web routes, hosted job/auth code and unreachable backtest/calibration support. Every still-referenced algorithm and all22 original source test roots remain. Supabase/Redis stay as development dependencies because original tests still reference them. One dynamic import is the explicitly reviewed generated temporary test bundle; no upstream dynamic dependency remains unresolved. tools/qqq-gex/source-selection.json makes the retained set reproducible, and its canonical JSON digest is independent of line endings.

Measured clean before/after builds: imported source8,612,986 ->3,133,489 bytes; renderable page assets1,687,718 ->1,646,412 bytes. Excluding the unused debug build metadata from embedded resources changes embedded GEX assets3,396,995 ->1,646,412 bytes. This is not an installer/RSS measurement. Crucially, import.mjs/query.mjs/history.mjs are byte-identical before and after cleanup with matching build dependencies. See benchmarks/cleanup-size-20261116.json.

Source155/854 assertions, full local pipeline,14 kernel routes plus spread missing-leg checks,45 exposure scope/mode/metric combinations and other original-kernel parity pass after pruning. Cloud fixture and actual-data flows still require final phase verification/CI. Current historical archives and cache size limits are unchanged.

CI112 at5aa6787: Windows freshness test expected an old text suffix although the new label adds transport; another x64 stale test saw the401 tick left by the live UI test in the shared hub. Test changes now check delay/transport/no-false-realtime semantics and isolate the injected tick under a dedicated symbol. These Windows fixes are cross-built locally; native execution is pending CI, not claimed passed.
