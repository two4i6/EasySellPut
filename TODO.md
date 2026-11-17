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

Both Mac/Avalonia and Windows/WPF smoke targets compile successfully in this Linux environment. Native execution is not claimed here: the existing Windows/macOS x64/ARM64 CI jobs automatically run the expanded probe, and their current runs remain queued. This explicitly remains a pending native S09/S12 acceptance gate.

### S04/S08 failure isolation and retained-format repair

Catalog discovery now quarantines unavailable app metadata logically without mutating evidence: healthy apps and built-in pricing stay usable, while the affected app fails closed with `apps doctor` recovery. Immutable metadata discovery does not pin execution or block a compatible update. CLI/MCP/private AppView report unavailable apps coherently. Uninstall retains data-format ownership; incompatible reinstallation and unverified legacy GEX adoption are rejected. Explicit reinstall of the exact authenticated archive repairs missing/corrupt package files while retaining corrupt evidence in quarantine; an unreadable prior package cannot authorize a different contract. Desktop maintenance catches malformed metadata without an unhandled command failure.

Automation 175 and Shared 132 passed. Real persistent MCP isolation scenarios passed in all four protocol/subscription modes. Existing full platform Automation/Shared and CLI/MCP jobs exercise these additions. Native execution and remaining S07 GEX handlers remain pending; no publication was attempted.

### S07 additional original GEX readers

The signed app now owns archive pagination, local live-decision routing and hash-verified lifecycle projections in addition to calculation/history/replay. Archive and decision execution still use the original pinned model bundle. The actual CLI/MCP A/core→A/UI→B/UI fixture compares archive resources against the original query on the same retained database, preserves original failure semantics for insufficient PCS source inputs, verifies lifecycle records/corruption, and retains the database through update/uninstall/reinstall. Both ordinary and extracted pinned-Node/no-system-PATH journeys passed, with unchanged host files. SDK 8/8 and release policy guard passed. View/capture ownership and native pilot acceptance remain pending.
