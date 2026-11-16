namespace Meili.Shared.Tests;
public sealed class ThemeSurfaceSampleTests
{
    private static byte[] Frame(byte background,byte foreground)
    {
        var pixels=new byte[25*25*4];
        for(var y=0;y<25;y++)for(var x=0;x<25;x++)
        {var color=x is >=11 and <=13&&y is >=5 and <=19?foreground:background;var i=(y*25+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=color;pixels[i+3]=255;}
        return pixels;
    }
    [Fact]public void Foreground_text_does_not_masquerade_as_an_incorrectly_themed_background()
    {
        var dark=Frame(38,250);Assert.Equal(250,dark[(12*25+12)*4]);Assert.True(ThemeSurfaceSample.MedianLightness(dark,25,25,100,12,12)<.35);
        var light=Frame(250,20);Assert.True(ThemeSurfaceSample.MedianLightness(light,25,25,100,12,12)>.6);
        // A genuinely white background still fails the dark-background threshold, even with dark text.
        Assert.True(ThemeSurfaceSample.MedianLightness(light,25,25,100,12,12)>.9);
    }
    [Fact]public void Sampling_clamps_to_frame_edges_and_rejects_invalid_buffers()
    {
        Assert.True(ThemeSurfaceSample.MedianLightness(Frame(38,250),25,25,100,0,0)<.35);
        Assert.Throws<ArgumentException>(()=>ThemeSurfaceSample.MedianLightness([],25,25,100,0,0));
    }
}
