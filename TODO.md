# Modular application migration

Approved: 2026-11-17. Target branch: `work`.

Current releases (2026-11-18): three desktops (Windows x64, macOS Intel/Apple Silicon), four CLI/app CI targets (plus Linux x64). Dated acceptance logs below describe their original revision, not the current support matrix.

Design: [architecture](docs/55-主程序与可独立更新子应用架构研究.md), [CLI/MCP refinement](docs/56-CLI与MCP优先的子应用运行架构.md).

## Delivery rules

- Complete and verify one numbered step, update this file with evidence, commit it, and push it to remote `work` before proceeding to the next step. Use normal pushes; preserve concurrent remote changes.
- Record local checks separately from exact-commit CI. Pending, cancelled, headless, cross-built and native results are different states. Inspect CI and resolve relevant failures; never mark pending CI as passed.
- Keep public CLI/MCP names, schemas, JSON envelopes, errors and permissions compatible. Business logic has one implementation; no desktop dependency in CLI/MCP.
- Reuse existing UI primitives, tokens, market connections, storage and cache boundaries. New UI requires actual screenshots and relevant native checks.
- Keep user data, original financial observations, model provenance, source times and missingness. Default uninstall retains data. Test migrations and rollback before enabling them.
- No main merge, public release, production fixture/trust override or MCP installation tool without instruction. Releases use main-only GitHub Actions, version-gated automatic promotion and explicit repository switches. OS publisher signing is currently deferred by user instruction; update/app signatures and native package checks remain mandatory.

## First delivery: shared runtime and QQQ GEX

- [x] **S00 — Record the approved plan and research.**
  - [x] Preserve both research reports and bounded CLI/SDK evidence.
  - [x] Fetch and fast-forward to current remote work without overwriting existing work.
  - [x] Define milestones, dependencies and acceptance criteria here.
  - Evidence: initial research at `b863eaa`; implementation starts from `aba21a1`. CI [136](https://github.com/two4i6/EasySellPut/actions/runs/44058368806) and [137](https://github.com/two4i6/EasySellPut/actions/runs/44062146982) passed. Exact baseline [138](https://github.com/two4i6/EasySellPut/actions/runs/44065150143) was queued when this plan was written.
  - Commit: `docs: record approved modular application migration plan`.

- [x] **S01 — Establish the current regression baseline.** Depends on S00.
  - Verify the remote navigation fix, current GEX changes and complete offline suites on the integrated source.
  - Preserve current CLI/MCP capabilities, read-only enforcement, data reload, cancellation and protocol compatibility.
  - Record exact baseline CI and distinguish any unrelated/infrastructure failure. Fix confirmed regressions without weakening assertions.
  - Acceptance: reproducible baseline, meaningful failure attribution, and local/native evidence linked before changing module ownership.

- [x] **S02 — Introduce the UI-free operation boundary.** Depends on S01.
  - [x] S02a: immutable catalog snapshot and transport-independent dispatcher; preserve the built-in provider, public contracts and MCP permission filtering.
  - [x] S02b: metadata-only profile resolver and two-stage CLI parsing, including non-mutating legacy discovery. Signed installed-package contributions follow S03–S07; current resolver deliberately exposes only built-ins.
  - Introduce immutable operation definitions/catalog snapshots and a small dispatcher/provider interface in the shared application boundary.
  - Keep existing operations and handlers as the first provider; preserve schemas, ordering and WireJson results.
  - Make CLI help/parsing, MCP discovery/resources and invocation resolve the same catalog and permission policy.
  - Resolve global options and data directory before profile-scoped operation discovery; basic help/version remain available without starting engines or network work.
  - Acceptance: all current operation cases execute through real CLI/MCP; no UI assemblies enter the CLI dependency graph; cancellation/permission/error parity stays intact.

- [x] **S03 — Define signed module packages and compatibility.** Depends on S02.
  - Define app ID/version, host/engine protocol, supported public contracts, runtime, data format, optional UI and file-table schema.
  - Validate signed manifests, scope/repository, bounded metadata, paths, files/hashes, archive expansion, duplicates/links and compatibility before activation.
  - Reuse established cryptographic/download checks where appropriate; retain separate host-update and app-install state machines.
  - Acceptance: valid core-only package accepted; tampered, wrong-app/source, incompatible and unsafe packages rejected without changing active code or data.

- [x] **S04 — Implement profile-scoped registry and execution leases.** Depends on S03.
  - Use SnapshotFile revisions and cross-process coordination for installed/preferred/effective versions, enabled state and pending transactions.
  - Separate actual execution/data leases from long-lived MCP diagnostic presence. Validate process identity and generation; reject stale async work.
  - Keep packages immutable and outside macOS signed bundles; code/runtime are not disposable caches.
  - Acceptance: two processes cannot corrupt activation; crashes/expired owners recover safely; an idle MCP process does not permanently lock compatible patches.

- [x] **S05 — Add explicit local app maintenance.** Depends on S04.
  - Add CLI app list/info/doctor and explicit local install/update/disable/uninstall actions using trusted package identities.
  - Implement staging, verification, durable transaction recovery, activation and deferred cleanup.
  - Preserve default uninstall data, shared caches/runtime and other applications; reject incompatible data rollback.
  - Acceptance: install A → update B → disable/uninstall → reinstall, cancellation and failure recovery in temporary profiles; no installation/maintenance execution tool exposed through MCP.

- [x] **S06 — Build and load QQQ GEX as an independent package.** Depends on S05.
  - Build current original GEX UI/engine as a versioned artifact, preserving source manifests, algorithms, licences and exact input behavior.
  - Resolve activated assets/scripts from verified packages instead of embedding fresh GEX builds into ordinary host/CLI compilation.
  - Keep optional UI and required core aligned to the same app release; retain verified offline seed behavior if needed.
  - Acceptance: fixed host binary hashes run package A and B without a host rebuild; headless execution needs neither GUI nor system Node. This step alone does not certify full domain independence.

- [x] **S07 — Move GEX domain ownership behind its module interface.** Depends on S06.
  - Move GEX-specific operation definitions, routing, capture orchestration, data projections and schema ownership out of the generic host boundary.
  - Retain the original model as one implementation; obtain common market/analytics inputs through typed host capabilities.
  - Preserve existing public GEX facades, derived-cache generation fencing, observations/partial/full archives, preferences and workspace provenance.
  - Migrate legacy GEX paths with verified SQLite backups/locks; never delete the mixed archive database as a cache.
  - Acceptance: add a real bounded GEX business operation by changing only the app package; desktop/CLI/MCP use the same handler and original financial semantics.

- [x] **S08 — Verify MCP catalog changes and compatible app updates.** Depends on S07.
  - Keep stable public operation contracts; pin executing requests rather than implicitly pinning the whole MCP process.
  - Support installed/enabled/compatible module discovery with coherent help, tools/resources and bounded catalog snapshots.
  - Test legacy 2025 modes and current 2026 per-request metadata; use official SDK paths for notification/subscription differences.
  - Keep explicit version handling for breaking contracts and read→write changes; preserve permission checks at invocation.
  - Acceptance: MCP remains running across a compatible GEX update; old requests finish on A, subsequent requests run B; stale discovery and unsupported notifications fail safely.

- [x] **S09 — Add reusable desktop application hosting and management UI.** Depends on S08.
  - Add a shared module navigation model and platform AppView adapters; preserve native chrome, personal web tabs and article splitting.
  - Reuse cards/selects/help/dialogs/loading, tokens, Lucide and interruptible motion. Keep settings/language/theme in the footer.
  - Support core-only install, optional UI installation, rail visibility, enabled state and actionable update/uninstall states.
  - Keep private application origins/capabilities isolated from articles/personal pages; release only the hidden app's resources.
  - Acceptance: Chinese/English, light/dark, compact/wide and keyboard/reduced-motion journeys with actual 1080p screenshots and native WebView checks.

- [x] **S10 — Improve scheduling and shared development components.** Depends on verified runtime behavior in S08/S09.
  - Replace the global operation bottleneck only after explicit resource/thread-safety ownership is tested.
  - Bound CPU/provider work, cross-process heavy GEX jobs, queues and outputs; propagate deadline/cancellation without partial-write ambiguity.
  - Add reusable Web SDK/UI/token packages and a separate development host; no production dev/trust bypass.
  - Preserve one desktop QuoteHub and truthful headless bounded sampling; measure before introducing a broker or persistent engine.
  - Acceptance: unrelated pure calculation is not blocked by a slow app read; no unbounded process/memory growth or duplicate desktop market timers.

- [x] **S11 — Implement independent app CI and main-only release preparation.** Depends on S10 and package/rollback acceptance.
  - Test/package app core independently from host UI; reuse tested artifacts for signing and drafts.
  - Merge host/app capability cases and inventories without weakening exact operation coverage or Required checks.
  - Preserve four desktop/five CLI targets, native extracted-package execution, source/runtime/hash checks and downloadable evidence.
  - Keep app releases out of host Latest; signed app catalog binds exact version/source/hash/compatibility and rejects stale/withdrawn entries.
  - Acceptance: app-only change produces an independently installable app artifact, host updater still reads host releases, and work/PR runs cannot publish.

- [x] **S12 — Accept the complete GEX pilot.** Depends on S11.
  - Hold host/CLI files and paths fixed; test core-only CLI/MCP, then optional UI, update/uninstall/reinstall, offline recovery and concurrent consumers.
  - Verify all original financial invariants and retained data hashes; distinguish fixture, partial live and complete real-data coverage.
  - Review exact delivered CI and native screenshots. Update engineering/maintenance instructions to describe only implemented behavior.
  - Acceptance: an independently updated GEX is usable through all three entry points without a host release and without unrelated regressions.

## Later business migrations

- [x] **S13 — Market liquidity.** After S12: reuse existing service/math/provenance; validate the second app needs no duplicated package manager, market connection or UI system.
  - [x] S13a: signed core-only adapter, exact existing CLI/MCP contract, explicit ownership and no compatibility resurrection after disable/uninstall; shared packaging/SDK and four-platform independent CI.
  - [x] S13b: existing native liquidity page calls the installed operation; preserve shared controls, cancellation, source/missingness and navigation behavior.
  - [x] S13c: shared multi-app signed catalog/release promotion, fixed-host CLI/persistent-MCP A/B, and exact-commit native integration acceptance at 86f59ed (run 44240521185, attempt 2).
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

### S08 real transport update checkpoint

Permanent test-only in-memory signed fixtures now exercise the real CLI and official SDK MCP adapters with unchanged host DLL hashes. Both initialized 2025-06-18/2025-11-25 and stateless per-request-metadata 2026-07-28 paths passed: A→B while the MCP process stays alive, newly added tool discovery/resources, CLI result parity, denied hidden writes, explicit write mode, argument rejection and EOF. The current protocol correctly refuses an initialize handshake; tests now use server/discover plus all required per-request metadata. CI runs this on every CLI target and the headless script includes it. No product fixture key or runtime trust flag exists. Proactive notifications/subscription integration and full domain/native pilot acceptance remain pending.

### S09 local desktop management checkpoint

Settings now composes the shared app management model with existing AppCard/AppSelect/AppHelp/button/loading resources in both native front ends. Native file selection feeds the same signed installer used by CLI; enable/disable/uninstall remain explicit local maintenance and are documented as such in the desktop capability inventory. Core-only packages omit desktop navigation. Disabled/uninstalled GEX cannot silently revert to the embedded seed; explicit reinstall restores access, while observations and package backups survive removal. Discovery and enable verification are fully asynchronous; the unchanged anti-hang guard passes.

Checks: Automation 144, Shared 128, app-panel/complete form-alignment subset 3, all 58 CLI/MCP capability cases and Python guards 55 passed. Windows app/tests cross-compiled; native Windows execution is pending CI. Actual 1920×1080 Chinese/light and English/dark headless renders were inspected and saved in `docs/app-runtime-research/screenshots/`; compact layout/selection and native Windows manager tests were added to existing full suites. See application-manager.md for screenshots and scope. Optional UI attachment at the same app release, generic AppView adapters, proactive notifications and final native pilot remain tracked requirements; this is not S12 acceptance.

S01 baseline acceptance is backed by passing native integrated ancestor CI 44069964453. S02 now has authenticated installed contributions, asynchronous CLI/MCP discovery and execution permission checks in addition to all existing operation parity. Latest delivery CI 44084998371 was queued at inspection; pending new native results are not claimed as passed.

### S10 scheduling/shared-engine checkpoint

Pure option pricing, indicators and strategy math now use a separate bounded CPU gate; state/provider requests retain the tested serialization boundary. Signed app processes and GEX capture/calculation use bounded admission (16), active work (4), cancelable 30-second queue waits and actual per-app cross-process job locks. There is no broker, new quote timer or duplicate market connection. Idle MCP connections still own no app job lease. The retained-evidence operation now consumes a shared UTF-8/JSON engine SDK and bundles it with esbuild, preserving independent installation.

Automation 146 and shared engine SDK 2/2 passed. A live-stream fixture held the state/provider path while pure pricing completed; same-app work exclusion/cancellation and different-app progress passed. Separate-process probes confirmed exclusion and automatic release after owner EOF. Persistent MCP A/B tests and the signed independent package's real retained-summary/unchanged SQLite hashes passed. CI includes SDK tests and existing full Automation/cross-process checks. Generic Web SDK/AppView/development-host work remains pending; this checkpoint does not check off the entire S10 milestone.

### S11 independent distribution checkpoint

Added five-platform app-only core CI without host/desktop compilation, and a protected main-only Apps release workflow that promotes the tested full app artifact rather than rebuilding it. Production signatures must match pinned host trust; preparation produces a draft, explicit publication rechecks current main/CI, signatures/provenance, exact bytes, other-app state and monotonic catalog generation. App/catalog releases are prereleases with `latest=false`; host Latest remains separate. Development artifacts use build-only ephemeral keys and cannot change production trust.

AppCatalogClient authenticates the separate compiled-repository feed, bounds downloads, checks expiry/source/runtime/data format/withdrawal, persists monotonic sequence plus body hash and revalidates signed original bytes instead of mutable DTOs. CLI check/download is explicit and never installs through MCP. Canonical version components now reject whitespace/leading-zero/four-part paths.

Checks: Automation 152, Shared 128, 57 Python guards, persistent MCP A/B and full production CLI/MCP smoke passed. SDK/core-only package verification and actual GEX evidence-summary against unchanged SQLite passed. Offline release smoke ran real ECDSA re-signing, catalog/provenance verification, draft→non-Latest publication and stale-catalog rejection with every GitHub write intercepted; private-key cleanup passed. Workflows have not been dispatched for real signing/publication; latest remote native CI was queued. Remaining original-domain/native pilot requirements are not checked off by this infrastructure checkpoint.

### Independent app CI follow-up

The first exact independent app CI at `65ac757` ([44090239474](https://github.com/two4i6/EasySellPut/actions/runs/44090239474)) passed native Mac Intel, Mac Apple Silicon and Linux core jobs. Both Windows jobs exposed a test-fixture cleanup bug: Python's SQLite connection context manager commits but does not close the connection, leaving the temporary database locked. The fixture now explicitly closes it before package verification/cleanup; assertions and platform coverage are unchanged. Local package verification passed after the fix; new Windows/native results remain pending. Full local integration also caught a live-language caption/row-height mismatch; that product correction is being verified separately with unchanged pixel checks.

### S08 Windows heartbeat and footer responsiveness correction

Exact integrated CI [44095348131](https://github.com/two4i6/EasySellPut/actions/runs/44095348131) passed UI, Web/model, all four desktop package jobs and four CLI targets; Windows x64 CLI exposed a transient missing MCP diagnostic while the heartbeat atomically replaced its JSON file. Reader and writer now share SnapshotFile coordination and delete-sharing semantics. A concurrent 40-publish/40-read regression preserves an initialized session without relaxing liveness/permission checks. The footer performs one background scan at a time, discards hidden/disposed generations and formats cached state immediately on theme/language/copy changes. It creates no hidden polling timer.

Focused checks passed: MCP diagnostic tests 3, Shared 129, actual footer/AI setup plus background hide/restore UI tests 4. UI tests now explicitly await a fresh asynchronous status scan. No aggregate green result is claimed for the failed run or for the uncommitted generic AppView work.

### S09/S10 private AppView and source-development host checkpoint

Added tokenized loopback `PrivateAppSession`, bounded same-origin app-only catalog/invocation, reusable WKWebView/WebView2 adapters, dynamic module navigation and shared management notifications. Private UI uses the same authenticated dispatcher as headless operations; personal remote pages receive no bridge. Detach cancels requests, drains execution ownership and releases native views. Core-only/failed GEX viewer construction releases its lease. A separate `tools/Meili.AppDev` host accepts development signatures only in scratch profiles; production trust, existing profiles and host binaries remain unchanged. The shared browser SDK introduces no market socket or background polling.

Scheduling now admits a per-app job before occupying a global CPU slot, and separates archive readers from writer serialization. This permits reading committed observations during capture without starting a second financial data owner. Tests cover unrelated-app progress, read/write coexistence, private-origin/permission/schema rejection, native navigation metadata and retained personal browser identity. Locale changes now update the singleton manager and preserve row metrics.

Verification: Automation 157 and Shared 130 passed; full offline Avalonia and Windows test cross-compilation rerun below/in delivery CI. Earlier full Avalonia run passed 145 with one deliberate live test skipped; ten locale pixel parity cases passed separately. Full native Windows/macOS WebView execution remains CI-owned. Generic AppView/developer-host plumbing does not by itself finish original GEX capture ownership, optional same-version UI attachment or S12 pilot acceptance.

### S06 optional UI attachment checkpoint

Package storage now addresses immutable variants by signed archive hash, with read compatibility for the previous version-only layout. A core-only package can attach a same-version UI only when every existing file, model/runtime/protocol/data identity and supported platform remains identical; newly added paths are limited to UI/notices. Changed engines, contracts, reverse core-only replacement and arbitrary same-version changes are rejected. The original core archive remains untouched. Discovered operations bind the exact package hash as well as app/version, so a request discovered before attachment must rediscover rather than silently switching code. UI install uses the existing local picker/CLI installer; no signing or maintenance bypass was introduced.

Automation 159 passed, including same-version core→UI, retained original archive bytes, stale discovery refusal, actual private-page serving and legacy-layout/corrupt-variant handling. S09/S10 prior checkpoint full offline Avalonia rerun passed 145/145, Windows full test project cross-compiled, SDK 4/4 and workflow policy guard passed. Exact native CI remains pending.

### S04/S10 shared pinned runtime ownership

Extracted the bundled hash-pinned Node loader into application-independent `PinnedNodeRuntime`; signed module execution no longer depends on a GEX-specific runtime owner. The authenticated executable now lives in `apps/runtimes/node24/<binary-hash>` outside disposable caches, with owned-path link checks. Older cache copies are left untouched; no observations or user files are migrated/deleted. GEX retains compatibility aliases and uses the same shared loader.

Verification: Core 211 and Automation 159 passed; freshly built Linux self-contained CLI ran the original GEX importer/replay plus a 2,000-strike MCP query with PATH pointing at no executables, then refused an altered extracted runtime. All 57 Python guards passed. The full offline run exposed a documented structured-error catch missing its explanatory guard annotation; fixed and Core rerun passed. That earlier aggregate is recorded as failed, not silently relabelled green.

### S08 catalog change notifications and modern subscriptions

Added one bounded filesystem observer per MCP transport for the selected profile registry, with content-based effective-catalog deduplication and no polling, market work or app execution lease. Legacy initialized clients receive official SDK `tools/list_changed` notifications. The official 2026 `subscriptions/listen` handler now acknowledges only supported tool-list filters, tags each event with the listen request ID, limits concurrent listeners and cleans up cancellation/EOF. Unsubscribed 2026 clients receive no unsolicited events; explicit per-request catalog discovery remains authoritative and permission-filtered.

Verification: real persistent MCP A→B smoke passed in both 2025 protocol revisions and 2026 with/without a live subscription, including subscription cancellation, subsequent discovery/calls, CLI parity, schema/write filtering and unchanged host DLL hash. These tests remain in all five CLI CI jobs and the offline aggregate. Initial attempts deliberately failed the no-unsolicited-event and subscribed-delivery assertions; corrected the notification routing rather than weakening assertions. No resource updates or unsupported notification filters are advertised.

### S11 optional UI artifact coverage

The independent five-platform app workflow now builds/packages/verifies both core-only and UI-capable app variants, without invoking .NET or desktop host builds. Shared source/model checks and retained-observation integrity tests apply to both. Local full UI artifact verification and main-only release policy guard passed. These remain development-key artifacts; real signing/promoting/publishing stays in the protected main-only workflow and was not dispatched.

### S07 typed common host capabilities checkpoint

Signed operations can now declare a small read-only host-operation allowlist and reuse existing routed market services/Analytics through bounded duplex JSON-lines, instead of adding app-local network clients or copying calculation code. The production dispatcher bypasses app redispatch for these host calls and reuses its current provider/state gates. Existing operation capabilities cannot silently expand during update. Shared SDK, developer host and real CLI/official MCP fixtures use the same protocol; undeclared/maintenance calls, reused request IDs, trailing output and cancellation are tested.

Verification: Automation 164, Core 211 and SDK 6/6 passed; actual signed app processes preserved exact quote source/as-of/delay through provider plus original BSM calculation. Slow-provider cancellation released the lease and allowed uninstall. Real CLI/MCP A/B smoke passed all 2025/2026/subscription modes with the same fixture-provider result, no host DLL rebuild and no production trust override. CI invokes these tests on its existing five CLI platforms. Original GEX capture and legacy route migration remain pending; the capability transport alone is not full S07 acceptance.

The previous source revision `2eb1141` completed the full offline aggregate: 1,013 .NET tests, 57 Python guards, all 58 real CLI/MCP capability cases, cache/process/developer-host checks and cross-process app maintenance/scheduling passed (`build/out/tests/run-KIl6j3SJ`). Current host-call changes have their focused checks above; previous success is not claimed as current native delivery acceptance.

### S09/S10 shared AppView presentation and redraw control

Private app pages now receive the same existing native palette, language and reduced-motion projection through a bounded cancellable presentation endpoint. The browser SDK supplies lifetime-owned change observation. Both native module adapters attach/detach the shared presentation events; failed page startup also releases them. GEX reuses the shared token application helper and only emits expensive resize/theme events when tokens actually change, rather than on every data/quote event.

Verification: Automation 164, affected Avalonia manager/navigation/theme journeys 57, browser SDK 8/8, Mac build and complete Windows test project cross-compilation passed. Actual Chromium empty/computed GEX journeys passed with no remote traffic/script errors, expiry/revision and theme/motion behavior preserved. Original local calculation/storage/timing/partial-history pipeline and PCS contract suite passed. Inspected the actual 1920×1080 computed fixture screenshot saved with application-manager.md; native Windows/macOS acceptance remains delivery-CI owned.


### S03–S05 primitive acceptance closure

Package verification, profile registry/leases and explicit local maintenance are complete against their stated primitive acceptance cases: authenticated core-only packages; tamper/source/protocol/path rejection without activation; real cross-process exclusion/crash-owner release; staged immutable variants and CAS activation; interrupted journal reconciliation; install/update/disable/uninstall/reinstall retaining observations/backups and suppressing seed fallback. Core/runtime executables are outside disposable caches. Existing unit, real-process and signed transport fixtures cover these behaviors. This checks off S03–S05, not S06–S12 or native pilot acceptance; unsupported data migrations still refuse activation rather than attempting an unverified rollback.

### S04 immutable runtime concurrency acceptance

First-use extraction now creates the shared executable without overwriting an existing destination. Concurrent owners authenticate and reuse the winner's exact bytes, preventing replacement of a running Windows executable. The actual packaged runtime smoke now starts calculation and archive reading concurrently against a new shared profile with no runtime directory and no system Node, before the existing checksum-tampering rejection. Fresh Linux self-contained package passed the expanded smoke; Windows/macOS CI runs the same script in its extracted-package checks.

### S07 app-owned facade contracts and compatibility boundary

The eight established GEX contracts now live in `web/qqq-gex/public-contracts.json`, embedded as metadata by ordinary host compilation and carried in signed app notices. GEX-specific legacy routing, chunking and UI-kernel projections moved into `Apps/QqqGex/GexLegacyOperations`; the generic coverage dispatcher delegates to that explicit compatibility adapter. No model algorithm, source timing, archive path or existing handler behavior changed. This isolates the remaining migration target; compiled capture compatibility still exists and is not described as independent app execution.

Verification: exact before/after equality of all 58 operation names/order/descriptions/permissions/schemas; Automation 164 and all 58 real CLI/MCP capability cases passed. Independently built signed core artifact retained exact original engine bundles/model identity and passed retained-data/hash checks. Python guards passed. Public names and ordinary host builds remain unchanged; no npm invocation was added to compilation.

### S06/S07 original GEX operations through independent packages

App-owned handlers now supply the established calculation, history-rebuild and replay operations through signed companion dependencies on the exact original financial bundles. The generic host performs only authenticated dependency materialization, execution ownership/bounds and typed error decoding. Public schemas/permissions remain frozen. Source archive locations, missing-input behavior, repeat-import receipts, tick-precision range validation and original model-failure semantics are retained.

The actual-app integration fixture signs existing build outputs with an in-memory test-only key; A/core → A/UI → B/UI runs through real CLI/official MCP with unchanged host DLL bytes. It compares calculations, replay and history against the original bundle oracle, exercises write filtering and invalid-argument parity, adds a real retained-data reader only in B, and verifies archive hashes across reads/update/uninstall/reinstall. A second run uses the exact checksum-pinned Node from a built CLI package with PATH containing no system executables; it passed. All four shipped app operations have meaningful real CLI/MCP cases, and the dynamic app inventory must match those exercised cases. Both source and extracted-package variants are wired into all five native CLI CI jobs.

Automation 169, SDK 8/8 and Python guards 57 passed. This closes S06 package/runtime acceptance, including actual original GEX A/B and optional UI attachment; it does not close S07's remaining capture/archive/view/lifecycle/live-decision migration or S09/S12 native UI acceptance. No production trust override, private test key file or published release was introduced.

### S07/S09 one private app API for GEX and generic pages

Extracted shared app-operation and presentation HTTP handlers. The existing GEX document now receives an explicitly injected, identity/profile-scoped dispatcher, so its signed app operations use the same authenticated handlers as CLI/MCP without duplicating the business implementation. Foreign host tools remain inaccessible; generic and compatibility pages share signed catalog filtering, write/schema checks, bounded public errors and presentation change observation. Committed UI writes wake GEX revision readers; presentation-listener failure cannot turn a committed business write into a reported operation failure.

The compatibility viewer now reuses the strict bounded HTTP header parser and rejects invalid scope/core-only UI startup before opening its financial database. Tests verify no foreign built-in dispatch, profile mismatch without database creation, shared live theme observation, duplicate invocation-field rejection and preserved error behavior. Shared 131, Automation 169, Core 211 and both desktop builds/full Windows test-project cross-compilation passed. Full native browser execution remains separate CI evidence; this is not complete S07/S12 acceptance.

### S09/S10 actual browser SDK and development-host journey

Added a real Chromium fixture that packages signed UI files, starts the separate scratch-only developer host, loads its actual tokenized AppView, and executes the actual app-owned retained-data engine through the shared browser SDK. It verifies signed scope/write filtering, foreign tool/token/origin rejection, no remote traffic or financial storage creation, pending presentation cancellation, awaited profile cleanup and unchanged production DLL bytes. The local run passed; the Web CI job now builds the separate developer/CLI binaries and runs this journey after its existing original GEX/browser suites. This is browser/private-server evidence, not native WebView or full GEX UI migration acceptance.

### S09 native AppView probe coverage

Extended the existing four-platform native browser smoke host with an actual ephemeral-signed generic app package. It uses the production private session/API and pinned bundled Node, opens the real WKWebView/WebView2 `PrivateAppView` adapter, verifies the app-owned engine result and read-only scope, blocks external navigation, pins maintenance during the view lifetime, then releases/uninstalls while preserving a retained fixture marker. Fixture trust exists only in the non-shipped smoke assembly; no product setting or command bypass was added.

Both Mac/Avalonia and Windows/WPF smoke targets compile successfully in this Linux environment. Native execution is not claimed here: the existing Windows x64 / macOS Intel/Apple Silicon CI jobs automatically run the expanded probe, and their current runs remain queued. This explicitly remains a pending native S09/S12 acceptance gate.

### S04/S08 failure isolation and retained-format repair

Catalog discovery now quarantines unavailable app metadata logically without mutating evidence: healthy apps and built-in pricing stay usable, while the affected app fails closed with `apps doctor` recovery. Immutable metadata discovery does not pin execution or block a compatible update. CLI/MCP/private AppView report unavailable apps coherently. Uninstall retains data-format ownership; incompatible reinstallation and unverified legacy GEX adoption are rejected. Explicit reinstall of the exact authenticated archive repairs missing/corrupt package files while retaining corrupt evidence in quarantine; an unreadable prior package cannot authorize a different contract. Desktop maintenance catches malformed metadata without an unhandled command failure.

Automation 175 and Shared 132 passed. Real persistent MCP isolation scenarios passed in all four protocol/subscription modes. Existing full platform Automation/Shared and CLI/MCP jobs exercise these additions. Native execution and remaining S07 GEX handlers remain pending; no publication was attempted.

### S07 additional original GEX readers

The signed app now owns archive pagination, local live-decision routing and hash-verified lifecycle projections in addition to calculation/history/replay. Archive and decision execution still use the original pinned model bundle. The actual CLI/MCP A/core→A/UI→B/UI fixture compares archive resources against the original query on the same retained database, preserves original failure semantics for insufficient PCS source inputs, verifies lifecycle records/corruption, and retains the database through update/uninstall/reinstall. Both ordinary and extracted pinned-Node/no-system-PATH journeys passed, with unchanged host files. SDK 8/8 and release policy guard passed. View/capture ownership and native pilot acceptance remain pending.

### S07 app-owned GEX view projections and snapshot bridge

The independent package now supplies `get_qqq_gex_view`: original display/evidence/analysis/context/exposure query routing, workspace/partial/provider-byte projections, historical spread selection and bounded SHA256 chunks. Shared validation/model execution lives in one app helper. App-owned encoding preserves the prior System.Text.Json chunk bytes, including Chinese and HTML-sensitive text. A private logical snapshot capability reuses SnapshotFile locking and app identity without accepting arbitrary paths or moving legacy files. The generic runtime now accepts the existing boolean `uniqueItems` contract field; established per-view selection validation is retained.

Automation 176 passed. Actual signed CLI/MCP journeys passed with and without system PATH: exact pre-migration C# facade results plus original model output, workspace continuation/revision changes, provider gzip/hash bytes, malformed resource parameters and retained database hashes. The source-only legacy oracle injects genuine original query execution; it introduces no production trust switch. Capture ownership and native acceptance remain pending.

### S07 view checkpoint aggregate and CI follow-up

At code revision 57a6355, the complete `build/test-headless.sh` aggregate passed: Core 211, Data 159, Analytics 209, Shared 132, Mac 145, Automation 176 (1,032 .NET), SDK 8, Python 57, all 58 real CLI/MCP capability cases, production process/cache tests, isolated developer host, four persistent MCP update modes, actual signed GEX A/B and cross-process maintenance/jobs. Results: `build/out/tests/run-te2FLMsW`. These are fixture/headless results, not native acceptance.

Remote CI exposed a surface guard still looking for GEX literals in the retired catalog location; it now checks the actual app-owned read-only contracts and their host connection. Windows production MCP write smoke failures receive the complete existing structured error in assertion diagnostics (no retry or weakened check). A later Windows SDK-install failure is separately identified as setup infrastructure. Current native CI remains unaccepted.

### S07 request-owned complete source snapshots

Added private typed complete market-source receipts for the upcoming app-owned capture: same routed provider/gate, original DTO timestamps and separate original byte hashes, bounded chunks, no pagination refetch, no persistent source cache or additional market connection. Receipt ownership/lifetime is the executing request; stale/foreign receipts fail. Desktop/CLI/MCP and the development host reuse the same session adapter. Signed-engine source-byte/integrity/ownership tests pass in the full Automation suite (177). The Windows original-query fixture now explicitly decodes/writes UTF-8; the previous code-page failure was in test transport, not the GEX model. Capture orchestration itself remains pending.


### S07 complete installed-app domain cutover

All eight established public GEX facades are now supplied by the signed package, including source capture, archive/view/lifecycle projections and original financial calculation/query/history execution. Native capture/calculation compatibility entrypoints delegate to the installed handler; bootstrap avoids a duplicate full-context capture. The original three financial bundles remain the single model implementation. Shared source receipts, SDK byte/hash transport and atomic logical-input publication are reused across applications; permissions, bounded jobs, deadlines, generation fencing, protected data and provenance remain explicit.

Legacy format-1 files are adopted **in place** through fixed compatibility aliases, without relocation, unverified SQLite copying or rollback. Unsupported data-format changes still refuse activation; old compiled routes are frozen compatibility seeds for unregistered profiles, suppressed after uninstall. Installed app changes require only a new authenticated app package.

Verification: Automation 179, Shared 132, Core 211, SDK 9, Python guards 57 and workflow/surface guards passed; complete Windows tests cross-compile. Actual fixed-host CLI/MCP A/core→A/UI→B/UI and all eight facades passed using only the extracted pinned Node with system PATH empty. Capture was compared with original C# ingestion for aligned/delayed/unverified/sub-tick-boundary CBOE, missing IV, partial expiries, changed raw revisions and a 20,000-contract chain; original source errors, raw bytes, normalized inputs and repeated first-observation retention matched. Source timeout/cancellation, incomplete uploads, write denial, hashes, conflicts and linked snapshot paths are covered. Fixtures do not certify live market completeness.

Remote revision d4b501e passed Windows x64, Mac Apple Silicon and Mac Intel desktop jobs, and all four native browser probes (Windows's later unrelated shared-fixture subscription assertion failed). Its Windows CLI cleanup failure was a test SQLite handle left open; connections now close explicitly. The WPF quote ownership test now uses isolated production registrations while retaining the same assertions. Exact-revision CI and full final aggregate remain S09/S12 acceptance gates; no main merge or release was performed.


### S08 complete persistent-transport acceptance

At d31cc70 the full offline aggregate passed without source changes during the run: Core 211, Data 159, Analytics 209, Shared 132, Mac 145, Automation 179 (1,035 .NET); SDK 9 and Python 57; all 58 public CLI/MCP capability cases; production/cache/process/developer-host tests; four persistent official-SDK MCP protocol/subscription modes; all eight actual signed GEX facades including capture scenarios; and cross-process maintenance/jobs. Results: `build/out/tests/run-bMkzhCmI`.

Installed/enabled app catalogs, permission/schema stability, request/package leases, list-change metadata/notifications, modern opt-in subscriptions, coherent rediscovery after A→B, source-error handling, stale/tampered app isolation and cleanup are verified. Idle MCP processes remain open across compatible GEX activation and subsequent requests use B without rebuilding the host. This closes S08; native UI, source-development GEX preview and exact delivered CI remain the later acceptance gates. No publication or upstream merge was performed.

### S09/S10 complete original-page development host and signed native acceptance probe

Extracted the original GEX private document session into UI-free Application and kept the native adapter thin. Generic/GEX documents reuse bounded private request parsing, scoped operations, canonical generated design tokens and idempotent awaitable shutdown, including reentrant detach. Source AppDev now supports the full original page, explicit temporary normalized input import, language/theme selection and actionable core-only errors. It never loads a user profile or grants business writes. Targeted SQLite pool release follows request draining.

Automation 181 and Shared 134 passed. Actual Chromium generic SDK and original signed GEX/model journeys passed with 1920/1280×1080 screenshots, three charts, write denial, pending-request cleanup and unchanged source/production DLL. WPF/Avalonia native probes cross-build; their populated GEX journey now installs the actual signed app, performs A→B/new-operation/uninstall/reinstall and fixed host/history hash checks. Four-platform execution and exact-current aggregate remain required; this checkpoint does not check off S09/S12 prematurely. Windows capture fixture now compares native path objects and still requires the published file to exist, avoiding separator-only failures.

### Final pilot regression follow-up (historical authentication interruption)

The d5abea3 native Windows x64 probe executed the actual signed original GEX page, chart/tab/input/theme/layout journeys and screenshots, then correctly rejected the test B package because it removed the old summary operation. The fixture now adds a new operation/engine alongside the unchanged old contract, preserving production compatibility enforcement. WPF native probe and full test project cross-build after the fix; execution is not yet claimed. Shutdown now logs failures as well as propagating them to awaiters; Core 211 and targeted shutdown 2 passed.

The first d5abea3 offline aggregate was stopped after a missing shutdown-log guard and a timing-sensitive Avalonia navigation assertion failed; it is not a successful aggregate. The keyboard test now awaits the posted navigation and additionally verifies shared context. Full Avalonia rerun passed 145; a prior full run still exposed an intermittent dashboard→chart symbol reset. Its test records context transitions/call stacks for diagnosis without changing the expected symbol. Python guards 57 and SDK 9 passed. Fresh complete aggregate and final native CI are still required.

GitHub access stopped working after the d5abea3 push (API 401, Git authentication unavailable). Later fixes remain local until the workspace GitHub connection is restored. No main merge or release was attempted.

### Final offline acceptance and Windows path-identity follow-up

Code d9ffa13 passed the complete offline aggregate (`build/out/tests/run-y4h5y6bv`): Core 211, Data 159, Analytics 209, Shared 134, Avalonia 145 and Automation 181 (1,039 total); SDK 9; Python 57; all 58 real CLI/MCP capabilities; production cache/developer-host/persistent MCP; original signed GEX A/B/all eight facades/eight capture scenarios/source failure; cross-process maintenance and scheduling. Both Chromium journeys and offline signed-package/release-promotion smoke passed. All original GEX scenarios also passed with PATH containing no system executables and Node extracted from the verified bundled archive.

Independent app CI [44140353533](https://github.com/two4i6/EasySellPut/actions/runs/44140353533) passed all five native targets, including core-only and UI packages with no host build. Windows x64 integrated desktop/native/update-package job passed; Mac Intel's native WebView step passed. Final four-platform/full integrated acceptance is still pending. Earlier Apple Silicon cancellations were explicitly annotated by GitHub as hosted-runner capacity/acquisition failures (no runner/steps), not test failures; the existing macos-15 workflow option was dispatched for the same revision without changing tests or architecture coverage.

Both Windows CLI jobs still rejected the test's lexical path equality before reading capture contents. The fixture now checks both paths exist and refer to the same file identity (supporting Windows long-form/8.3 aliases), with separate actionable diagnostics; all content/raw/hash/original-model assertions remain unchanged. Local original signed GEX scenarios passed after that correction; exact Windows rerun is required. GitHub authentication recovered and d9ffa13 was pushed; no main merge or release occurred.

### Windows JSON sharing and engine pipe classification

Exact CI at 184c127 exposed two additional real boundaries without relaxed assertions: a production CLI watchlist write failed with I/O while an MCP client remained open, and Windows observed a broken input pipe instead of the expected malformed-engine failure. Mutable JSON prevalidation still used uncoordinated `File.ReadAllText`; settings/alerts/strategy and drawing validation now reuse SnapshotFile. Atomic publication also tolerates bounded Windows sharing/lock errors from legacy readers while retaining the writer coordinator and rechecking CAS on retries. Other permission/corruption/I/O errors still fail; temporary files are removed. A cross-platform retained-reader test and two explicit Windows-only timeout/conflict tests cover the boundary.

Both one-shot and duplex engines now classify premature pipe closure as an engine protocol failure, preserving caller cancellation and public error categories. Host calls, trailing output and permission assertions are unchanged. Local Core passed 212 with the two Windows-specific cases correctly skipped; Automation passed 183, including both engine modes. Full aggregate and the new Windows native cases remain required before acceptance. This follow-up does not relabel the failed CI runs as successful.


### S09 acceptance — reusable desktop hosting and original signed UI

S09 is accepted against the UI behavior requirements. Code cc9a576's integrated run [44143805711](https://github.com/two4i6/EasySellPut/actions/runs/44143805711) passed the native WebView step on Windows x64 and Mac Intel/Apple Silicon, including the actual signed original GEX A→B/new-operation journey, trusted input, three charts/ten tabs, theme/size/hide/reload and retained host/history hashes. Windows x64 and Apple Silicon full desktop/package/updater jobs also passed; Mac Intel packaging and overall integrated acceptance remain S12 gates. Shared native manager tests and original source-host 1920/1280×1080 captures already passed locally. Representative real native images were inspected and added with actual capture sizes; they are synthetic historical test windows, not live data or a 1080p claim for a constrained native work area.

The Windows Shared failure was immediate scratch-directory deletion after nonblocking Dispose, not missing request-drain ownership. Async GEX fixtures/cloud/native test hosts now await DisposeAsync before cleanup. Shared 134 and WPF/Avalonia/cloud-host builds passed; the test no longer clears a pool to mask its own session lifetime. Public native detach remains nonblocking and the execution lease remains held until all accepted requests finish. Final complete CI is still required in S12.


### S10 acceptance — scheduling, SDK and isolated development

S10 is accepted. The complete cc9a576 offline aggregate passed at `build/out/tests/run-RVgYfM2l`: 1,042 .NET tests passed and two Windows-specific sharing cases were explicitly skipped on Linux (both actually passed in Windows x64 Core 214/214 CI). SDK 9, Python 57, all 58 real CLI/MCP cases, signed original GEX/capture/persistent MCP and cross-process maintenance/scheduling passed. Unrelated pure pricing progresses while provider/live work waits; per-app admission precedes bounded CPU work, writers serialize across processes while committed archive readers progress, cancellation/owner EOF releases leases, and outputs/diagnostics/source receipts/input uploads are bounded.

The shared engine/market/browser/presentation SDK and complete original GEX AppDev preview are documented in `web/app-sdk/README.md` and `tools/Meili.AppDev/README.md`. Actual generic and original-page Chromium journeys passed at unchanged presentation code d9ffa13 with source isolation, seeded original model, write denial, 1920/1280×1080 rendering and awaited scratch cleanup. Generated defaults and native adapters use the existing design tokens; no second quote timer/socket, provider implementation or permanent broker was added. Later fixture-only awaited cleanup does not change these production behaviors. Remaining final integrated gate is tracked in S12.


### S11 acceptance — independent five-platform delivery

S11 is accepted. App payload source is unchanged from [five-platform run 44140353533](https://github.com/two4i6/EasySellPut/actions/runs/44140353533): Linux x64, Windows x64 and Mac Intel/Apple Silicon all built, packaged and verified both core-only and UI-capable GEX without .NET/host/desktop compilation. The required integration pipeline retains four desktop/five CLI targets, real extracted package/updater tests, exact inventories and all 58 CLI/MCP capabilities; its final current gate belongs to S12.

Offline package verification and actual ECDSA re-signing/signed catalog/provenance/draft→explicit non-Latest promotion/stale-generation rejection passed at d9ffa13, with every GitHub mutation intercepted and private-key cleanup checked. Release scripts/policy are unchanged by later runtime/test fixes; policy guards and Python 57 passed in the cc9a576 aggregate. Main-only Apps release promotes tested bytes, never rebuilds the payload, binds the compiled repository/pinned key and stays outside host Latest. Protected secret-backed prepare/publish was not dispatched and is not implied by acceptance. No release or main merge was performed.

### S12 remaining packaged Windows I/O diagnosis

At final documentation revision 304c536, Linux/Mac Intel and both Windows CLI jobs passed, as did Mac Intel/Windows desktop jobs, Web and UI. Windows x64's extracted desktop CLI still intermittently failed `rename_watchlist_group` with generic I/O; the source CLI job passed the same operation. Therefore S12 remains open; the earlier sharing changes are not claimed to establish the complete root cause. Apple Silicon jobs were again cancelled before acquiring runners (capacity annotations), not failing tests.

Added bounded profile-scoped local I/O error stacks/HRESULTs through the existing rolling logger without retargeting another profile's log or changing public error envelopes. No tool arguments are logged. The real process test now performs five sequential MCP renames and includes bounded scratch-profile logs only on failure. This is diagnostic/stress coverage, not a retry or relaxed result assertion. New Core scoped-log test passed: 213 passed/two Windows-only skips locally; Automation 183 and the real production CLI/MCP stress journey passed after a successful rebuild. First diagnostic build had a method-extraction compile error, corrected before these checks; stale-binary test output from that failed build is not acceptance evidence.

### S12 cold-writer regression coverage

The a2ef863 offline aggregate passed (`build/out/tests/run-nce6xOj1`): Core 213, Data 159, Analytics 209, Shared 134, Avalonia 145 and Automation 183 (1,043 passed; two Windows-only cases explicitly skipped locally), SDK 9, Python 57 and all 58 real CLI/MCP capabilities plus all signed app/model/protocol/maintenance journeys. Its Windows source CLI and extracted desktop CLI passed the five sequential MCP mutations with scoped diagnostics enabled; no I/O root-cause claim is inferred from one successful run.

The same mandatory process harness now also creates three separate fresh data directories, cold-starts a writable MCP process for each, renames a CLI-created group, verifies an external CLI mutation through the existing MCP connection, then checks EOF cleanup and persisted state. Local production CLI passed that extended journey. Existing CLI and extracted desktop CI steps automatically execute it on all their platforms; assertions are unchanged and failure logs remain bounded. Final complete native/integrated acceptance is still pending.

### S12 confirmed Windows atomic replacement failure

Cold writable profiles on revision 372f918 captured native Windows `File.Replace` HRESULT `0x80070497` (Win32 1175), in both source CLI and extracted desktop CLI. Microsoft documents ERROR_UNABLE_TO_REMOVE_REPLACED as preserving both file names. Publication now retries that exact failure within the existing three-second coordinator lease, only after rechecking the original destination revision and staged content hash. Errors 1176/1177 and other unsafe failures still surface; business operations are never replayed. Four injected real-file cases verify recovery, external-writer conflict, staged tampering and non-retriable partial-replacement error. Core passed 217 with two explicitly Windows-only skips locally; native/current full acceptance remains pending.


### S12 acceptance — complete independent GEX pilot

S01–S12 are complete. Implementation revision `3b476cc` passed [integrated run 44154390154](https://github.com/two4i6/EasySellPut/actions/runs/44154390154), including **CI · Required checks**, all four native desktop targets and all five CLI/MCP targets, Web, UI and main-only release guards. Windows x64 each executed all 219 Core cases; both source and extracted CLI passed the three cold writable MCP profiles. Original eight signed GEX operations, capture parity/source failure, fixed-host A/B/new-operation, persistent MCP modes, cancellation, uninstall/reinstall and history/provenance preservation passed. Four native desktop jobs exercised real installed signed test payloads, original charts/tabs/trusted input/theme/layout and retained host/history hashes, then packaged application/updater journeys.

GitHub cancelled default macOS 26 ARM64 jobs before runner acquisition due to documented capacity constraints. The existing supported macOS 15 fallback and infrastructure-only retries eventually executed both Apple Silicon jobs successfully. No skipped/cancelled job is counted as a pass; no architecture, assertion or release policy was weakened. Earlier implementation failures remain documented above and were resolved before acceptance.

Full offline aggregate `build/out/tests/run-BOmYIlNo` passed: 1,047 .NET tests (Core 217 plus two explicit Windows-only skips, Data 159, Analytics 209, Shared 134, Avalonia 145, Automation 183), SDK nine, Python 57, all 58 real CLI/MCP capabilities and all signed application/process/cache/development-host journeys. Both actual Chromium AppDev journeys passed at the same implementation revision. Independent app-only five-platform core/UI CI remains green at [44140353533](https://github.com/two4i6/EasySellPut/actions/runs/44140353533); its payload/SDK and app build/release scripts have not changed since that run.

See the [complete acceptance report](docs/app-runtime-research/pilot-acceptance.md), [management/native screenshot gallery](docs/app-runtime-research/application-manager.md), [development host](tools/Meili.AppDev/README.md) and [independent delivery guide](docs/app-runtime-research/app-distribution.md). Screenshots explicitly identify synthetic/headless/native evidence and actual dimensions. No live-provider completeness, trusted production installer, main merge or public release is implied. This final acceptance commit changes documentation only and cites unchanged-code CI; its newly triggered CI must not be called passed before completion. S13 onward remains future work.


### QQQ GEX independent price-clock follow-up (2026-11-17)
- [x] Integrate the stacked partial-workspace, price-clock and CI-fix branches into the completed S01–S12 runtime; preserve concurrent app/runtime changes. Details and actual-source evidence: `web/qqq-gex/MIGRATION-MATRIX.md`, “independent price-clock repair”.
- [ ] Rebuild packaged assets and pinned runtime, run official SDK MCP + native Mac/Windows acceptance, and inspect exact-commit CI. Local tests and real isolated capture do not certify a full session, complete IV or successful actionable alerts.
- [x] Retain explicit limitation: stock display updates on existing successful-chain capture cadence; no autonomous quote-only sampler during complete option-source failure. Do not backfill old sessions with invented observations.


### GEX repair branch integration — 2026-11-18 (Asia/Shanghai)

Integrated the stacked `gex/unified-partial-workspace-20261117` → `gex/price-clock-separation-20261117` → `gex/price-clock-ci-fix` histories into `work` after S12. Resolved six conflicts while retaining the UI-free session, catalog issues/fingerprints, current signed fixtures and strict UTF-8 parsing. Regression tests caught the missing document-route allowlist and stale packaged operation schema; the signed engine also received the display-price and `priceBasis` changes. Poll-only timestamps no longer duplicate identical retained observations; changed source/price/model cutoffs still do. No signature, compatibility or financial-kernel rule was weakened.

Local verification: .NET 1,053 passed/two explicit Windows-only skips, SDK nine, Python 60, all 58 CLI/MCP capabilities, original kernel parity, partial/date/pagination and price-clock Chromium journeys, both AppDev browsers, signed app A/B and all nine capture fixtures plus source failure passed. The initial aggregate exposed the integration issues and a non-trading-day test expiry; corrected signed journeys passed on rerun. Native and five-platform app CI await the actual merge revision. See [integration report and inspected 1080p screenshots](docs/app-runtime-research/gex-branch-integration.md). No branch deletion, main merge or release is included.


### Supported platforms and app distribution setup — 2026-11-18 (Asia/Shanghai)

At the owner's request, future Windows releases are x64 only. Removed the discontinued Windows target from desktop/CLI/app CI, release artifacts/provenance/signing, packaging entrypoints, runtime pins, active installer listings and support documentation. Three desktop and four official CLI/app targets remain; macOS Apple Silicon is retained. Dated test counts elsewhere are historical evidence, not the current matrix. Negative tests preserve rejection of unsupported Windows packages.

Added opt-in current-main automatic app draft preparation (`APPS_AUTO_PREPARE=true`), explicit manual publication, exact current-main CI/version resolution, and weekly signed catalog renewal without changing package identities or publishing new app versions. Catalog writes share a non-cancelling concurrency group and reject concurrent changes; real-signature tests verify renewal and key cleanup. Added an administrator bootstrap helper preserving Environment reviewers/timers and signing backups; it refuses silent key rotation and never merges main or publishes. See [installation and GitHub setup](docs/57-独立子应用安装与GitHub分发.md).

Full local aggregate `build/out/tests/run-DGKec0KS` passed: .NET 1,055 (plus two explicit Windows-only skips), SDK nine, 58 real CLI/MCP capabilities, all signed GEX/process/cache/development journeys. Final Python suite passed 69 after adding PE architecture rejection; main-only release/workflow policy guards passed. No UI renderer was changed by this task.

Actual GitHub administration remains blocked: the connected App returns HTTP 403 for Environment secret/variable administration and Environment writes. No production key was generated/replaced, no signing secret or repository variable was changed, and no main merge or release was performed. Administrator authorization and confirmation of existing signing-secret state are required before applying the prepared bootstrap. Exact-commit CI must be recorded after push, never inferred from local results.

## Version-gated automatic releases — 2026-11-18

- [x] Host: main push CI → version check before signing → tested native package signing/notarization → signed draft → existing verified publisher. Published versions skip; existing drafts stop without replacement. Manual preparation/publication remain recovery paths.
- [x] Apps: independent manifest version, tested-byte promotion, production signature verification, automatic publication and separate non-Latest catalog. Main/source/CI/native package gates remain intact.
- [x] Use HOST_AUTO_RELEASE / APPS_AUTO_RELEASE; bootstrap preserves existing values and creates missing switches false. Administrator reports both false, main-only Environment and required CI ruleset configured; all nine signing secrets missing.
- [x] Update engineering rules, delivery guides and executable workflow/version tests; Python automation suite and workflow guard passed locally (73 cases). CI already discovers test_*.py.
- [ ] Production activation: supply real credentials and matching public pin, verify native distribution, then enable switches. No main merge, workflow dispatch or production release performed in this change.

## Automatic distribution before OS publisher certificates — 2026-11-18

- [x] User explicitly permits host release without Windows publisher certificate or Apple Developer ID/notarization. Explicit `none` mode preserves exact CI archives/checksums and existing macOS ad-hoc signatures; no silent credential fallback.
- [x] Retain native package execution, architecture, source trust, GUI/CLI/MCP, updater/data-preservation checks, signed update indexes and independently signed app packages/catalogs. Release provenance/notes disclose missing OS publisher signatures.
- [x] Add cross-target byte-preservation and corrupt/non-main rejection tests; document remaining one-time UPDATE_SIGNING_KEY setup. Eight OS certificate secrets are deferred.
- [ ] Activate only after matching production public pin/Environment secret and successful native CI. Current GitHub App token still cannot administer Environment secrets (403); no production key or switches changed.

### S13a — second app compatibility core

Implemented independent market-liquidity metadata/engine and shared SDK bundle/package writer, with exact public get_market_liquidity schema/read permission. Explicit first-party operation ownership allows only its own stable facade; missing/corrupt, disabled and uninstalled modules cannot silently resurrect the facade. Host calls reuse MarketLiquidityService directly (no recursive module dispatch, copied math/provider/cache or financial data migration). App-only four-platform CI now builds/tests the actual signed liquidity core and existing GEX.

Local focused module/liquidity suites passed 55 tests; real Node archive smoke passed with signature/hash/missingness/source-error checks, and existing GEX archive/engine smoke passed after shared writer extraction. Native liquidity now uses the same installed operation through LiquidityAppClient with the original shared provider instance and existing view-model cancellation/generation checks; real signed A/B tests cover native DTO decoding and disabled/uninstalled failure. The first full offline run passed all six .NET suites but its shell tail was invalidated by a concurrent script edit; a fixed-script final rerun is required. This is S13a+b evidence, not S13 completion, production distribution or native/live acceptance. See docs/app-runtime-research/liquidity-migration.md for current boundaries and follow-ups.

S13a+b final-source checks: 1,060 .NET cases passed (Core 217 + two Windows-only skips, Data 160, Analytics 209, Shared 134, Avalonia 145, Automation 195), Python 75, shared SDK 9, all 58 actual CLI/MCP operations. Final full-script cache/AppDev/persistent-MCP/GEX-maintenance tail is still running at this commit; no pending tail/native runner is claimed passed. Independent liquidity/GEX package signature/engine smoke passed. Current 1920×1080 Avalonia fixture screenshots were inspected and retained; production live completeness is not implied.

### S13c — shared multi-app delivery and fixed-host evidence

Generalized the existing release source/package/provenance validator with explicit first-party app identities; no second installer or signing implementation. Main-only Apps release checks each app manifest and sequentially promotes exact tested GEX/liquidity artifacts into the same separate signed non-Latest catalog. Manual recovery selects one app. Catalog generations advance from the authenticated previous generation when two app versions publish within the same run; renewal follows the same rule and retains all entries.

Actual packaged liquidity A/B passed real CLI and persistent official SDK MCP calls with a fixed host hash, unchanged contract, explicit uninstall removing discovery/invocation, retained app data and successful reinstall. Both app re-sign/catalog/publication tests passed with all GitHub writes intercepted, including cross-app substitution/stale-catalog rejection. Python 78, policy guard and final Automation 195 passed. Generic persistent MCP 2025/2026 modes and all original signed GEX facades passed again after sharing the production catalog resolver with the fixture host. Full prior-source offline script completed successfully at run-cxYkSLYN (1,060 .NET, 75 Python at that stage, SDK 9, all 58 actual CLI/MCP, cache protection, AppDev, persistent app updates, GEX source parity and cross-process maintenance); subsequent changes were covered by the named focused reruns rather than a second broad UI run.

The core engine source passed all four native App core jobs in https://github.com/two4i6/EasySellPut/actions/runs/44239654589 at 02b470d. Host/release integration CI was pending at that implementation commit; the final acceptance below supersedes that status. Production key/bootstrap and public release remain unperformed and are separate from these fixture validations.

### S13 accepted — shared runtime, native report and multi-app delivery

Implementation `86f59ed8d569432e470406ff391c1ef2ee7aabe0` passed [CI · Test & Package / 44240521185](https://github.com/two4i6/EasySellPut/actions/runs/44240521185), including CI · Required checks, all three native desktop/package/updater targets, all four CLI/MCP/package targets, Web, UI and release policy. Its exact app artifacts also passed all four [Apps · Build & Test / 44240521145](https://github.com/two4i6/EasySellPut/actions/runs/44240521145) native core jobs. The initial UI runner stalled downloading the 61.2 MB Noto CJK package from an Ubuntu mirror; an unchanged-code UI-only rerun completed successfully in attempt 2, retaining the already successful native results. No check was weakened or skipped.

S13 is accepted as the independently updateable compatibility core plus its existing native presentation: the shared financial math/providers intentionally remain host capabilities, not copied domain kernels. Core-only packaging, exact public contracts, actual signed A/B CLI/persistent-MCP/native-client calls, data-preserving uninstall/reinstall, sequential multi-app signed catalog promotion and shared UI controls are implemented. Optional independently shipped liquidity Web UI, new financial semantics, live source completeness, production trust setup, main merge and public release are not implied. S14 remains a separate pending migration.

This acceptance update is documentation-only and cites the unchanged implementation revision above; its own newly triggered CI is not claimed passed.
