# Modular application migration

Approved: 2026-11-17. Target branch: `work`.

Design: [architecture](docs/55-主程序与可独立更新子应用架构研究.md), [CLI/MCP refinement](docs/56-CLI与MCP优先的子应用运行架构.md).

## Delivery rules

- Complete and verify one numbered step, update this file with evidence, commit it, and push it to remote `work` before proceeding to the next step. Use normal pushes; preserve concurrent remote changes.
- Record local checks separately from exact-commit CI. Pending, cancelled, headless, cross-built and native results are different states. Inspect CI and resolve relevant failures; never mark pending CI as passed.
- Keep public CLI/MCP names, schemas, JSON envelopes, errors and permissions compatible. Business logic has one implementation; no desktop dependency in CLI/MCP.
- Reuse existing UI primitives, tokens, market connections, storage and cache boundaries. New UI requires actual screenshots and relevant native checks.
- Keep user data, original financial observations, model provenance, source times and missingness. Default uninstall retains data. Test migrations and rollback before enabling them.
- No main merge, public release, signing bypass, production fixture/trust override or MCP installation tool. Releases remain main-only GitHub Actions with explicit publish.

## First delivery: shared runtime and QQQ GEX

- [x] **S00 — Record the approved plan and research.**
  - [x] Preserve both research reports and bounded CLI/SDK evidence.
  - [x] Fetch and fast-forward to current remote work without overwriting existing work.
  - [x] Define milestones, dependencies and acceptance criteria here.
  - Evidence: initial research at `b863eaa`; implementation starts from `aba21a1`. CI [136](https://github.com/two4i6/EasySellPut/actions/runs/44058368806) and [137](https://github.com/two4i6/EasySellPut/actions/runs/44062146982) passed. Exact baseline [138](https://github.com/two4i6/EasySellPut/actions/runs/44065150143) was queued when this plan was written.
  - Commit: `docs: record approved modular application migration plan`.

- [ ] **S01 — Establish the current regression baseline.** Depends on S00.
  - Verify the remote navigation fix, current GEX changes and complete offline suites on the integrated source.
  - Preserve current CLI/MCP capabilities, read-only enforcement, data reload, cancellation and protocol compatibility.
  - Record exact baseline CI and distinguish any unrelated/infrastructure failure. Fix confirmed regressions without weakening assertions.
  - Acceptance: reproducible baseline, meaningful failure attribution, and local/native evidence linked before changing module ownership.

- [ ] **S02 — Introduce the UI-free operation boundary.** Depends on S01.
  - [x] S02a: immutable catalog snapshot and transport-independent dispatcher; preserve the built-in provider, public contracts and MCP permission filtering.
  - [x] S02b: metadata-only profile resolver and two-stage CLI parsing, including non-mutating legacy discovery. Signed installed-package contributions follow S03–S07; current resolver deliberately exposes only built-ins.
  - Introduce immutable operation definitions/catalog snapshots and a small dispatcher/provider interface in the shared application boundary.
  - Keep existing operations and handlers as the first provider; preserve schemas, ordering and WireJson results.
  - Make CLI help/parsing, MCP discovery/resources and invocation resolve the same catalog and permission policy.
  - Resolve global options and data directory before profile-scoped operation discovery; basic help/version remain available without starting engines or network work.
  - Acceptance: all current operation cases execute through real CLI/MCP; no UI assemblies enter the CLI dependency graph; cancellation/permission/error parity stays intact.

- [ ] **S03 — Define signed module packages and compatibility.** Depends on S02.
  - Define app ID/version, host/engine protocol, supported public contracts, runtime, data format, optional UI and file-table schema.
  - Validate signed manifests, scope/repository, bounded metadata, paths, files/hashes, archive expansion, duplicates/links and compatibility before activation.
  - Reuse established cryptographic/download checks where appropriate; retain separate host-update and app-install state machines.
  - Acceptance: valid core-only package accepted; tampered, wrong-app/source, incompatible and unsafe packages rejected without changing active code or data.

- [ ] **S04 — Implement profile-scoped registry and execution leases.** Depends on S03.
  - Use SnapshotFile revisions and cross-process coordination for installed/preferred/effective versions, enabled state and pending transactions.
  - Separate actual execution/data leases from long-lived MCP diagnostic presence. Validate process identity and generation; reject stale async work.
  - Keep packages immutable and outside macOS signed bundles; code/runtime are not disposable caches.
  - Acceptance: two processes cannot corrupt activation; crashes/expired owners recover safely; an idle MCP process does not permanently lock compatible patches.

- [ ] **S05 — Add explicit local app maintenance.** Depends on S04.
  - Add CLI app list/info/doctor and explicit local install/update/disable/uninstall actions using trusted package identities.
  - Implement staging, verification, durable transaction recovery, activation and deferred cleanup.
  - Preserve default uninstall data, shared caches/runtime and other applications; reject incompatible data rollback.
  - Acceptance: install A → update B → disable/uninstall → reinstall, cancellation and failure recovery in temporary profiles; no installation/maintenance execution tool exposed through MCP.

- [ ] **S06 — Build and load QQQ GEX as an independent package.** Depends on S05.
  - Build current original GEX UI/engine as a versioned artifact, preserving source manifests, algorithms, licences and exact input behavior.
  - Resolve activated assets/scripts from verified packages instead of embedding fresh GEX builds into ordinary host/CLI compilation.
  - Keep optional UI and required core aligned to the same app release; retain verified offline seed behavior if needed.
  - Acceptance: fixed host binary hashes run package A and B without a host rebuild; headless execution needs neither GUI nor system Node. This step alone does not certify full domain independence.

- [ ] **S07 — Move GEX domain ownership behind its module interface.** Depends on S06.
  - Move GEX-specific operation definitions, routing, capture orchestration, data projections and schema ownership out of the generic host boundary.
  - Retain the original model as one implementation; obtain common market/analytics inputs through typed host capabilities.
  - Preserve existing public GEX facades, derived-cache generation fencing, observations/partial/full archives, preferences and workspace provenance.
  - Migrate legacy GEX paths with verified SQLite backups/locks; never delete the mixed archive database as a cache.
  - Acceptance: add a real bounded GEX business operation by changing only the app package; desktop/CLI/MCP use the same handler and original financial semantics.

- [ ] **S08 — Verify MCP catalog changes and compatible app updates.** Depends on S07.
  - Keep stable public operation contracts; pin executing requests rather than implicitly pinning the whole MCP process.
  - Support installed/enabled/compatible module discovery with coherent help, tools/resources and bounded catalog snapshots.
  - Test legacy 2025 modes and current 2026 per-request metadata; use official SDK paths for notification/subscription differences.
  - Keep explicit version handling for breaking contracts and read→write changes; preserve permission checks at invocation.
  - Acceptance: MCP remains running across a compatible GEX update; old requests finish on A, subsequent requests run B; stale discovery and unsupported notifications fail safely.

- [ ] **S09 — Add reusable desktop application hosting and management UI.** Depends on S08.
  - Add a shared module navigation model and platform AppView adapters; preserve native chrome, personal web tabs and article splitting.
  - Reuse cards/selects/help/dialogs/loading, tokens, Lucide and interruptible motion. Keep settings/language/theme in the footer.
  - Support core-only install, optional UI installation, rail visibility, enabled state and actionable update/uninstall states.
  - Keep private application origins/capabilities isolated from articles/personal pages; release only the hidden app's resources.
  - Acceptance: Chinese/English, light/dark, compact/wide and keyboard/reduced-motion journeys with actual 1080p screenshots and native WebView checks.

- [ ] **S10 — Improve scheduling and shared development components.** Depends on verified runtime behavior in S08/S09.
  - Replace the global operation bottleneck only after explicit resource/thread-safety ownership is tested.
  - Bound CPU/provider work, cross-process heavy GEX jobs, queues and outputs; propagate deadline/cancellation without partial-write ambiguity.
  - Add reusable Web SDK/UI/token packages and a separate development host; no production dev/trust bypass.
  - Preserve one desktop QuoteHub and truthful headless bounded sampling; measure before introducing a broker or persistent engine.
  - Acceptance: unrelated pure calculation is not blocked by a slow app read; no unbounded process/memory growth or duplicate desktop market timers.

- [ ] **S11 — Implement independent app CI and main-only release preparation.** Depends on S10 and package/rollback acceptance.
  - Test/package app core independently from host UI; reuse tested artifacts for signing and drafts.
  - Merge host/app capability cases and inventories without weakening exact operation coverage or Required checks.
  - Preserve four desktop/five CLI targets, native extracted-package execution, source/runtime/hash checks and downloadable evidence.
  - Keep app releases out of host Latest; signed app catalog binds exact version/source/hash/compatibility and rejects stale/withdrawn entries.
  - Acceptance: app-only change produces an independently installable app artifact, host updater still reads host releases, and work/PR runs cannot publish.

- [ ] **S12 — Accept the complete GEX pilot.** Depends on S11.
  - Hold host/CLI files and paths fixed; test core-only CLI/MCP, then optional UI, update/uninstall/reinstall, offline recovery and concurrent consumers.
  - Verify all original financial invariants and retained data hashes; distinguish fixture, partial live and complete real-data coverage.
  - Review exact delivered CI and native screenshots. Update engineering/maintenance instructions to describe only implemented behavior.
  - Acceptance: an independently updated GEX is usable through all three entry points without a host release and without unrelated regressions.

## Later business migrations

- [ ] **S13 — Market liquidity.** After S12: reuse existing service/math/provenance; validate the second app needs no duplicated package manager, market connection or UI system.
- [ ] **S14 — News and fundamentals.** After S13: reuse provider routing and native article split; preserve personal pages and WebView trust boundaries.
- [ ] **S15 — Options and strategy as one domain.** After S14: preserve selected contracts, strategy drafts, entry premiums and shared analytics; migrate as one cohesive app.

## Optional follow-ups, after evidence supports them

- [ ] Local broker only if cross-process connection/load measurements justify it; no mandatory daemon for basic CLI/MCP.
- [ ] MCP Apps rendering adapter for small charts/dashboards, with structured/text fallback and real harness checks.
- [ ] Separate distribution/source repositories or independently updated runtimes only after concrete maintenance needs.
- [ ] Third-party modules only with a separately designed and verified security boundary; process separation is not a malicious-code sandbox.

## Execution log

| Step | Status | Commit / push | Verification |
| --- | --- | --- | --- |
| S00 | Completed and pushed | `d07b81f` | Research/plan checks passed; remote work synchronized |
| S01 | Local baseline passed; exact-commit CI pending | This baseline correction commit | 961 .NET tests, 55 Python guards, all 58 real CLI/MCP capability cases, process/cache checks passed; Chromium timeline 4/4 passed. CI [44066016588](https://github.com/two4i6/EasySellPut/actions/runs/44066016588) exposed an animation observation race, corrected without changing product motion or weakening assertions. |

Do not check off later steps based on this document or a scaffold alone. Add completed commit IDs, focused/full checks, screenshots and exact-commit CI links as work proceeds.

### S02a verification

- Automation: 120 passed, including schema lifetime/immutability, duplicate permission shadowing, catalog parity, denied writes and cancellation without data-directory creation.
- All 58 existing operations passed real CLI/MCP capability cases, schema/result/permission parity. Production CLI/MCP process smoke passed, including setup, shared data reload and EOF.
- Existing CI CLI/MCP jobs already execute the complete Automation suite and capability/process checks; no new public operation or permission was introduced, so inventories and schemas are unchanged.
- S01 exact-commit CI remained queued at the last check; no native green result is claimed. S02a is a verified incremental boundary commit, not completion of S02 or package installation.

### S02b verification

Core 207 and Automation 120 passed; all 58 CLI/MCP cases and full production process smoke passed. CLI help with global options before/after the command leaves nonexistent profiles absent; legacy discovery does not move data, while normal startup retains migration. Existing complete CI Core/Automation/process jobs cover these regressions. Actual signed app discovery remains dependent on S03–S07; no installation feature is claimed here.

### S03 package verification checkpoint

Implemented v1 signed package metadata/payload verifier and format notes in `docs/app-runtime-research/package-v1.md`. Full Automation suite: 129 passed. Verification uses pinned production key/repository/RID; only internal test composition supplies fixture trust. Bounds, exact file hashes, compatibility, duplicate metadata, case collisions and unsafe entries are checked before any extraction. Installation/registry/operation contributions remain pending S04–S07, so the whole migration is not accepted by this checkpoint. Existing platform Automation CI covers the new tests.

Baseline reconciliation: CI [44069964453](https://github.com/two4i6/EasySellPut/actions/runs/44069964453) passed at integrated `975576d`, including the S01 correction and S02a. Newer exact-commit CI remains separately tracked; ancestor success is not claimed for unexecuted package changes.

### S04 registry/lease primitive checkpoint

Profile-scoped metadata uses SnapshotFile CAS and monotonic generation, with bounded/validated reads. OS file handles distinguish actual shared execution from exclusive maintenance; idle MCP transports own no app execution lease. Read-only discovery does not create a profile, stale writers are rejected, corrupt metadata is retained, and unsafe IDs do not create paths. Automation: 132 passed. Activation journaling, cross-process CLI integration and execution generation checks remain coupled to S05–S08 and are not claimed complete by these primitives. Existing platform Automation CI runs these tests.

### S05 explicit maintenance checkpoint

Implemented CLI-only list/info/doctor/install/update/enable/disable/uninstall/recover. Signed archives are staged and reverified before immutable placement and registry CAS; incompatible data changes/downgrades are refused. OS leases block maintenance during use. Crash reconciliation never activates uncommitted code or rolls data back. Uninstall retains user data and package backups. Automation 135 passed; complete production CLI/MCP smoke passed, including no-write module discovery and unchanged MCP business catalog. Engine health preflight, actual GEX execution and native final-package acceptance remain S06–S12 dependencies, not claimed by metadata installation.

### S06 independent asset/build checkpoint

Independent signed GEX core/UI packaging now preserves the original source revision, runtime lock and dependency notices. Installed assets are reverified under execution leases; ordinary CLI compilation no longer invokes npm or requires GEX bundles. Explicit package/full-test preparation keeps the compatibility seed. CI adds signed fixture verification, cross-process maintenance and a no-npm/no-bundle host build.

Checks: Core 207, Data 159, Analytics 209, Mac 142 and Automation 136 passed in the full run; Shared initially exposed an unsafe profile inference for standalone temporary databases, corrected and rerun with all 128 passing. All 58 actual CLI/MCP capability cases passed. Temporary-key package signatures/hashes and production-CLI cross-process uninstall exclusion passed. Native delivered-package and fixed-host A/B domain acceptance remain S07–S12 dependencies. No production fixture key or trust override was added.

### S07 signed operation ownership checkpoint

Signed `operations.json` now owns additional app tool schemas and script entrypoints. Discovery starts no engines; CLI help and MCP use the same merged catalog. Packages cannot steal foreign tools or silently change existing schemas/permissions, including read-to-write upgrades. A generic bounded JSON process adapter rechecks the selected version under execution leases, clears Node injection variables, enforces permissions, terminates on cancellation and bounds stdout/stderr. The first independent GEX business operation inventories actual retained published/partial dates and observations without certifying missing historical coverage.

Automation: 143 passed, including signed A/B execution without rebuilding the host, stale version refusal, disable, cancellation and malformed/oversized output. All existing 58 real CLI/MCP capability cases and 55 Python guards passed. The independent package's real GEX summary was exercised against absent/fixture SQLite stores with unchanged database hashes. Existing legacy GEX routing/capture remains a compatibility facade and still needs the full S07 domain migration; this checkpoint is not full pilot acceptance.
