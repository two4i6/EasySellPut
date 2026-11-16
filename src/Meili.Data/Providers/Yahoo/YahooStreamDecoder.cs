using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using Meili.Core.Models;
namespace Meili.Data.Providers.Yahoo;

/// <summary>Bounded decoder for Yahoo PricingData (protobuf wire format); unknown fields are skipped.</summary>
public static class YahooStreamDecoder
{
    public static QuoteTick? Parse(string json)
    {
        if(json.Length>65536)throw new FormatException("Oversized pricing frame.");
        using var doc=JsonDocument.Parse(json);
        if(!doc.RootElement.TryGetProperty("type",out var type)||type.GetString()!="pricing")return null;
        var data=Convert.FromBase64String(doc.RootElement.GetProperty("message").GetString()??"");
        if(data.Length>32768)throw new FormatException("Oversized pricing payload.");
        string? symbol=null,currency=null,exchange=null,name=null;double? price=null,change=null,percent=null,volume=null;long? time=null;var hours=0;
        var offset=0;
        while(offset<data.Length)
        {
            var key=Varint(data,ref offset);var field=(int)(key>>3);var wire=(int)(key&7);if(field==0)throw new FormatException("Invalid protobuf field.");
            ulong number=0;double? floating=null;string? text=null;
            switch(wire)
            {
                case 0:number=Varint(data,ref offset);break;
                case 1:Require(data,offset,8);offset+=8;break;
                case 2:var size=Varint(data,ref offset);if(size>32768)throw new FormatException("Invalid protobuf length.");Require(data,offset,(int)size);text=Encoding.UTF8.GetString(data,offset,(int)size);offset+=(int)size;break;
                case 5:Require(data,offset,4);floating=BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(data.AsSpan(offset,4)));offset+=4;break;
                default:throw new FormatException("Unsupported protobuf wire type.");
            }
            switch(field)
            {
                case 1 when wire==2:symbol=text;break;case 2 when wire==5:price=floating;break;
                case 3 when wire==0:time=Zigzag(number);break;case 4 when wire==2:currency=text;break;case 5 when wire==2:exchange=text;break;
                case 7 when wire==0:hours=(int)number;break;case 8 when wire==5:percent=floating;break;case 9 when wire==0:volume=Zigzag(number);break;
                case 12 when wire==5:change=floating;break;case 13 when wire==2:name=text;break;
            }
        }
        if(string.IsNullOrWhiteSpace(symbol)||symbol.Length>32||price is not >0||!double.IsFinite(price.Value)||time is null||time<=0)return null;
        DateTimeOffset at;try{at=DateTimeOffset.FromUnixTimeMilliseconds(time.Value);}catch(ArgumentOutOfRangeException){return null;}
        return new(symbol,price.Value,at,hours switch{0=>MarketState.PreMarket,1=>MarketState.Regular,2=>MarketState.AfterHours,_=>MarketState.Unknown},Finite(change),Finite(percent),volume is >=0?volume:null,currency,exchange,name,"yahoo");
    }
    private static double? Finite(double? n)=>n is { } value&&double.IsFinite(value)?value:null;
    private static long Zigzag(ulong value)=>unchecked((long)(value>>1)^-((long)value&1));
    private static void Require(byte[] data,int offset,int length){if(offset>data.Length-length)throw new FormatException("Truncated protobuf field.");}
    private static ulong Varint(byte[] data,ref int offset)
    {
        ulong result=0;for(var shift=0;shift<70;shift+=7){Require(data,offset,1);var b=data[offset++];if(shift==63&&b>1)throw new FormatException("Overflowed protobuf integer.");result|=(ulong)(b&127)<<shift;if(b<128)return result;}throw new FormatException("Invalid protobuf integer.");
    }
}
