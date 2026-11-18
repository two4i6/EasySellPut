using System.Globalization;
using System.Text.Json;
using Meili.Core.Models;
using Meili.Data.Json;
namespace Meili.Data.Providers.Yahoo;

public sealed partial class YahooProvider
{
    internal static IReadOnlyList<EarningsObservation> ParseEarnings(JsonElement root,DateTimeOffset fetchedAt)
    {
        var result=root.Path("quoteSummary","result")?.At(0);
        if(result is not {} r)return [];
        var rows=new List<EarningsObservation>();
        static double? Number(JsonElement? obj,string key)=>obj?.Num(key) is {} n && double.IsFinite(n)?n:null;
        static DateOnly? Date(string? text)=>DateOnly.TryParseExact(text,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out var d)?d:null;
        foreach(var h in r.Path("earningsHistory","history").Items().Take(40))
        {
            var date=Date(h.Prop("quarter")?.Str("fmt")) ?? Date(h.Str("quarter"));
            if(date is null && h.Prop("quarter").Num() is {} unix && unix>0 && unix<253402300800)
                date=DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeSeconds((long)unix).UtcDateTime);
            var actual=Number(h,"epsActual");var estimate=Number(h,"epsEstimate");
            if(date is null || (actual is null && estimate is null))continue;
            rows.Add(new(){Metric="EPS",Period=date.Value.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture),PeriodEnd=date,
                Actual=actual,Estimate=estimate,Source="yahoo",FetchedAt=fetchedAt});
        }
        foreach(var t in r.Path("earningsTrend","trend").Items().Take(12))
        {
            var period=t.Str("period");if(string.IsNullOrWhiteSpace(period))continue;
            foreach(var (module,metric) in new[]{("earningsEstimate","EPS"),("revenueEstimate","Revenue")})
            {
                var estimate=t.Prop(module);var avg=Number(estimate,"avg");var low=Number(estimate,"low");var high=Number(estimate,"high");
                if(avg is null && low is null && high is null)continue;
                var analysts=Number(estimate,"numberOfAnalysts");
                rows.Add(new(){Metric=metric,Period=period,PeriodEnd=Date(t.Str("endDate")),IsForecast=true,Annual=period.EndsWith("y",StringComparison.Ordinal),
                    Estimate=avg,Low=low,High=high,Analysts=analysts is >=0 and <=100000?(int)analysts.Value:null,Source="yahoo",FetchedAt=fetchedAt});
            }
        }
        return rows.DistinctBy(r=>(r.Metric,r.Period,r.IsForecast)).OrderBy(r=>r.IsForecast).ThenBy(r=>r.PeriodEnd).ThenBy(r=>r.Period,StringComparer.Ordinal).ToArray();
    }
}
