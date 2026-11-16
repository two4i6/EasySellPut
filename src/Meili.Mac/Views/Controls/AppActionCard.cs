using Avalonia.Controls;
using Avalonia.Layout;
namespace Meili.Mac.Views.Controls;

/// <summary>Accessible full-surface card action; inherits shared button focus, motion and disabled feedback.</summary>
public sealed class AppActionCard : Button
{
    protected override Type StyleKeyOverride=>typeof(Button);
    public AppActionCard()
    {
        HorizontalAlignment=HorizontalAlignment.Stretch;
        HorizontalContentAlignment=HorizontalAlignment.Stretch;
        VerticalContentAlignment=VerticalAlignment.Center;
    }
}
