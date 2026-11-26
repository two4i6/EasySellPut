using System.Windows;
using System.Windows.Controls;
namespace Meili.App.Views.Controls;

/// <summary>Full-surface card action using the existing AppButton template and keyboard/focus/motion contract.</summary>
public sealed class AppActionCard : Button
{
    public AppActionCard()
    {
        SetResourceReference(StyleProperty,"AppButton");
        HorizontalAlignment=HorizontalAlignment.Stretch;
        HorizontalContentAlignment=HorizontalAlignment.Stretch;
        VerticalContentAlignment=VerticalAlignment.Center;
    }
}
