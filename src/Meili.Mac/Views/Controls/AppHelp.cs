using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Data;
using Avalonia.Layout;
using Avalonia.Media;

namespace Meili.Mac.Views.Controls;

/// <summary>Click/keyboard help that does not consume a permanent tutorial row.</summary>
public sealed class AppHelp : Button
{
    public static readonly StyledProperty<string> HelpTextProperty=AvaloniaProperty.Register<AppHelp,string>(nameof(HelpText),"");
    public string HelpText{get=>GetValue(HelpTextProperty);set=>SetValue(HelpTextProperty,value);}
    public bool IsHelpOpen=>Flyout?.IsOpen==true;
    protected override Type StyleKeyOverride=>typeof(Button);
    public AppHelp()
    {
        Width=28;Height=28;MinWidth=28;MinHeight=28;Padding=default;Classes.Add("Subtle");
        Content=new LucideIcon{Kind="Help",Width=18,Height=18};
        this[!AutomationProperties.NameProperty]=this.GetResourceObservable("UX_Help").ToBinding();
        this[!ToolTip.TipProperty]=this.GetResourceObservable("UX_Help").ToBinding();
        var text=new TextBlock{Width=320,TextWrapping=TextWrapping.Wrap,FontSize=14};
        text.Bind(TextBlock.TextProperty,new Binding(nameof(HelpText)){Source=this});
        text[!TextBlock.ForegroundProperty]=this.GetResourceObservable("TextFillColorPrimaryBrush").ToBinding();
        var flyout=new Flyout{Placement=PlacementMode.BottomEdgeAlignedRight,Content=new ScrollViewer{MaxHeight=280,Content=text,HorizontalScrollBarVisibility=Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled}};
        flyout.Opened+=(_,_)=>AppMotion.Enter(text);Flyout=flyout;
    }
}
