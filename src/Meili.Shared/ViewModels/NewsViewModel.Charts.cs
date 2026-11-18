using System.Globalization;
using Meili.Core.Models;
namespace Meili.Shared.ViewModels;
public partial class NewsViewModel
{
    private void RebuildCharts()
    {
        var old=SelectedFinancialChart?.Title;
        FinancialCharts.Clear();EstimateCharts.Clear();
        var currency=_lastFundamentals?.FinancialCurrency;
        FinancialBasis=$"{_loc["Nf_Actual"]} · {_financials?.Source ?? "—"} · {_loc["Nf_ProviderUnits"]}";
        var selected=(_financials?.Lines??[]).Where(x=>x.Annual==Annual && double.IsFinite(x.Value)).ToArray();
        foreach(var item in Enum.GetValues<FinancialStatementKind>().SelectMany(StatementTable.ItemsFor))
        {
            var rows=selected.Where(x=>x.Item==item).OrderBy(x=>x.PeriodEnd).DistinctBy(x=>x.PeriodEnd).ToArray();
            if(rows.Length==0)continue;
            FinancialCharts.Add(FinancialChart.Build(ItemLabel(item),FinancialBasis,rows.Select(x=>
            {
                var period=x.PeriodEnd.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture);
                return(period,$"{period} · {_loc["Nf_Actual"]}: {_loc.Amount(x.Value)} · {_financials?.Source}",(double?)x.Value,(double?)null);
            })));
        }
        SelectedFinancialChart=FinancialCharts.FirstOrDefault(c=>c.Title==old)??FinancialCharts.FirstOrDefault();
        var earnings=_lastFundamentals?.Earnings??[];
        foreach(var metric in new[]{"EPS","Revenue"})
        foreach(var annual in new[]{false,true})
        {
            var rows=earnings.Where(x=>x.Metric==metric && x.Annual==annual).ToArray();if(rows.Length==0)continue;
            var title=(metric=="EPS"?_loc["Nf_EPS"]:_loc["Nf_TotalRevenue"])+" · "+_loc[annual?"Nf_Annual":"Nf_Quarterly"];
            var unit=string.IsNullOrWhiteSpace(currency)?_loc["Nf_CurrencyUnknown"]:currency;
            EstimateCharts.Add(FinancialChart.Build(title,$"{unit} · {_loc["Nf_Consensus"]}",rows.Select(x=>
            {
                var label=x.IsForecast?PeriodLabel(x.Period)+(x.PeriodEnd is {} end?"\n"+end.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture):""):x.Period;
                var detail=$"{label} · {x.PeriodEnd?.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture)}\n{_loc["Nf_Actual"]}: {NumberDisplay.Compact(x.Actual)}\n{_loc["Nf_Estimate"]}: {NumberDisplay.Compact(x.Estimate)}\n{_loc["Nf_Range"]}: {NumberDisplay.Range(x.Low,x.High)} · {_loc["Nf_Analysts"]}: {x.Analysts?.ToString(CultureInfo.InvariantCulture)??"—"}\n{x.Source} · UTC {x.FetchedAt?.ToString("u",CultureInfo.InvariantCulture)}";
                return(label,detail,x.Actual,x.Estimate);
            })));
        }
        EarningsStatus=EstimateCharts.Count==0?_loc["Nf_NoEstimates"]:_loc["Nf_EstimatesNote"];
    }
    private string PeriodLabel(string period)=>period switch
    {
        "0q"=>_loc["Nf_CurrentQuarter"],"+1q"=>_loc["Nf_NextQuarter"],"0y"=>_loc["Nf_CurrentYear"],"+1y"=>_loc["Nf_NextYear"],_=>period
    };
}
