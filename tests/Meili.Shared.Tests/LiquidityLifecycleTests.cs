using Meili.Core.Abstractions;
using Meili.Core.Models;
using Meili.Shared.ViewModels;
namespace Meili.Shared.Tests;

[Collection(nameof(UiPlatformCollection))]
public sealed class LiquidityLifecycleTests
{
    private sealed class LateSource : ILiquiditySeriesSource
    {
        public readonly TaskCompletionSource Gate=new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls;
        public async Task<LiquiditySeries> GetSeriesAsync(string id,CancellationToken ct=default)
        {
            Interlocked.Increment(ref Calls);await Gate.Task; // Deliberately late provider: generation fencing must still work.
            return new(id,"percent","daily",[new(new DateOnly(2026,11,13),4)],"fixture","",null);
        }
    }
    [Fact]public async Task Hiding_cancels_the_request_and_late_data_cannot_repopulate_the_page_then_restore_can_retry()
    {
        Ui.Platform=new FakeUiPlatform();var source=new LateSource();var loc=new LocalizationService();var nav=new NavigationHub();
        var model=new LiquidityViewModel(new(source,new PricingSnapshotTests.SnapshotData()),loc,nav);
        var loading=model.ActivateAsync();
        try
        {
            using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(5));while(source.Calls<2)await Task.Delay(10,timeout.Token);
            model.Deactivate();Assert.False(model.IsBusy);source.Gate.TrySetResult();await loading;
            Assert.Empty(model.Metrics);Assert.Empty(model.Sectors);
            await model.ActivateAsync();Assert.Equal(6,model.Metrics.Count);Assert.Equal(11,model.Sectors.Count);
            Assert.All(model.Sectors,s=>Assert.Equal("—",s.Value)); // No false heat for missing bar series.
            NavigationRequest? selected=null;nav.Requested+=(_,request)=>selected=request;model.OpenSectorCommand.Execute("XLK");Assert.Equal("XLK",selected!.Symbol);
        }
        finally{source.Gate.TrySetResult();model.Deactivate();}
    }
    private sealed class RecoveringSource : ILiquiditySeriesSource
    {
        public bool Fail=true;
        public int Calls;
        public Task<LiquiditySeries> GetSeriesAsync(string id,CancellationToken ct=default)
        {
            Interlocked.Increment(ref Calls);
            if(Fail)throw new IOException("offline");
            return new Meili.Testing.LiquidityFixture().GetSeriesAsync(id,ct);
        }
    }
    [Fact]public async Task Failed_macro_report_retries_on_reentry_and_recovery_removes_the_problem_state()
    {
        Ui.Platform=new FakeUiPlatform();var source=new RecoveringSource();
        var model=new LiquidityViewModel(new(source,new PricingSnapshotTests.SnapshotData(),Meili.Testing.LiquidityFixture.Clock),new LocalizationService(),new NavigationHub());
        try
        {
            await model.ActivateAsync();Assert.False(model.HasMacro);Assert.False(model.HasPressure);Assert.True(model.ShowMacroProblem);Assert.Contains("IOException",model.MacroDiagnostic);
            model.Deactivate();source.Fail=false;
            await model.ActivateAsync();Assert.Equal(14,source.Calls);Assert.True(model.HasMacro);Assert.True(model.HasPressure);Assert.False(model.ShowMacroProblem);
        }
        finally{model.Deactivate();}
    }

}
