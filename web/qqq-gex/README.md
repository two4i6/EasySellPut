# QQQ GEX workbench migration (in progress)

Source: option-seller remote **work**, commit
`d60e24b56e308a81723f6c206fb52d22ddc0e9f8`, fetched 2026-11-16.
`source-manifest.json` records 648 byte-preserved source files. Verify with
`python3 tools/qqq-gex/verify-source.py`. Source algorithms remain in `upstream`;
desktop build adapters supply local transport, workers and Next component equivalents.
The importer resolves literal imports, not every SQL/public-asset dependency.

## Local workbench

`npm ci && npm run build && npm run build:runtime` builds the original React
page and original calculation/query engines. Windows/macOS navigation entries
use existing WebView2/WKWebView runtimes. `QqqGexSession` serves embedded assets
and local SQLite from random-port/token loopback HTTP, with host/origin checks,
CSP, bounded clients/deadlines and GET-only access. No remote page or data fallback
is used; missing requests return explicit `LOCAL_CACHE_MISS`. The viewer is a
fixed-date historical view; cached prices are never labelled live. Native bridge
privileges, remote navigation, downloads and popups are disabled.

Visible desktop sessions schedule routed QQQ capture/calculation every two minutes,
using the existing provider selection (including CBOE). Source snapshot, delay,
original CBOE bytes, SHA, receipt time and normalized observations are retained.
All expiry records must agree on source/time/spot/revision. Only consecutive,
closed one-minute observations form two-minute bars. Missing IV/OI, dates, source
coverage or bars stay missing/partial. Source observations survive unsuccessful
page publication. No historical snapshot is synthesized.

SQLite stores exact request variants plus hash-verified local days, original full
profiles, bars, every generated manifest window, provenance and model version.
Imports publish per transaction, preserve earlier captures and reject conflicting
same-time data. Read paths verify hashes/expiry; duplicate query keys reject.
Current derived views expire after 30 days from local publication; retained inputs
can be explicitly rebuilt. This is a freshness policy, not certification that an
imported day is complete. The upstream cache-manager integration is still pending
(see [UPSTREAM-STATUS.md](UPSTREAM-STATUS.md)).

Shared CLI/MCP operations: `capture_qqq_gex_input`, `calculate_qqq_gex_local`,
`get_qqq_gex_replay`, `rebuild_qqq_gex_history`. Input body shape is
`{symbol:"QQQ",source,captures:[{valuationAt,expiry,spot,result}],bars}`.
`expiry` uses epoch seconds; `result` retains original options/quote/receivedAt.
Only actual supplied history is covered. Never import credentials or use test
fixtures as market data. Optional `runtime/collect.mjs` Yahoo-only collection
returned HTTP 401 in this environment; the desktop routed provider path does not
rely on that collector.

## Checks and remaining acceptance

Run `npm run test:pipeline`, the original source tests listed in the CI GEX job,
and `PLAYWRIGHT_BROWSERS_PATH=... node tests/offline-viewer.mjs` (add `QQQ_TEST_DB`
for computed fixture). .NET focused tests cover capture, store and local HTTP.
Screenshots/benchmark JSON under ignored `test-results` are generated evidence,
not imported market archives. CI hooks are local changes; no remote green run is
claimed. Nothing was pushed or deployed.

Incomplete acceptance: original external history/database blobs, >32-day source
daily summaries, live quote mode/SSE, ASK AI integration, exhaustive user journeys
and golden parity, native OS execution/signing, locale/theme integration, upstream
cache-manager reconciliation, and representative real historical end-to-end
performance. Source server code depending on Supabase is not automatically a local
service. The explicit local query adapters cover only the variants described below;
unknown variants remain misses. Current evidence does not establish a complete
migration or outstanding native/platform compatibility.

## Runtime, coverage and validation

The calculation runtime is now shipped as a pinned official **Node 24.22.1**
archive by desktop/CLI packagers. Six platform archives and extracted executable
hashes are recorded in `node-runtime-lock.json`; downloads occur only at build
time from nodejs.org, with pinned archive and executable SHA-256 verification.
At application use, the archive is verified against the embedded lock and only
its exact executable member is extracted atomically into the data directory.
The extracted executable is reverified and invoked by absolute path; no PATH
Node, user installation, runtime download or custom script is used. Archives
remain signed-package data so macOS signing does not change the pinned executable
bytes. Official Node license text is included. Native platform trust validation
is still required; the checks below do not claim Windows/macOS execution.

A Linux x64 self-contained CLI archive was built, checksum/extracted into a path
with spaces and executed with `PATH` pointing to an empty directory. Its bundled
model and replay ran successfully, and tampering with the extracted Node binary
was rejected. General CLI/MCP packaged process smoke also passed. Native CI now
runs this runtime test on every existing CLI architecture and bundled desktop CLI;
the required aggregate gate includes the GEX web job. No remote CI run of these
local changes has occurred.

Local signals/replay now use the original `replayQqqIntradayDirectional` and
validation engine, with repeated fingerprint verification, real pagination and
explicit uncertified day coverage. Local queries are bounded to 32 days/256 MB;
source daily-summary aggregation for larger ranges is not yet migrated. The
viewer supports dynamic same-date inclusive PCS windows up to 90 minutes,
arbitrary context DTE 0–60 (all/volume), and exact two-leg historical quotes whose
capture and source-availability times both satisfy the original five-minute
cutoff. No model quote substitutes for an absent historical quote. Day payload
hashes are checked in direct and runtime reads; legacy day records without hashes
require explicit reimport.

`rebuild_qqq_gex_history` resumes batches of up to 400 retained normalized inputs,
committing each independently. Failures persist and do not block other inputs;
failed records are retried only with `retryFailed`. Inputs are retained before
page publication, deduplicated without overwriting first receipt provenance.
This rebuilds only captured local observations. It does **not** import missing
option-seller database history automatically. Referenced source maintenance blobs
(e.g. `qqq-v4-production-capture-20261013-v1.artifact.json`'s relative payload) are
not present in the cloned repository, and no database export has been supplied.
The earlier 2026-10-15 snapshot discrepancy remains unverified.

The seven-day real provider query returned **2,262** complete 2-minute buckets,
with Yahoo bars dated 2026-11-09 through 2026-11-13. None match the option source
snapshot's ET date (2026-11-15), so `matchingBars=0` and full-page publication is
still rejected. The raw CBOE payload independently confirmed **84** positive-OI
contracts with IV exactly zero. These cannot be repaired from missing information;
no alternative source time, zero-filled IV or fabricated historical candle is
used. Thus real chain-to-complete-page acceptance remains blocked by actual
source timing/input gaps, despite successful calculation-only and synthetic
page tests. Local viewer boot explicitly selects a fixed archived date and labels
it local history, preserving an existing saved date instead of calling it today.

Current focused checks: **49 unchanged source tests / 248 assertions** for the
core model, Gamma, research, direction and wire; a further **58 / 432 assertions**
for Max Pain, VWAP/RVOL, indicators, causal exposure replay, side coverage,
heatmap presentation and archive manifests. Historical resume/failure, dynamic
query and quote tests pass. Catalog parity now covers **49** operations through
CLI and MCP. Cache-management and native platform coverage remain separate risks.


Local desktop capture publications now notify the private loopback viewer instead
of navigating/reloading the WebView. The viewer revalidates the selected historical
display and replay, preserving its document and saved selected date, and includes
newly published dates in the rail. A bounded five-second long poll also detects
commits from independent CLI writers; hidden views stop polling and retry on
visibility. Shared HTTP tests cover notification/revision behavior. Chromium's
computed fixture test covers expiry switching and revision refresh without document
navigation or remote traffic. These are local fixture checks, not native OS or
real complete-day acceptance. Frontend runtime dependency versions now match the
pinned option-seller work commit's lockfile exactly.
