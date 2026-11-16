import type { QqqDirectionalReplayApiResponse } from './QqqDirectionalSignalConsole';

const resultCount = (rate: number | null, samples: number) => rate === null || samples === 0
  ? '暂无可评估结果'
  : `${Math.round(rate * samples)} / ${samples} 次（${Math.round(rate * 100)}%）`;

export default function QqqDirectionalResearchOverview({ research }: { research: QqqDirectionalReplayApiResponse }) {
  const opportunity = research.opportunityStats;
  const risk = research.riskStats;
  const confirmed = research.lifecycleStats.confirmedSignals;
  return <div className="qqq-dir-research-grid">
    <div className="qqq-dir-research-verdict">
      <strong>{research.validation.status === 'VALIDATED' ? '样本门槛已达到，仍需人工复核' : '样本还少，暂时不能判断提示是否可靠'}</strong>
      <p>已记录 {research.completeDays} 个完整交易日。下面统计提示后的价格变化，不代表实际交易收益。</p>
    </div>
    <div className="qqq-dir-insight">
      <h4>发出了多少次提示？</h4>
      <div className="qqq-dir-research-counts">
        <div><strong>{research.lifecycleStats.opportunityStructures}</strong><span>不同的方向机会</span></div>
        <div><strong>{confirmed}</strong><span>已满足确认条件</span></div>
        <div><strong>{risk.emitted}</strong><span>风险提醒</span></div>
      </div>
      <p>{confirmed === 0 ? '目前没有满足全部确认条件的机会。方向观察仍需等待确认。' : '确认表示满足提示条件；后续仍可能失效。'}</p>
    </div>
    <div className="qqq-dir-insight">
      <h4>进入观察区后，价格怎么走？</h4>
      <div className="qqq-dir-stat-row"><span>先出现小幅有利行情</span><strong>{resultCount(opportunity.halfRSuccessRate, opportunity.evaluated)}</strong></div>
      <div className="qqq-dir-stat-row"><span>此前就触及失效价</span><strong>{resultCount(opportunity.invalidatedBeforeHalfRRate, opportunity.evaluated)}</strong></div>
      <p className="qqq-dir-explanation">“小幅有利”指移动了参考价与失效价间距的一半。例如两价相差 1 元，门槛就是 0.5 元。提示发出后最多观察 30 分钟；这不是交易胜率。</p>
      {opportunity.evaluated < 5 && <p className="qqq-dir-explanation">目前仅 {opportunity.evaluated} 次可评估，即使显示 100%，也不足以判断效果稳定。</p>}
    </div>
    <div className="qqq-dir-insight">
      <h4>风险提醒后，情况怎样？</h4>
      <div className="qqq-dir-stat-row"><span>出现明显不利波动</span><strong>{risk.evaluated ? `${risk.confirmedRisk} / ${risk.evaluated} 次` : '暂无可评估结果'}</strong></div>
      <div className="qqq-dir-stat-row"><span>不利波动较小，并回到恢复位置</span><strong>{risk.evaluated ? `${risk.falseStop} / ${risk.evaluated} 次` : '暂无可评估结果'}</strong></div>
      <p className="qqq-dir-explanation">按提醒后 30 分钟的走势判断。其余 {risk.neutral} 次走势中性；{risk.pending} 次还在等待结果。</p>
    </div>
  </div>;
}
