using Meili.Automation;
using Meili.Automation.Tests;

// Test-only executable: real CLI/MCP adapters and official SDK, deterministic market data.
// This host is never shipped in the production distribution.
return await Meili.Cli.Program.RunAsync(args, directory => new AutomationService(directory, new FakeMarket()));
