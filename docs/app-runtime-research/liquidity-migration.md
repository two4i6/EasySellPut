# S13 — Market liquidity migration

## S13a: compatibility core

The second app is `easysellput.market-liquidity`, versioned independently in `web/market-liquidity/app.json`. Its core-only package exports the existing read-only `get_market_liquidity` contract. Installed CLI/MCP discovery resolves its authenticated operation through the same registry, installer, runtime, job/asset leases and engine SDK as GEX. There is no second package manager, quote socket, provider router, data store or financial calculation implementation.

The first core is deliberately a compatibility adapter. It calls the existing bounded host MarketLiquidityService directly; that uses the existing FRED/ETF providers, managed caches, LiquidityProjection and Analytics math. There is no recursive public dispatch. The app does not fabricate dates, interpolate funding spreads, reclassify completed-day proxies as live flows, or fill unavailable pressure scores. The JSON report is passed through unchanged, including future-compatible optional values, provenance and explicit errors.

Only the explicitly owned built-in operation can be replaced. Permissions and schema must remain identical; a liquidity package cannot replace get_quotes or GEX tools, and another app cannot claim liquidity. Adding domain names does not grant arbitrary dispatcher access. Disabled/uninstalled apps disappear from CLI/MCP discovery and cannot resurrect their compatibility operation. Corrupt registry/app metadata is diagnosed rather than silently falling back to built-ins. Ordinary users without an installed or suppressed liquidity package retain the current built-in behavior.

## Build and checks

The existing `build/pack-app.py` now selects `--app market-liquidity`; both apps share the same manifest signing, hash table, platform/runtime pins and zip writer. The reusable SDK build tool uses the existing lock-pinned esbuild from the current toolchain; it bundles the SDK into the artifact, so execution has no dependency on the GEX app or node_modules. It does not compile the host.

`Apps · Build & Test` builds and packages both apps on Windows x64, macOS Intel/Apple Silicon and Linux x64, and executes the liquidity package's actual Node entrypoint against synthetic host replies. Its checks verify real ECDSA signature, complete signed file table, exact report/missingness, source-error propagation and invalid-argument rejection. These are fixture evidence, not live source completeness.

Application tests install signed liquidity A and B through the real installer/runtime, compare reports against actual shared fixture-backed MarketLiquidityService replies, and exercise disable/uninstall/reinstall plus foreign-operation/write escalation rejection. Existing complete capability cases already exercise `get_market_liquidity` through real CLI/MCP; no public operation or schema was added. GEX packaging is separately reverified after extracting the shared writer.

## Remaining acceptance boundaries

S13a+b are not complete S13 acceptance. Native liquidity now resolves the installed report through LiquidityAppClient, with the same existing MarketLiquidityService instance when host inputs are requested. Its signed execution/compatibility fallback respects disable/uninstall and corruption, propagates request cancellation and deserializes the existing report DTO. The view model retains its generation fencing, shared controls and refresh lifecycle. No UI styling or business algorithm changed. S13c must generalize release/catalog promotion beyond the current GEX selection and hold host files fixed across actual CLI/MCP/native package A/B updates. Production signing setup remains separate and incomplete; test keys are not installation trust overrides. No release or main merge is performed by this migration.

## Local evidence — S13a+b

1,060 .NET cases passed (two additional Windows-only skips), Python 75, SDK 9 and all 58 real CLI/MCP capability cases passed. Full-script maintenance tail and exact-commit native CI remain separately tracked. The actual signed liquidity engine and existing GEX archive smokes both passed. Images below are 1920×1080 Avalonia headless captures with synthetic provider data; they show existing native controls, not proof of installed production trust or live connectivity.

![Chinese light native-control fixture](screenshots/liquidity-core-zh-light-1080p.png)

![English dark native-control fixture](screenshots/liquidity-core-en-dark-1080p.png)
