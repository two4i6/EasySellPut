# QQQ GEX UI → MCP acceptance matrix

Source: option-seller `work@8abee90a260071cbe9b1519a56548e8bf5a8d18e`. Imported dependency closure: 664 files, zero unresolved imports, hashes verified. Source work advanced from d60e24b in standalone research catalog/loader/dependencies; original page and GEX kernels were unchanged. Old closure and pre-update patch are backed up outside the repository.

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
| Directional research / terminal conditions and labels | display/evidence retained fields | Partial | Full original research presentation/selection-to-MCP numerical mapping not accepted |
| Source delay / missing IV / model versions / partial state | archive snapshot, display/evidence, analysis envelope | Partial acceptance | Preserved per-source/per-row; derived-map provenance and every missing-value explanation need complete audit |
| Cache capacity / health / protected history | get_cache_status | Implemented | CacheManager ownership, clear/compact is WRITE; desktop capture phase is process-local and is not an MCP-process capture claim |
| Theme / chart settings / play speed / saved selection | caller query scope; local presentation preferences | Presentation exception, partial | No desktop window control; persisted GEX view preferences not yet exposed; layout itself is not market analysis |
| ASK AI | explicit prompt preview/copy only | Missing original inference | Original provider chat not migrated; no silent transmission |
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
