using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Meili.Core.Settings;
using Meili.Mac.Platform;
using Meili.Mac.Views;

namespace Meili.Mac.Tests;

public sealed class QuoteCardAlignmentTests
{
    [AvaloniaTheory]
    [InlineData("zh-CN", true, 1920)]
    [InlineData("en-US", false, 1920)]
    [InlineData("zh-CN", false, 980)]
    [InlineData("en-US", true, 980)]
    public async Task Quote_header_symbol_source_and_action_share_one_center(string language, bool dark, int width)
    {
        MacHost.EnsureComposed();
        var loc=LocalizationService.Current;var original=loc.Language;
        var theme=AppServices.Get<MacTheme>();loc.Apply(language);theme.Apply(dark?AppThemeMode.Dark:AppThemeMode.Light);
        var page=new DashboardPage();var model=(DashboardViewModel)page.DataContext!;
        var window=new Window{Width=width,Height=1080,Content=page};
        try
        {
            window.Show();await model.ActivateAsync();MacHost.Pump();
            var sources=page.GetVisualDescendants().OfType<TextBlock>().Where(t=>t.DataContext is QuoteCardViewModel q && t.Text==q.SourceText && t.Parent is Border).ToArray();
            Assert.NotEmpty(sources);
            foreach(var source in sources)
            {
                var badge=(Border)source.Parent!;var row=(DockPanel)badge.Parent!;
                var symbol=row.Children.OfType<TextBlock>().Single();var action=row.Children.OfType<Button>().Single();
                double Center(Control c)=>c.TranslatePoint(new Point(0,c.Bounds.Height/2),row)!.Value.Y;
                Assert.InRange(Math.Abs(Center(source)-Center(badge)),0,1);
                Assert.InRange(Math.Abs(Center(symbol)-Center(action)),0,1);
                Assert.InRange(Math.Abs(Center(badge)-Center(action)),0,1);
            }
            MacHost.Save(window,$"quote-alignment-{language}-{dark}-{width}");
        }
        finally{model.Deactivate();window.Close();loc.Apply(original);theme.Apply(AppThemeMode.System);}
    }
}
