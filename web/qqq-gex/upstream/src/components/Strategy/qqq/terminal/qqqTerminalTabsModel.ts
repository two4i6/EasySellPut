export const QQQ_GEX_LEFT_TAB_LABELS = {
  gamma: 'Gamma 地图',
  activity: '成交持仓',
  structure: '结构事件',
  response: '活动响应',
} as const;

export const QQQ_GEX_RIGHT_TAB_LABELS = {
  monitor: '监控',
  conditions: '条件',
  chartSettings: '图表设置',
  research: '研究',
} as const;

export function resolveQqqTerminalTabIndex(labels: readonly string[], savedLabel: string | null): number {
  if (!savedLabel) return 0;
  const index = labels.indexOf(savedLabel === '盘中观察' ? QQQ_GEX_LEFT_TAB_LABELS.structure : savedLabel);
  return index >= 0 ? index : 0;
}

export function qqqTerminalTabStorageValue(label: string): string {
  return label;
}

export function qqqTerminalTabEventIndex(labels: readonly string[]): number | null {
  const monitor=labels.indexOf(QQQ_GEX_RIGHT_TAB_LABELS.monitor);
  return monitor>=0?monitor:labels.length?0:null;
}
