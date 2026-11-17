# EasySellPut

An ultra-lightweight market data terminal for Windows and macOS, with support for U.S. stocks and options strategies.

一款可在 Windows 和 macOS 上运行的超轻量级行情终端，支持美股及期权策略。

Current version: **0.6.0**

## Features

- Watchlists, quote overview, and K-line charts
- [US market liquidity](docs/52-市场流动性与行业热力图.md): experimental 0–100 funding-pressure gauge, six dated macro indicators and 11 sector ETF activity proxies (desktop, CLI and MCP)
- Options chain, implied volatility, and a linked multi-leg strategy/payoff workbench
- Price / IV alerts, news and fundamentals, and data-source status
- Chinese and English UI, light and dark themes
- Windows installer / portable builds, and a macOS portable app

Open **Strategy → Linked workbench** to add contracts, edit quantities and inspect payoff/Greeks without switching pages. Existing inputs and per-leg analysis remain under **Detailed analysis**. [使用与改造说明](docs/15-期权链与策略联动工作台.md)

## Build from source

Requirements: Windows 10+ (for the Windows app) or macOS 26+ (for the Mac app), and the repo-local .NET 10 SDK installed by the setup script (no admin rights required).

```powershell
# Windows: install the local toolchain, then build and test
powershell -ExecutionPolicy Bypass -File tools\setup-toolchain.ps1
powershell -ExecutionPolicy Bypass -File build\build.ps1 -Test
```

```powershell
# Run the Windows app with data kept inside the repo
powershell -ExecutionPolicy Bypass -File build\run-dev.ps1
```

Ordinary `dotnet build src/Meili.Cli` does not invoke npm or rebuild optional applications. Full desktop/package scripts explicitly prepare their bundled compatibility assets with `python build/prepare-app-seed.py --if-current` (Node/npm and Python required). Independently signed app artifacts are built with `build/pack-app.py`; see `TODO.md` for migration readiness.

Official releases use the main-only GitHub Actions signing/draft/publish flow in [the release guide](docs/44-GitHubActions主分支发布流程.md). Local or work-branch artifacts do not publish releases.

## CLI and MCP

Version 0.6.0 adds a local CLI and stdio MCP server for **Windows x64/ARM64 and macOS Intel/Apple Silicon**, with Linux support as well. They share the desktop market-data adapters and analytics; no GUI, Web server or separate .NET installation is required for self-contained packages.

```bash
easysellput quote AAPL MSFT --json
easysellput liquidity --json
easysellput strategy analyze --input analysis.json --json
easysellput mcp serve --data-dir /path/to/EasySellPut-data
```

[Windows/macOS quick start and MCP configuration](docs/12-Windows与macOS的CLI和MCP.md) covers native packages, PowerShell/Terminal commands and platform data locations.

MCP is read-only by default; `--allow-writes` enables registered local mutations. See [CLI / MCP usage and client configuration](docs/08-CLI与MCP使用说明.md) and [implementation tasks](docs/07-CLI与MCP改造任务.md).

On Unix, `bash build/test-headless.sh` runs shared libraries, headless UI and CLI/MCP process checks. `bash build/pack-cli.sh <rid>` creates a self-contained CLI/MCP archive under `build/out/cli`.

## Continuous integration

[GitHub Actions CI](.github/workflows/ci.yml) validates Linux/Windows/macOS CLI + MCP, every registered operation through both transports, and desktop headless regression. New operations without executable coverage fail CI. See [coverage and required-check setup](docs/09-CI与能力覆盖.md).

## Data location

Installed / normal mode stores settings under `%LOCALAPPDATA%\EasySellPut` on Windows, or `~/Library/Application Support/EasySellPut` on macOS. Portable builds keep data in a `data` folder next to the app. Existing folders from earlier names (`美丽稻谷终端` or `TyuStockApp`) are migrated automatically when possible.

## License

[MIT](LICENSE) © 2026 Carl Yu

This software is not investment advice. Market data comes from third-party public endpoints and may be delayed, interrupted, or incorrect. Follow each data source's terms; do not redistribute that data commercially.

股票最新价支持 [Yahoo 免费 Live WebSocket 与全应用共享订阅](docs/53-Yahoo免费Live与全应用行情订阅.md)，CLI 使用 `live`，MCP 使用 `get_live_quotes`。
