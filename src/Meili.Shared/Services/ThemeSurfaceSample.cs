namespace Meili.Shared.Services;

/// <summary>Screenshot background sampling: a small patch rejects foreground glyphs, not an incorrectly colored surface.</summary>
public static class ThemeSurfaceSample
{
    public static double MedianLightness(byte[] pixels, int width, int height, int stride, int x, int y)
    {
        if(width<=0||height<=0||stride<width*4||pixels.Length<(long)stride*height)throw new ArgumentException("Invalid BGRA frame.");
        var values=new List<double>();
        for(var row=Math.Max(0,y-12);row<=Math.Min(height-1,y+12);row++)
        for(var column=Math.Max(0,x-12);column<=Math.Min(width-1,x+12);column++)
        {
            var i=row*stride+column*4;
            values.Add((.0722*pixels[i]+.7152*pixels[i+1]+.2126*pixels[i+2])/255);
        }
        if(values.Count==0)throw new ArgumentOutOfRangeException(nameof(x));
        values.Sort();return values[values.Count/2];
    }
}
