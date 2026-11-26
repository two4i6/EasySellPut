using Meili.Shared.Services;
namespace Meili.Shared.Tests;
public sealed class NavigationIconTests
{
    [Fact] public void Every_builtin_page_has_a_navigation_vector_after_icon_import()
    {
        foreach(var page in Enum.GetValues<AppPage>())Assert.StartsWith("M",NavigationIcons.For(page));
    }
}
