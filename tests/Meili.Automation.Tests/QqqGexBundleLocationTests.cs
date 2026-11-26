using Meili.Automation;
namespace Meili.Automation.Tests;
public sealed class QqqGexBundleLocationTests
{
    [Fact] public void Mac_gui_runtime_is_sealed_resource_and_standalone_cli_uses_its_own_runtime()
    {
        var root=Path.Combine(Path.GetTempPath(),"runtime bundle fixture");var mac=Path.Combine(root,"EasySellPut.app","Contents","MacOS");Assert.Equal(Path.Combine(root,"EasySellPut.app","Contents","Resources","runtime","node.tar.gz"),QqqGexCalculationRunner.BundledArchivePath(mac,"node.tar.gz"));var cli=Path.Combine(root,"EasySellPut.app","Contents","Resources","automation");Assert.Equal(Path.Combine(cli,"runtime","node.tar.gz"),QqqGexCalculationRunner.BundledArchivePath(cli,"node.tar.gz"));
    }
}
