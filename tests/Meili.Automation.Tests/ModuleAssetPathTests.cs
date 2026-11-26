using System.Text;
using Meili.Automation.Modules;
namespace Meili.Automation.Tests;

public sealed class ModuleAssetPathTests
{
    [Fact]
    public async Task Profile_aliases_above_the_owned_root_do_not_block_verified_script_materialization()
    {
        var root=Path.Combine(Path.GetTempPath(),"module-anchor-"+Guid.NewGuid());Directory.CreateDirectory(root);
        try
        {
            var profile=Path.Combine(root,"profile");Directory.CreateDirectory(profile);
            if(!OperatingSystem.IsWindows())
            {
                var alias=Path.Combine(root,"profile-alias");Directory.CreateSymbolicLink(alias,profile);profile=alias;
            }
            var owned=Path.Combine(profile,"apps");Directory.CreateDirectory(owned);
            var bytes=Encoding.UTF8.GetBytes("export const verified=true;");
            using var lease=new ModuleAssetLease(bytes,"1.0.0",new MemoryStream(),Path.Combine(owned,"execution","easysellput.test","1.0.0"),owned);
            var script=await lease.MaterializeScriptAsync(CancellationToken.None);
            Assert.Equal(bytes,await File.ReadAllBytesAsync(script));
        }
        finally{Directory.Delete(root,true);}
    }

    [Fact]
    public async Task Execution_cannot_escape_the_owned_root_or_follow_an_owned_link()
    {
        var root=Path.Combine(Path.GetTempPath(),"module-owned-path-"+Guid.NewGuid());Directory.CreateDirectory(root);
        try
        {
            var owned=Path.Combine(root,"apps");Directory.CreateDirectory(owned);
            var outside=Path.Combine(root,"outside");Directory.CreateDirectory(outside);
            using(var escaped=new ModuleAssetLease([1],"1.0.0",new MemoryStream(),outside,owned))
                await Assert.ThrowsAsync<InvalidDataException>(()=>escaped.MaterializeScriptAsync(CancellationToken.None));
            if(!OperatingSystem.IsWindows())
            {
                var link=Path.Combine(owned,"execution");Directory.CreateSymbolicLink(link,outside);
                using var linked=new ModuleAssetLease([1],"1.0.0",new MemoryStream(),Path.Combine(link,"easysellput.test","1.0.0"),owned);
                await Assert.ThrowsAsync<InvalidDataException>(()=>linked.MaterializeScriptAsync(CancellationToken.None));
            }
            Assert.Empty(Directory.GetFileSystemEntries(outside));
        }
        finally{Directory.Delete(root,true);}
    }
}
