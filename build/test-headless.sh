#!/usr/bin/env bash
# Cross-platform shared libraries, Avalonia headless UI, CLI and actual MCP protocol.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
source "$root/tools/env.sh"
cd "$root"
python3 build/prepare-app-seed.py --if-current
node --test web/app-sdk/engine.test.mjs web/app-sdk/client.test.mjs web/app-sdk/engine-host.test.mjs web/app-sdk/presentation.test.mjs
mkdir -p build/out/tests
results=$(mktemp -d "$root/build/out/tests/run-XXXXXXXX")
export MEILI_RENDER_DIR="$results/render"
mkdir -p "$MEILI_RENDER_DIR"
failed=0
if ! (
  set -e
  node web/app-sdk/build-engine.mjs web/options-strategy/runtime/report.mjs web/options-strategy/runtime-dist/report.mjs
  python3 build/pack-app.py --app options-strategy --development --repository test/source --output "$results/options.espapp"
  python3 tests/automation/options_app_smoke.py --archive "$results/options.espapp" --public-key "$results/options.espapp.public.pem" --repository test/source
) > "$results/options-core.log" 2>&1; then failed=1; fi
cat "$results/options-core.log"
if ! (
  set -e
  node web/app-sdk/build-engine.mjs web/news-fundamentals/runtime/report.mjs web/news-fundamentals/runtime-dist/report.mjs
  python3 build/pack-app.py --app news-fundamentals --development --repository test/source --output "$results/news.espapp"
  python3 tests/automation/news_app_smoke.py --archive "$results/news.espapp" --public-key "$results/news.espapp.public.pem" --repository test/source
) > "$results/news-core.log" 2>&1; then failed=1; fi
cat "$results/news-core.log"
if ! (
  set -e
  node web/app-sdk/build-engine.mjs web/market-liquidity/runtime/report.mjs web/market-liquidity/runtime-dist/report.mjs
  python3 build/pack-app.py --app market-liquidity --development --repository test/source --output "$results/liquidity.espapp"
  python3 tests/automation/liquidity_app_smoke.py --archive "$results/liquidity.espapp" --public-key "$results/liquidity.espapp.public.pem" --repository test/source
) > "$results/liquidity-core.log" 2>&1; then failed=1; fi
cat "$results/liquidity-core.log"
for name in Core Data Analytics Shared Mac Automation; do
  if dotnet test "tests/Meili.$name.Tests/Meili.$name.Tests.csproj" -m:3 --filter 'Category!=Live' --logger "trx;LogFileName=$name.trx" --results-directory "$results" -v minimal > "$results/$name.log" 2>&1; then
    tail -n 4 "$results/$name.log"
  else
    tail -n 45 "$results/$name.log"
    failed=1
  fi
done
if dotnet build tests/Meili.Automation.Host/Meili.Automation.Host.csproj -c Release -m:3 -v minimal > "$results/cli-build.log" 2>&1; then
  if ! python3 -m unittest discover -s tests/automation -p "test_*.py" -v > "$results/coverage-guard.log" 2>&1; then failed=1; fi
  cat "$results/coverage-guard.log"
  if ! python3 tests/automation/check_capability_coverage.py --report "$results/capability-coverage.json" > "$results/capability-coverage.log" 2>&1; then failed=1; fi
  cat "$results/capability-coverage.log"
  if ! python3 tests/automation/cli_mcp_smoke.py --dll src/Meili.Cli/bin/Release/net10.0/easysellput.dll > "$results/cli-mcp.log" 2>&1; then failed=1; fi
  cat "$results/cli-mcp.log"
  if ! python3 tests/automation/cache_management_smoke.py > "$results/cache-management.log" 2>&1; then failed=1; fi
  cat "$results/cache-management.log"
  if ! dotnet build tools/Meili.AppDev/Meili.AppDev.csproj -c Release -m:3 -v minimal > "$results/app-dev-build.log" 2>&1; then failed=1; fi
  if ! python3 build/pack-app.py --development --repository test/source --output "$results/dev-app.espapp" > "$results/app-dev-package.log" 2>&1; then failed=1; fi
  if ! python3 tests/automation/app_dev_smoke.py --archive "$results/dev-app.espapp" --public-key "$results/dev-app.espapp.public.pem" > "$results/app-dev.log" 2>&1; then failed=1; fi
  cat "$results/app-dev.log"
  if ! python3 tests/automation/app_mcp_update_smoke.py > "$results/app-mcp-update.log" 2>&1; then failed=1; fi
  cat "$results/app-mcp-update.log"
  if ! python3 build/pack-app.py --development --repository test/source --ui-dir web/qqq-gex/dist --output "$results/gex-pilot.espapp" > "$results/gex-pilot-package.log" 2>&1; then failed=1; fi
  if ! python3 tests/automation/news_mcp_smoke.py > "$results/news-mcp.log" 2>&1; then failed=1; fi
  if ! python3 tests/automation/options_mcp_smoke.py > "$results/options-mcp.log" 2>&1; then failed=1; fi
  cat "$results/news-mcp.log"
  if ! python3 tests/automation/liquidity_mcp_smoke.py > "$results/liquidity-mcp.log" 2>&1; then failed=1; fi
  cat "$results/liquidity-mcp.log"
  if ! python3 tests/automation/app_gex_operations_smoke.py --archive "$results/gex-pilot.espapp" > "$results/gex-pilot.log" 2>&1; then failed=1; fi
  cat "$results/gex-pilot.log"
  if ! python3 tests/automation/app_maintenance_smoke.py > "$results/app-maintenance.log" 2>&1; then failed=1; fi
  cat "$results/app-maintenance.log"
else
  cat "$results/cli-build.log"
  failed=1
fi
printf 'Results: %s\n' "$results"
exit "$failed"
