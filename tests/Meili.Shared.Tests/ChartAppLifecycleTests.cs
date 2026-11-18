using Meili.Automation;
using Meili.Automation.Modules;
using Meili.Core.Models;
using Meili.Core.Settings;
using Meili.Shared.Services;
using Meili.Shared.ViewModels;
namespace Meili.Shared.Tests;
[Collection(nameof(UiPlatformCollection))]
public sealed class ChartAppLifecycleTests : IDisposable
{
    private readonly string directory=Path.Combine(Path.GetTempPath(),"chart-domain-"+Guid.NewGuid().ToString("N"));
    private ChartsViewModel? vm;
    [Fact] public async Task Active_chart_pins_domain_and_hidden_gestures_cannot_write_after_uninstall()
    {
        Ui.Platform=new FakeUiPlatform();var settings=new SettingsStore(directory);
        var data=new PricingSnapshotTests.SnapshotData{Bars=new(){Symbol="AAPL",Source="fixture",Interval=BarInterval.Day1,Bars=[Bar.CloseOnly(DateTimeOffset.UtcNow.AddDays(-1),100,10)]},News=(_,_)=>Task.FromResult<IReadOnlyList<NewsItem>>([])};
        var drawings=new ChartDrawingStore(directory);
        vm=new(new WatchlistStore(settings),data,new LocalizationService(),new SymbolContext(),settings,drawings,applications:new ChartAppClient(directory));
        await vm.ActivateAsync();Assert.NotNull(vm.Series);
        var installer=new ModuleInstaller(directory);
        Assert.Throws<IOException>(()=>installer.Uninstall(ModuleAccess.Charts));
        vm.StartDrawingCommand.Execute(DrawingKind.HorizontalLine);Assert.True(vm.AddDrawingPoint(DateTimeOffset.UtcNow,101));
        var bytes=File.ReadAllBytes(drawings.FilePath);
        vm.Deactivate();
        File.WriteAllText(Path.Combine(directory,"apps","registry.json"),System.Text.Json.JsonSerializer.Serialize(new ModuleRegistryState(1,1,[],[ModuleAccess.Charts]),new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)));
        Assert.False(ModuleNavigation.IsAvailable(directory,AppPage.Charts));
        Assert.True(ModuleNavigation.IsAvailable(directory,AppPage.Options));
        vm.EditDrawing(0,null,null,vm.DrawingRevision);vm.ClearDrawingsCommand.Execute(null);
        Assert.Equal(bytes,File.ReadAllBytes(drawings.FilePath));
        await vm.ActivateAsync();Assert.NotEmpty(vm.StatusText);Assert.Equal(bytes,File.ReadAllBytes(drawings.FilePath));
    }
    [Fact] public async Task Hidden_symbol_navigation_reloads_after_verification_instead_of_showing_old_series()
    {
        Ui.Platform=new FakeUiPlatform();var settings=new SettingsStore(directory);
        var data=new PricingSnapshotTests.SnapshotData{Bars=new(){Symbol="AAPL",Source="fixture",Interval=BarInterval.Day1,Bars=[Bar.CloseOnly(DateTimeOffset.UtcNow.AddDays(-1),100,10)]},News=(_,_)=>Task.FromResult<IReadOnlyList<NewsItem>>([])};
        var context=new SymbolContext();context.Set("AAPL");
        vm=new(new WatchlistStore(settings),data,new LocalizationService(),context,settings,new ChartDrawingStore(directory),applications:new ChartAppClient(directory));
        await vm.ActivateAsync();Assert.Equal("AAPL",vm.Series!.Symbol);vm.Deactivate();
        context.Set("QQQ");data.Bars=data.Bars with{Symbol="MSFT"};await vm.OpenSymbolAsync("MSFT");Assert.Equal("MSFT",context.Current);Assert.Equal("AAPL",vm.Series.Symbol);
        await vm.ActivateAsync();Assert.Equal("MSFT",vm.Series.Symbol);
    }
    [Fact] public async Task Corrupt_registry_blocks_native_activation_without_repair_or_market_load()
    {
        Ui.Platform=new FakeUiPlatform();var settings=new SettingsStore(directory);
        var registry=Path.Combine(directory,"apps","registry.json");Directory.CreateDirectory(Path.GetDirectoryName(registry)!);File.WriteAllText(registry,"{");
        vm=new(new WatchlistStore(settings),new PricingSnapshotTests.SnapshotData(),new LocalizationService(),new SymbolContext(),settings,new ChartDrawingStore(directory),applications:new ChartAppClient(directory));
        await vm.ActivateAsync();Assert.Null(vm.Series);Assert.NotEmpty(vm.StatusText);
        Assert.False(ModuleNavigation.IsAvailable(directory,AppPage.Charts));Assert.Equal("{",File.ReadAllText(registry));
    }
    public void Dispose(){vm?.Deactivate();if(Directory.Exists(directory))Directory.Delete(directory,true);}
}
