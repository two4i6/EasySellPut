# Market liquidity core — S13a

This core-only first-party app preserves the existing `get_market_liquidity` contract. The signed adapter owns the operation entrypoint; the host supplies the existing bounded MarketLiquidityService and Analytics projections directly, without redispatch or duplicated FRED/ETF connections, timers, math or cache stores. This is the compatibility boundary, not yet complete independent financial-domain ownership.

Build using the shared, existing lock-pinned esbuild toolchain (no host build):

```sh
npm ci --prefix web/qqq-gex --no-audit --no-fund
node web/app-sdk/build-engine.mjs web/market-liquidity/runtime/report.mjs web/market-liquidity/runtime-dist/report.mjs
python3 build/pack-app.py --app market-liquidity --development --repository two4i6/EasySellPut --output build/out/liquidity-core.espapp
```

Development packages use ephemeral test trust and cannot be installed by production configuration. Release packages need the existing publisher key and shared ModuleInstaller. There is no new installer, runtime, quote stream, write tool or data migration. Once installed, the CLI/MCP facade dispatches the authenticated operation; explicit disable/uninstall suppresses compatibility fallback. Without an installed/suppressed package the existing built-in operation remains available.

Native liquidity UI now resolves its report through LiquidityAppClient, reusing the exact same signed operation/shared service and existing controls/cancellation. The shared main-only Apps release workflow now version-checks GEX and liquidity sequentially and promotes each tested artifact into the same separate signed catalog. Manual recovery selects one app. Fixed-host CLI/persistent-MCP A/B, uninstall/reinstall and retained-data tests cover this core. Final native exact-commit CI and production signing setup remain required; do not claim production installation or complete S13 acceptance before those pass.
