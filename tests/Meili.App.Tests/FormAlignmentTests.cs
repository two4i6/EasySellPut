using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Meili.App.Services;
using Meili.App.Views.Controls;
using Meili.App.Views.Pages;
namespace Meili.App.Tests;
public sealed class FormAlignmentTests
{
    private static double Center(FrameworkElement c,Visual root)=>c.TranslatePoint(new Point(0,c.ActualHeight/2),(UIElement)root).Y;
    private static T Ancestor<T>(DependencyObject node)where T:DependencyObject
    {
        for(var parent=VisualTreeHelper.GetParent(node);parent is not null;parent=VisualTreeHelper.GetParent(parent))if(parent is T found)return found;
        throw new InvalidOperationException(typeof(T).Name+" missing");
    }
    [Fact] public void Shared_form_headers_center_labels_help_and_fields_in_every_locale_theme_and_width()
    {
        WpfHost.Run(async()=>
        {
            foreach(var language in new[]{"zh-CN","en-US"})foreach(var dark in new[]{false,true})foreach(var width in new[]{980,1440})
            {
                ScreenRenderTests.Apply(language,dark);var page=new SettingsPage();using var host=new OffscreenHost(page,width,980);await ScreenRenderTests.Settle();
                var headers=UiAudit.Descendants<AppFormHeader>(page).ToList();Assert.Equal(12,headers.Count);
                foreach(var header in headers)
                {
                    var title=UiAudit.Descendants<TextBlock>(header).First(t=>t.Text==header.Title);var help=UiAudit.Descendants<AppHelp>(header).Single();
                    Assert.InRange(Math.Abs(Center(title,host.Root)-Center(help,host.Root)),0,1);
                    var card=Ancestor<AppCard>(header);FrameworkElement? field=UiAudit.Descendants<ComboBox>(card).FirstOrDefault();field??=UiAudit.Descendants<TextBox>(card).FirstOrDefault();
                    if(field is null)continue;
                    Assert.InRange(Math.Abs(Center(title,host.Root)-Center(field,host.Root)),0,1);Assert.Equal(DesignTokens.FormFieldWidth,field.ActualWidth);
                }
                var vm=(SettingsViewModel)page.DataContext;var saved=vm.FixedRateText;
                try
                {
                    vm.FixedRateText="invalid";await ScreenRenderTests.Settle();Assert.NotEmpty(vm.FixedRateError);
                    var field=UiAudit.Descendants<TextBox>(page).Single(t=>System.Windows.Automation.AutomationProperties.GetAutomationId(t)=="SettingsFixedRate");
                    var header=UiAudit.Descendants<AppFormHeader>(Ancestor<AppCard>(field)).Single();var title=UiAudit.Descendants<TextBlock>(header).First(t=>t.Text==header.Title);
                    Assert.InRange(Math.Abs(Center(title,host.Root)-Center(field,host.Root)),0,1);
                }
                finally{vm.FixedRateText=saved;}
            }
            ScreenRenderTests.Apply("zh-CN",true);
            foreach(var type in new[]{typeof(WatchlistPage),typeof(OptionsPage),typeof(StrategyPage),typeof(NewsPage),typeof(AlertsPage),typeof(DataSourcesPage)})
            {
                var page=(Page)Activator.CreateInstance(type)!;using var host=new OffscreenHost(page,1280,900);await ScreenRenderTests.Settle();
                foreach(var header in UiAudit.Descendants<AppFormHeader>(page))
                {
                    var title=UiAudit.Descendants<TextBlock>(header).First(t=>t.Text==header.Title);var help=UiAudit.Descendants<AppHelp>(header).Single();Assert.InRange(Math.Abs(Center(title,host.Root)-Center(help,host.Root)),0,1);
                }
            }
        });
    }

    [Fact]
    public void TextSizeSelectionUpdatesTheOpenWindowAndPersists()
    {
        WpfHost.Run(async () =>
        {
            var page = new SettingsPage();
            using var host = new OffscreenHost(page, 980, 620, asMainWindow: true);
            await ScreenRenderTests.Settle();
            host.Layout();
            var picker = Assert.IsType<AppSelect>(page.FindName("TextSizePicker"));
            Assert.Equal("SettingsTextSize", System.Windows.Automation.AutomationProperties.GetAutomationId(picker));
            picker.BringIntoView();
            host.Layout();
            Assert.True(picker.ActualWidth > 0 && picker.ActualHeight > 0);
            var original = picker.SelectedIndex;
            try
            {
                picker.SetCurrentValue(ComboBox.SelectedIndexProperty, 0);
                await ScreenRenderTests.Settle();
                Assert.Equal(13.5, picker.FontSize);
                picker.SetCurrentValue(ComboBox.SelectedIndexProperty, 3);
                await ScreenRenderTests.Settle();
                Assert.Equal(20.25, picker.FontSize);
                var store = AppServices.Get<Meili.Core.Settings.SettingsStore>();
                Assert.Equal(150, new Meili.Core.Settings.SettingsStore(System.IO.Path.GetDirectoryName(store.FilePath)!).Load().TextSizePercent);
                var header = UiAudit.Descendants<AppFormHeader>(Ancestor<AppCard>(picker)).Single();
                var title = UiAudit.Descendants<TextBlock>(header).Single(text => text.Text == header.Title);
                Assert.InRange(Math.Abs(Center(title, host.Root) - Center(picker, host.Root)), 0, 1);
            }
            finally
            {
                picker.SetCurrentValue(ComboBox.SelectedIndexProperty, original);
                await ScreenRenderTests.Settle();
            }
        });
    }
}
