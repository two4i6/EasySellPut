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
