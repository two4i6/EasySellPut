# EasySellPut contributor and agent instructions

## Project shape

EasySellPut is a local .NET 10 application with Windows WPF and macOS Avalonia desktops, a cross-platform CLI, and a local stdio MCP server. Keep user data local. Reuse the existing checkout; cloud tasks are isolated, so do not create another Git worktree unless the user explicitly asks.

- `Meili.Analytics`: deterministic pricing, indicators, strategy math; no UI, storage, network or MCP dependencies.
- `Meili.Core`: models, provider interfaces, settings, alert rules and shared storage protection.
- `Meili.Data`: provider adapters, failover, rate limits and SQLite cache.
- `Meili.Application`: UI-free automation use cases and operation/schema catalog. `StrategyStore` retains its existing namespace for desktop source compatibility.
- `Meili.Shared`: desktop view models, UI platform adapters and rendering; do not reference this project from CLI/MCP.
- `Meili.Cli`: human/JSON CLI and official C# SDK stdio MCP transport, calling the same application services.

## Every feature must consider desktop, CLI and MCP

For each added or changed capability, explicitly evaluate all three entry points in the task/PR notes. User-visible business operations should have a shared application service, a usable CLI command and a discoverable MCP tool. If an entry point is intentionally inapplicable (e.g. window layout or native Dock integration), record why. Do not omit CLI/MCP support silently.

Keep CLI and MCP operation names, schemas, required fields, bounds and semantics in `OperationCatalog`. Add aliases/help/examples where useful. Do not duplicate business algorithms in adapters or make MCP launch shell commands/parse terminal text. Keep pricing assumptions, timestamps, freshness, adjustment basis, incomplete data, missing symbols and source provenance in structured responses. Never fabricate prices or equate an unknown source state to a passed connectivity check.

Treat JSON `schemaVersion`, operation names, argument types, error codes and exit codes as public contracts. Document incompatible changes and provide migration guidance. Emit finite JSON: non-finite numerical values become null, with explicit boundedness/status metadata explaining their meaning.

## Storage and processes

All entry points must resolve the same Windows/macOS/portable data directory; support an explicit `--data-dir`. Test with temporary directories, never the user's real settings. Shared JSON writers must use `SnapshotFile`: cross-process locking, unique temp files, atomic replacement and optimistic snapshot validation. Atomic rename alone does not prevent lost updates. A conflict must be surfaced, not overwritten or retried with the same stale state. Long-running MCP requests reload local stores; desktop users reload/restart after external changes before saving. Do not add write APIs bypassing this protocol.

Keep continuous alert monitoring in the desktop until a shared ownership/lifecycle design exists. Do not create duplicate monitors in CLI/MCP accidentally. SQLite uses its own locking; test schema migration and concurrency when changing cache behavior.

## CLI and MCP requirements

- CLI business operations with `--json` write one parseable result to stdout; diagnostics go to stderr. Preserve nonzero exit codes. Honor Ctrl+C, cancellation, bounded result sizes and request timeouts.
- MCP stdout is protocol-only: no banners, debug prints or normal CLI rendering. Use the official SDK; stdio is the local default. Test initialization, discovery, tool calls, errors and clean shutdown.
- MCP writes are opt-in via `--allow-writes`. Hide write tools in default discovery AND enforce permissions at invocation; annotations are not authorization.
- Do not expose arbitrary shell execution, unrestricted filesystem operations, arbitrary URLs or secrets through tools. Keep proxy credential URLs out of settings responses and logs. Market results sent to an AI client leave the local process; describe this accurately.

## Build and validation

Use the SDK pinned by `global.json`; source `tools/env.sh` on Unix or `tools/env.ps1` on Windows. Preserve TLS, package and SDK checksum verification. For managed Cloud's specific NuGet-Migrations mutex restriction, use approved command escalation rather than weakening sandbox or verification settings.

- Linux/macOS shared + headless regression: `bash build/test-headless.sh` (Python 3 required for real-process smoke tests).
- Windows native solution regression: `powershell -ExecutionPolicy Bypass -File build/build.ps1 -Test`; also run the CLI/MCP process smoke test.
- CLI build: `dotnet build src/Meili.Cli/Meili.Cli.csproj`.
- Publish: `bash build/pack-cli.sh <rid> [output-parent]`; test the actual published executable with `python3 tests/automation/cli_mcp_smoke.py --executable <path>` on its target OS.

Add meaningful tests for business behavior, invalid inputs, CLI/MCP parity and affected storage concurrency. For network behavior use provider fixtures/fakes first. Live tests require deliberate `MEILI_LIVE=1` and real permitted destinations; do not treat fixture tests as live validation. Keep passed, failed, skipped, excluded and unrun outcomes distinct. A zero-test run does not prove readiness. Never claim cross-published Windows/macOS binaries ran on Linux. Preserve unrelated user changes and do not push/publish a release without instruction.

## Mandatory CI coverage for future capabilities

`.github/workflows/ci.yml` runs shared tests, actual CLI/MCP processes and native self-contained executable checks on Linux, Windows and macOS. The stable aggregate check is `CLI and MCP required`; repository branch protection/rulesets must require it to block merging on failure. Workflows run on pushes and pull requests without path filters, using read-only repository permissions.

Every registered operation must have exactly one scenario in `tests/automation/capability_cases.json`, including valid arguments, meaningful result assertions and CLI/MCP comparison paths. The checker reads the compiled catalog through `--help --json`, checks MCP discovery/schema/permission parity, and executes every scenario through both transports. A new operation without a scenario fails CI. Reuse deterministic fixtures or extend the test-only `Meili.Automation.Host`; never add production command-line switches or environment variables that enable fake market data. Do not replace these checks with hard-coded tool counts or generic help-only tests.

UI-only changes still require a specific CLI/MCP applicability explanation in the PR template. CI cannot infer whether an unregistered desktop feature should have a new automation operation; reviewers must enforce that boundary. See `docs/09-CI与能力覆盖.md` for local reproduction and required-check setup.

## Windows and macOS distributions

CLI and MCP must remain supported on Windows x64/ARM64 and macOS Intel/Apple Silicon. CI must build the actual platform packaging scripts, verify archive checksums, bundled runtime, executable architecture and OS-specific MCP examples, extract to a path containing spaces, and run CLI/MCP against the extracted executable on native runners. Retain downloadable CI artifacts without publishing a Release automatically. Do not replace native execution with cross-compilation or silently remove ARM64 jobs to get a green check. PowerShell scripts containing non-ASCII paths must preserve UTF-8 BOM for Windows PowerShell 5.1. Keep platform startup/configuration instructions in docs/12-Windows与macOS的CLI和MCP.md current.

## Embedded news reader

News article opening is desktop-only: Windows uses the installed Evergreen WebView2 runtime; macOS hosts the system WKWebView. Do not bundle Chromium/Cef or add browser dependencies to Application, CLI or MCP. Keep article navigation HTTP/HTTPS-only (including redirects and popups), without credentials, native JavaScript bridges, automatic external protocol dispatch, permission grants or downloads. Preserve an explicit external-browser fallback and localized initialization/load errors. CLI/MCP `get_news` continues returning article metadata and URLs; it must not create desktop windows. Run the native browser smoke host on Windows x64/ARM64 and macOS Intel/Apple Silicon when changing the reader. Headless tests do not validate native engine behavior.

## TradingView K-line rendering

Desktop K-lines use bundled TradingView Lightweight Charts in system WebViews. Keep the upstream version, npm integrity, script hash, Apache license/NOTICE and visible TradingView attribution. Do not claim Advanced Charts/Pine/TradingView market data are included. Indicator values must come from shared Analytics, with finite JSON and explicit gaps for incomplete bars; do not reimplement business indicators in JavaScript. Keep chart navigation confined to its tokenized loopback document and its event protocol bounded/typed; remote news pages must never gain chart privileges. Dispose the listener and browser when the page detaches. Preserve zoom, theme, conventions, source/adjustment metadata, comparisons and saved drawings. Changing the renderer requires actual Chromium interaction tests and Windows/macOS x64/ARM64 native WebView tests; headless screenshots alone do not prove charts rendered. New business indicators still need CLI/MCP consideration and operation coverage.

## UI/UX consistency

Use the existing ThemePalette and live resource brushes for all app-owned chrome, including WebView wrappers and bundled HTML. Match the tokenized 15px body/12px caption typography, 8px controls, 8/12px spacing, semantic status backgrounds, and keyboard focus cues. Test live dark/light and locale changes while windows remain open, empty/loading/error visibility, and compact layouts without hiding required attribution. Remote publishers own their article content; theme the reader chrome without injecting styles/scripts into remote news. UI-only styling does not add CLI/MCP business operations; preserve their contracts and lean packages.

## Let the interface teach

Apply this to every new or changed desktop page, dialog and bundled WebView. Users should discover the next action and understand its effect through the interface. Keep the default view focused on the current task, with little explanatory prose.

- Teach through clear hierarchy, familiar controls, descriptive action labels, sensible defaults and visible results. Use layout and interaction to make the workflow apparent; do not add a paragraph to compensate for an unclear control or sequence.
- Show relationships directly: selecting a contract highlights the matching strategy leg; changing a parameter updates the chart; selecting an event highlights its marker and reveals its details. Prefer a small annotated example or preview when it makes an unfamiliar operation easier to learn. Label sample data clearly and never present it as live data.
- Reveal complexity progressively. Keep the primary action and essential inputs visible; place advanced settings, definitions, formulas and detailed provenance behind labeled expanders, an information button or contextual help. Avoid permanent tutorial panels, introductory essays and repeated instructions on working pages.
- Keep copy brief and actionable. Prefer a short label, one concise hint at the point of need, and a concrete recovery action for errors. Empty states should offer the first useful action; loading, success and failure should be apparent beside the affected control or result.
- Keep decision-critical meaning visible: units, price basis, delayed/stale or missing data, estimated/unverified dates, unsaved changes and consequential actions. Use compact labeled badges or adjacent values, with details available on demand. Reduce repetition without hiding uncertainty, required attribution or information needed to interpret a financial result.
- Keep controls discoverable and accessible. Pair unfamiliar icons with short labels; use consistent placement, selection states and keyboard focus. Do not rely on color, hover tooltips, animation or an onboarding tour as the only way to understand or operate a feature. Contextual help must work with keyboard focus and click/tap.
- Explain user tasks in the product. Keep architecture, implementation details, protocol names and developer troubleshooting in documentation or diagnostic views unless they help the user make an immediate decision. This presentation rule does not remove structured metadata or useful CLI help/MCP descriptions.

For UI review, walk through the main task as a first-time user: can they identify where to start, predict an action, see its result and recover from an error without reading a page of instructions? Remove redundant prose and improve the control or interaction that needed it. Check the result in both languages, themes and compact layouts; verify that essential labels and states remain understandable. This is a review criterion, not a requirement to add automated tests for every copy change.

## Linked strategy workbench

The strategy workbench and detailed tab share one StrategyViewModel; dispose hidden WebViews and never start a duplicate market/alert loop. Keep entry reference selection in Application/OptionEntryReference, shared by desktop and get_option_chain. Missing/crossed quotes must not become invented executable prices; expose midpoint/last/missing basis. Preserve recorded entry premiums across refreshes and calculate all payoff/Greeks in Analytics, not JavaScript. Reject stale draft identities and cross-underlying additions. Keep the existing detailed analysis and local saving usable. Browser tests must exercise the real test-only C# host, and native Windows/macOS x64/ARM64 checks must load the actual workbench. Test fixture hosts must never be referenced by production projects.

## Market event timeline

Keep desktop timeline, CLI events and MCP get_market_events on Application/MarketTimelineService. Preserve original publication timestamps, date-only dates/ranges, explicit estimate/confirmation provenance, per-type availability and provider timestamps separately from observation time. Never manufacture midnight timestamps, historical coverage or confirmation from past dates. Keep chart alignment separate from original event time; do not plot events on earlier intraday bars or invent future candles. Article gestures carry only current chart identity and event ID; resolve the current symbol's validated URL in C#, never accept arbitrary front-end URLs. Maintain the catalog scenario, actual C# browser interaction tests and all four native WebView architecture checks when changing timeline behavior.

## Desktop-to-MCP coverage inventory

Review `tests/automation/desktop_capabilities.json` whenever a desktop capability changes. Every shared view-model file and RelayCommand must map to existing business operations or have a specific UI-only/ownership/security explanation. The real-process coverage checker validates this inventory against source and the compiled catalog, then executes every catalog scenario through CLI and MCP. New files/commands or stale tool references must fail CI. This mechanical check cannot infer new behavior inside an existing method or property: reviewers must also assess calculations, data, settings and persistent state changes. Never equate registered-tool scenario coverage with complete desktop coverage.

PricingAssumptions, SafeData, IvSource and VolatilityInsights now live in Application; their existing Meili.Shared.Services namespace is retained for source compatibility, with no Shared/UI assembly dependency. Reuse these services and Analytics for automation. IV/OI recording is an explicit write operation; read-only insights use existing local history without fabricating past observations. Drawings use SnapshotFile like other shared JSON stores. Preference patches must stay allowlisted and preserve omitted values, never return/accept proxy URLs or credentials, and state when process/desktop restart is needed. Keep continuous alert ownership and native notifications in the desktop.

## Desktop delivery and AI connection setup

Native four-architecture desktop CI must package and extract the actual GUI together with its self-contained automation executable, check architecture/checksums/resources, launch the extracted GUI, verify its connection button/clipboard and bundled chart, then exercise the extracted CLI/MCP. Keep these jobs required and retain downloadable artifacts; never silently replace package execution with source builds. CI macOS ad-hoc signing is not Developer ID signing or notarization; Windows CI packages are unsigned. Do not publish releases or claim trusted distribution signatures without the corresponding workflow and credentials.

Keep AI connection templates in Application/McpConnectionSetup. Resolve the bundled executable and current desktop data directory explicitly; quote POSIX/PowerShell paths safely and validate JSON/TOML including non-BMP Unicode. The UI copies user-executed setup commands or read-only MCP templates; it never executes them or modifies another tool's configuration. Missing CLI must disable connection copying visibly. Do not expose clipboard/setup actions as business MCP tools; record the presentation exception in the desktop inventory. Avoid a wall of setup prose: one primary universal prompt copy action, compact client cards/status and an expandable section for manual templates.

## Companion skill and client setup commands

Keep `skills/easysellput-local/SKILL.md` usable by both Codex and Claude Code and embed the same content in Application for the CLI installer. `install-skill` is a CLI-only, explicitly invoked setup action, never an MCP tool. Restrict its destination to the known client skill subdirectory inside the user profile or an explicitly chosen project. Install atomically, preserve custom content, reject linked destinations and report conflicts. Only exact known hashes of previously bundled skills may be upgraded automatically, with a unique backup and explicit updated status; never upgrade edited user skills. Test native published binaries using temporary project directories, not the user's actual skill folders.

The desktop offers one harness-neutral configuration prompt from settings and the bottom MCP status button, plus short client-specific `connect codex` / `connect claude-code` commands; it never executes them. Keep prompt generation shared in McpConnectionSetup. The user-invoked connect command checks client/version, conflicts and actual read-only MCP before skill installation/official client registration; --replace must be explicit and scoped to the named user connection. Default MCP is read-only; the skill is workflow guidance, not permission escalation. Keep Claude stdio/user registration and Codex registration distinct, preserve safe shell quoting, and validate both buttons/clipboard in native package checks. Cover client installation/reconnection requirements in documentation, not long permanent UI instructions. Existing JSON/TOML alternatives remain MCP-only for manual client configuration.

CI must compare the companion skill tool guide against the compiled OperationCatalog: every tool needs exactly one useful guide entry with matching read/write access. Add or update the skill when adding, renaming, removing or changing permission semantics of a tool. Preserve live schema discovery; this inventory does not replace executable CLI/MCP scenarios or semantic review of workflow guidance.

## Chart-first workspace

Keep symbol/actions and interval selection in a compact top toolbar, drawing tools at the left, and optional indicator/comparison settings in a scrollable inspector. The chart owns the remaining space; never restore large page introductions or permanently expanded parameter forms above it. Keep events/news in a permanent right sidebar with an outer icon rail for activity, news and calendar. Preserve its position in compact panes; adapt width rather than collapsing it or moving it below the chart. Rail actions must operate on existing event filters, with visible labels, selection and keyboard focus. Keep source, adjustment basis, material warnings and attribution visible. Test the minimum desktop window in both languages and themes; verify drawing selection and inspector state without introducing new MCP window-control tools. Shared Claude-inspired warm neutral ThemePalette tokens must also match first-frame resources and embedded WebView fallbacks.

## Required screenshots for UI changes

For every future UI change, capture and inspect screenshots of the actual changed interface and include representative screenshots inline in the final user-facing response (or provide directly accessible image links when inline rendering is unavailable). Describe the visible change briefly; do not substitute a textual description, a mockup, or a build link for screenshots. Capture the affected screen and relevant expanded/selected/error states; include before/after views when available and useful. For changes spanning themes, languages or compact layouts, verify those variants and show representative views. Use temporary test data and avoid exposing user secrets or personal data.

State the capture environment and whether data is a fixture when material. A headless native-shell screenshot does not demonstrate a rendered system WebView: include actual browser/native WebView captures for changed embedded content. If capture is technically blocked, report the specific limitation and what visual verification remains incomplete; never present an invented image as the application. Screenshot capture is desktop presentation work and does not require a new CLI/MCP business operation.

Keep related toolbar controls on one row when space permits; avoid forced line breaks between symbol, intervals and actions. In compact layouts use bounded, keyboard-accessible overflow for long interval selectors rather than hiding actions or wrapping into permanent extra rows. Review neighboring pages for unnecessarily separated strips; keep semantic grouping and only wrap when available width requires it.

## macOS menu bar quotes

The native NSStatusItem is a presentation subscriber of the existing QuoteHub/QuotePump. Do not start a second quote timer, alert monitor or pricing algorithm. Follow the shared SymbolContext, clear another symbol's price immediately when switching, and unsubscribe/dispose native targets, menus and status items on exit. Keep source, declared delay/unknown timing, original market time, missing prices and failed/stale refreshes honest; regular/close and extended-session prices must stay separately labelled. Missing change is not zero. Native menu actions hide/show/navigate locally; underlying quotes/watchlists remain available through existing CLI/MCP operations rather than exposing OS window control. Validate AppKit target/action, both CPU ABIs (including x64 structure returns), recreation and actual native button screenshots on Intel and Apple Silicon CI.

## MCP connection status and universal handoff

Show actual local initialized MCP sessions scoped to the desktop data directory, with read-only/write mode distinguished. Never equate copied/saved configuration, setup verification probes, a fresh process, or market source health with an active AI session. Ignore stale or exited/reused process records and show unknown if diagnostics cannot be read. Runtime heartbeat files are diagnostics, never permissions. Clean up on exit; process identity/expiry handle crashes. The status button copies the same client-neutral setup prompt as settings with explicit clipboard success/failure. Include literal executable/arguments/data directory, official client discovery, conflict preservation, read-only verification, and resource-based skill installation with an unsupported-client fallback; do not assume every harness implements the same commands, config path or skill format. Test real MCP lifecycle and clipboard failures, and capture the actual status bar.

News chronology uses original publication dates in America/New_York, never aligned chart bars or observation timestamps. Keep date-only/range and unknown dates explicit. The segmented history rail indexes only loaded groups, shares the list's independent scroll viewport, follows filters/scroll/keyboard navigation and preserves reading position on same-chart updates. Do not imply full historical news coverage or add MCP window-scroll tools for this presentation feature.

Icon-only buttons must use symmetric padding and explicit horizontal/vertical content alignment. Reuse the desktop Icon style/fixed glyph frame; prefer vector geometry over font-dependent theme glyphs. Check actual content and geometry bounds in both themes/locales, including hover/focus, without centering deliberately left-aligned disclosures or menus.

Intraday extended-session backgrounds use Core/MarketClock classification in C#, ThemePalette tints and Lightweight Charts pane primitives. Paint from actual bar timestamps and spacing on every pane, preserving zoom/pan and leaving daily/weekly/monthly views unshaded. State the standard US Eastern schedule, bar-start aggregation basis and unmodelled early closes in accessible legend details; never imply a complete exchange calendar or synthesize prices/empty-session bars for shading. Include actual Canvas and native pane regression checks when changing this feature.

## Signed desktop updates

Keep update discovery/download/installation in Application plus desktop lifecycle ownership. Only the fixed official stable Release feed is accepted: pinned ECDSA manifest, exact version/RID/name/size/SHA-256, bounded downloads and HTTPS redirect hosts. Never add a production fake feed, public-key override, checksum bypass or MCP self-modification/process-execution tool. CLI update check/download are explicit local maintenance exceptions; document them and keep business MCP contracts unchanged.

A helper copied outside the install tree must complete all preflight before signalling normal GUI shutdown, then wait for the exact parent process to exit. Preserve portable data and external profiles, use same-volume rename with reverse rollback, retain backups/staging on failures, and never delete data to force a swap. Reject active MCP/other installed instances, unsafe zip paths/links and incompatible architecture/downgrades. Do not elevate or bypass OS trust checks. Test actual native package extraction/swap/relaunch on all four desktop architectures. Record that a spawned process is not a complete post-launch health guarantee.

Update release workflow is manual and draft-only, selecting successful trusted CI push artifacts. Signing private keys stay outside Git in the maintainer's backup and Actions secret; verify against the pinned public key before any draft. The initial development pin must be replaced through setup-update-signing.py before the first official client release. Never claim a feed is operational or a release trusted/published until the key, CI and explicit publication steps are actually complete.

## Workspace navigation and personal websites

Keep both desktops on one Discord-style narrow navigation rail: built-in pages and personal websites share the same rail. Do not restore an adjacent wide text-menu column. Keep localized accessible names/tooltips, one selected entry, vector icons, keyboard shortcuts and scroll access at minimum window size. Settings, language, theme and motion utilities belong in the bottom status bar, outside the navigation rail. Use the pinned Lucide subset, preserve its 24×24 canvas, 2px rounded strokes, checksum/provenance and bundled ISC/MIT notices; do not stretch individual ink bounds or replace icons with font glyphs. Footer actions share centered 28×24 hit areas and 18px icon frames on both platforms. Website metadata and motion preferences are desktop presentation state in web-workspace.json, protected by SnapshotFile. Preserve tab identity/order, validate bounded names and HTTP/HTTPS addresses without credentials, and never overwrite corrupt or conflicting state. Only create browser views on first visit; keep hidden tabs attached to preserve sessions/history and dispose removed tabs and all views at shutdown. Switching away from market pages must still deactivate their chart listeners normally.

Remote tabs reuse system WKWebView / WebView2 with no chart token, host objects or web-message bridge. Keep redirect/popup protocol checks, denied permissions and downloads, explicit external opening and visible load failures. Store only bookmark metadata, not browser history or credentials; browsing sessions are ephemeral. No arbitrary-URL browser execution, cookie/session or UI navigation tools belong in MCP/CLI. Record this presentation exception in desktop_capabilities.json.

Animate only small app-owned chrome with short, interruptible easing; do not translate/fade native WebView surfaces, run frame timers, or animate full-page layout. Honor system reduce-motion settings plus the local user toggle. Keep keyboard focus, tooltips/names and visible selected indicators in both themes/languages. Exercise persistence/conflicts and real tab switching/history/security in native four-architecture browser smoke, and provide actual shell screenshots.

## Drawing interaction and button families

Chart toolbar inputs and action buttons share 32px height; drawing tools share explicit 56×56 bounds, symmetric padding and centered content across Button/ToggleButton on both platforms. Check actual control and ink bounds; do not rely on font chevrons or different default templates to align themselves.

Drawing gestures belong only to the price pane, with a visible first point/preview, Esc cancellation, automatic return to pan after completion, and line selection/edit/single deletion. Preserve rapid consecutive clicks, distinguish drags, and reject equal-time trend endpoints. Keep plot overlays aligned through zoom/pan, pane resizing and theme changes. Bind queued drawing gestures to the current chart/tool epoch; an old canceled gesture must not affect a newly selected tool.

Single-line edits/deletions use ChartDrawingStore validation, absolute zero-based indices and an explicit drawing revision, plus SnapshotFile cross-process protection. Never overwrite stale edits or implement delete by clearing/re-adding a collection. Desktop, CLI and MCP must expose the same mutations; preserve read-only MCP enforcement and update the companion skill/scenarios. Actual Chromium pointer regression and all four native WebViews must remain in CI.


## Reusable Claude-inspired design system

`src/Meili.Shared/DesignSystem/tokens.json` is the only source for UI palette, typography roles, radii, spacing, control sizes and motion timing. Run `python3 build/generate-design-system.py` after editing it; CI checks generated native/CSS resources. Official reference observations are in `research.json` and docs/34-Claude设计系统.md. Preserve readable financial/status semantics separately from decorative brand colors.

New pages must use the shared primitive styles and `AppCard`, `AppSelect`, `AppHelp`, `AppPopover`, `AppDisclosure`, `AppDrawer`, `AppDialog`, `AppLoading`. Do not copy Button/ToggleButton/Input templates or hard-code page colors/fonts. WPF component templates live in DesignSystem/Components.xaml; Avalonia variants in DesignSystem/Components.axaml; embedded HTML uses design-tokens.css plus components.css. Compose existing primitives for business-specific content; keep only data-specific row/plot behavior near the page. Use the shared typography roles (editorial serif headings, sans UI, tabular financial numbers, mono code); never download fonts at runtime. Keep the bundled OFL notices/checksums and explicit proprietary-font fallback behavior.

Cover normal/hover/pressed/checked/disabled/focus/error states. Keep 32px compact controls, 28×24 footer actions and 56×56 drawing tools; align full Lucide canvases. Drawers close on Esc and return focus to the trigger; modal forms keep owner, explicit actions, keyboard cancellation and validation. Loading is indeterminate; reduced motion shows a static activity marker without invented completion percentages. Reuse `DesignMotion` and short interruptible chrome feedback; honor system/local reduce-motion settings in native components and embedded CSS. Never animate native WebView surfaces or market chart layout.

When adding or changing a component, extend the actual component-gallery regression, inspect both themes/locales and relevant expanded/error states, and capture representative real screenshots. Keep native four-architecture package/WebView tests and existing CLI/MCP capability coverage; presentation infrastructure does not create new business MCP tools.


## UX acceptance and feedback policy

Use docs/35-全页面UX审计与验收.md and its component/journey catalog for every cross-page UX change. Keep routine work in the main flow, definitions behind click/keyboard-accessible AppHelp, advanced fields in AppDisclosure, and preserve their values when collapsed. Visible context actions must supplement double-click/right-click shortcuts. Prevent busy-action reentry and disable inert selection actions; errors reveal the relevant hidden field, retain input and explain recovery.

Every operation needs perceptible feedback, not a compulsory decorative animation. Use the shared pointer/keyboard/reduced-motion policy and short local entry effects. Native popup/exit behavior is sufficient when the system provides it. Never animate price numbers, mutate missing changes to zero, interpolate market values, animate full pages/WebViews or delay cancellation for an exit effect. A copied prompt is not an active MCP connection. Only newly added strategy rows/details enter; periodic data refresh must not replay them or steal focus. Cancel active chrome motion when reduced motion changes and keep weak references/lifecycle cleanup; no per-frame business timers.

Acceptance includes the four theme/language/compact scenes, explicit expanded/error/focus states, real Chromium/.NET journeys, native WPF UX tests in CI and native four-architecture packaged execution. Record what passed and what needs real user or hardware observation; do not claim measured learning/latency improvements from source inspection or fixture screenshots alone.

Use AppHelp for explanatory text: a Lucide help icon with complete localized hover/focus tooltip and click/keyboard access. Do not introduce full-width help expanders. Use AppPopover for compact secondary controls (e.g. option columns, alert advanced fields), with tooltips describing the trigger, retained bindings, Escape/focus return and reduced-motion feedback. Interactive settings never belong in a tooltip; long reading content may retain a labelled disclosure.
