namespace Meili.Automation.Modules;

/// <summary>Host visibility demand; independent of a native UI framework or quote timer.</summary>
public interface IAppActivity
{
    bool AnyVisible {get;}
    event EventHandler? Changed;
}
