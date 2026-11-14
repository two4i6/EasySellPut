using Meili.Automation;
using Meili.Automation.Tests;

// Test-only executable: real CLI/MCP adapters and official SDK, deterministic market data.
// This host is never shipped in the production distribution.
return await Meili.Cli.Program.RunAsync(args, directory => new AutomationService(directory, new FakeMarket(), [new FixtureProbe()]));

sealed class FixtureProbe : Meili.Core.Abstractions.IQuoteProvider
{
    public string Id=>"fixture";
    public string DisplayName=>"Offline fixture probe";
    public Meili.Core.Models.DataCapability Capabilities=>Meili.Core.Models.DataCapability.Quote;
    public Task<IReadOnlyList<Meili.Core.Models.Quote>> GetQuotesAsync(IReadOnlyList<string> symbols,CancellationToken ct=default)=>Task.FromResult<IReadOnlyList<Meili.Core.Models.Quote>>([new(){Symbol="AAPL",Price=100,Source="fixture"}]);
}
