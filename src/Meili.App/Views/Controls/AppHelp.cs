using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Input;

namespace Meili.App.Views.Controls;

/// <summary>Click/keyboard help that does not consume a permanent tutorial row.</summary>
public sealed class AppHelp : Button
{
    public static readonly DependencyProperty HelpTextProperty=DependencyProperty.Register(nameof(HelpText),typeof(string),typeof(AppHelp),new PropertyMetadata(""));
    public string HelpText{get=>(string)GetValue(HelpTextProperty);set=>SetValue(HelpTextProperty,value);}
    public bool IsHelpOpen=>_popup.IsOpen;
    private readonly Popup _popup;
    public AppHelp()
    {
        Width=28;Height=28;MinWidth=28;MinHeight=28;Padding=default;
        SetResourceReference(StyleProperty,"GhostButton");SetResourceReference(AutomationProperties.NameProperty,"UX_Help");SetResourceReference(ToolTipProperty,"UX_Help");
        Content=new LucideIcon{Kind="Help",Width=18,Height=18};
        var text=new TextBlock{Width=320,FontSize=14,TextWrapping=TextWrapping.Wrap};text.SetBinding(TextBlock.TextProperty,new Binding(nameof(HelpText)){Source=this});text.SetResourceReference(TextBlock.ForegroundProperty,"TextFillColorPrimaryBrush");
        var frame=new Border{CornerRadius=new CornerRadius(12),Padding=new Thickness(16),BorderThickness=new Thickness(1),Child=new ScrollViewer{MaxHeight=280,HorizontalScrollBarVisibility=ScrollBarVisibility.Disabled,Content=text}};
        frame.SetResourceReference(Border.BackgroundProperty,"CardBackgroundFillColorDefaultBrush");frame.SetResourceReference(Border.BorderBrushProperty,"ControlStrokeColorDefaultBrush");text.SetResourceReference(TextBlock.FontFamilyProperty,"AppFont");
        _popup=new Popup{PlacementTarget=this,Placement=PlacementMode.Bottom,StaysOpen=false,AllowsTransparency=true,Child=frame};
        frame.PreviewKeyDown+=(_,e)=>{if(e.Key==Key.Escape){_popup.IsOpen=false;Focus();e.Handled=true;}};
        _popup.Opened+=(_,_)=>ComponentMotion.Enter(frame);
        Unloaded+=(_,_)=>_popup.IsOpen=false;
    }
    protected override void OnClick(){base.OnClick();_popup.IsOpen=!_popup.IsOpen;}
    protected override void OnPreviewKeyDown(KeyEventArgs e)
    {
        if(e.Key==Key.Escape && _popup.IsOpen){_popup.IsOpen=false;Focus();e.Handled=true;}
        base.OnPreviewKeyDown(e);
    }
}
