# App runtime architecture research evidence

Date: 2026-11-17. Product baseline: `b863eaa787a3467784f6a10569187738b231a879`.

These are bounded research observations, not implementation or acceptance of the proposed module system. No user data, installed applications or market credentials were used. Temporary profile directories were removed after the runs.

| File | Actual execution | Limits |
| --- | --- | --- |
| `current-probe.json` | Rebuilt production CLI and official SDK stdio: two permission modes, legacy protocol negotiation, shared-profile reload, CLI/MCP calculation parity and EOF. Existing automation fixture: queue and cancellation. | Fixture timing is a single Linux observation, not live market/native performance. |
| `stateless-probe.json` | Production CLI, no initialize handshake: `server/discover`, `tools/list` and a calculation using 2026-07-28 request metadata. | Does not validate the new subscription path or a real AI harness. |
| `sdk-probe.json` | Separate temporary .NET host using cached official ModelContextProtocol 2.4.0: mutable tool discovery, notifications and captured in-flight generation under two legacy protocols. | Simulates handler generations only; no product package activation, migration, filesystem lease or application update. |

Production build:

```sh
source tools/env.sh
dotnet build src/Meili.Cli/Meili.Cli.csproj -c Release --no-restore -m:3 -v minimal
dotnet build tests/Meili.Automation.Host/Meili.Automation.Host.csproj -c Release --no-restore -m:3 -v minimal
```

The one-off protocol drivers and SDK fixture were executed under `/tmp/easysellput-cli-mcp-research/` in the research workspace, outside the product solution and packages. Existing process helpers and the fixture host remain the starting point for permanent implementation tests. No production fake-data or trust override was added.

See [the CLI/MCP architecture report](../56-CLI与MCP优先的子应用运行架构.md) for methodology, decisions, source references and the implementation acceptance matrix. Full existing CI was not rerun for documentation; the report preserves the known baseline navigation failure.
