using Meili.Core.Models;
namespace Meili.Shared.ViewModels;

/// <summary>Reusable signed columns: common zero/scale, chronological labels and exact accessible values.</summary>
public sealed record FinancialChartPoint(string Label,string Detail,double? Actual,double? Estimate,
    double ActualPositive,double ActualNegative,double EstimatePositive,double EstimateNegative,double NegativeSpace)
{
    public string ActualText=>NumberDisplay.Compact(Actual);
    public string EstimateText=>NumberDisplay.Compact(Estimate);
}
public sealed record FinancialChart(string Title,string Subtitle,IReadOnlyList<FinancialChartPoint> Points)
{
    public bool HasData=>Points.Count>0;
    public static FinancialChart Build(string title,string subtitle,IEnumerable<(string Label,string Detail,double? Actual,double? Estimate)> input)
    {
        static double? Finite(double? v)=>v is {} n && double.IsFinite(n)?n:null;
        var rows=input.Select(x=>(x.Label,x.Detail,Actual:Finite(x.Actual),Estimate:Finite(x.Estimate))).ToArray();
        var scale=rows.SelectMany(x=>new[]{Math.Abs(x.Actual??0),Math.Abs(x.Estimate??0)}).DefaultIfEmpty(0).Max();
        if(scale==0)scale=1;
        double Positive(double? v)=>v is >0?Math.Min(80,v.Value/scale*80):0;
        double Negative(double? v)=>v is <0?Math.Min(80,-v.Value/scale*80):0;
        return new(title,subtitle,rows.Select(x=>new FinancialChartPoint(x.Label,x.Detail,x.Actual,x.Estimate,
            Positive(x.Actual),Negative(x.Actual),Positive(x.Estimate),Negative(x.Estimate),rows.Any(r=>r.Actual<0||r.Estimate<0)?80:0)).ToArray());
    }
}
