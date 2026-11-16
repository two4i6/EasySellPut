using Avalonia.Input;
namespace Meili.Mac.Tests;
public sealed class MacMenuShortcutTests
{
    [Fact] public void Every_navigation_shortcut_parses_and_pages_after_nine_do_not_claim_command_zero()
    {
        var count=Math.Max(12,MainWindow.PageOrder.Count);var assigned=new List<KeyGesture>();for(var index=0;index<count;index++){var text=MacMenu.PageShortcut(index);if(index<9){Assert.NotNull(text);assigned.Add(KeyGesture.Parse(text!));}else Assert.Null(text);}Assert.Equal(9,assigned.Count);Assert.DoesNotContain(assigned,g=>g.Key==Key.D0);Assert.All(assigned,g=>Assert.Equal(KeyModifiers.Meta,g.KeyModifiers));
    }
}
