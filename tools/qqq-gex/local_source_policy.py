"""Reviewed presentation-only reductions of the pinned external workbench.
The upstream checkout and retained calculation/history modules are never edited.
"""
import re
POLICY='workbench-surface-v1'
def transform(relative,body):
    name=str(relative).replace("\\","/");text=body.decode('utf-8') if name.endswith(('.ts','.tsx','.css')) else None
    if text is None:return body
    if name=='src/app/analysis/qqq/gex/page.component.tsx':
        text=text.replace("import DataViewButton from '@/components/DataViewButton';\n",'')
        start=text.index('/** Compact, complete payload for the shared AI modal;');end=text.index('export function QqqPcsGexStandaloneContent()',start);text=text[:start]+text[end:]
        text=re.sub(r'^  const aiContext = .*\n','',text,flags=re.M).replace('!displayData || !aiContext || !terminalView','!displayData || !terminalView')
        text=re.sub(r' askAi=\{<DataViewButton.*?/>\}', '',text)
        text=re.sub(r' researchContent=\{<QqqDirectionalSignalConsole.*?/>\}', '',text)
        for field in ['researchReplay={discoveryReplay}','researchLoading={discoveryReplayLoading}','onResearchOpen={requestResearch}','sectionMode="monitor"']:
            text=text.replace(' '+field,'')
        for field in ['discoveryReplayLoading','discoveryReplay','requestResearch']:
            text=re.sub(r'\b'+field+r',?\s*','',text)
        start=text.index('  const research = expiry?.research');end=text.index('\n  return {',start);text=text[:start]+text[end:]
        text=re.sub(r'\n    research: research \? \{[\s\S]*?\n    \} : null,','',text)
        for imported in ['qqqMarketSession','qqqSessionVwap']:
            text=re.sub(r'^import \{ '+imported+r' \} from [^\n]+\n','',text,flags=re.M)
    elif name=='src/components/Strategy/qqq/terminal/QqqGexTerminal.tsx':
        text=re.sub(r'^  research: \{.*\n','',text,flags=re.M)
        text=text.replace('observationLabel,researchContent,terminal, chart, askAi,','observationLabel,terminal, chart,')
        text=text.replace('researchContent?:ReactNode; ','').replace('askAi?: ReactNode; ','')
        start=text.index("    { label: '结构研究'");end=text.index('\n  ];',start);text=text[:start]+text[end:]
        text=re.sub(r'\{askAi && <details.*?</details>\}','',text)
        text=re.sub(r'^    \{label:QQQ_GEX_RIGHT_TAB_LABELS.research,.*\n','',text,flags=re.M)
    elif name=='src/components/Strategy/qqq/terminal/qqqTerminalTabsModel.ts':
        text=text.replace("  research: '研究',\n",'')
    elif name=='src/components/Strategy/qqq/terminal/QqqDirectionalSignalConsole.tsx':
        text=text.replace("import QqqDirectionalResearchOverview from './QqqDirectionalResearchOverview';\n",'')
        start=text.index('export function QqqDirectionalSignalConsole(');end=text.index('\n',start)
        text=text[:start]+"export function QqqDirectionalSignalConsole({ directional, replay, historicalDate, replayLoading = false, visible = true }: { historicalDate?: string | null; replayLoading?: boolean; visible?: boolean; flat?: boolean; directional?: Directional | null; replay?: QqqDirectionalReplayApiResponse | null }) {"+text[end:]
        start=text.index("    {sectionMode!=='monitor' && <div role=\"tabpanel\"");end=text.index('  </section>;',start);text=text[:start]+text[end:]
        text=text.replace("if(sectionMode==='research')return;",'').replace('[sectionMode]','[]').replace("useState(sectionMode==='research'?'research':'current')","useState('current')")
        text=text.replace('  const research = researchReplay ?? replay;\n','').replace('  const isResearch = Boolean(research);\n','')
        text=re.sub(r"  useEffect\(\(\) => \{\n    if \(visible && activePanel === 'research'\) onResearchOpen\?\.\(\);\n  \}, \[activePanel, onResearchOpen,visible\]\);\n",'',text)
        text=text.replace("sectionMode==='research' || ",'').replace(',sectionMode]',']').replace("{sectionMode==='research'?'提醒验证':'盘中提示'}",'盘中提示').replace(" && sectionMode!=='research'",'')
        text=text.replace("{sectionMode!=='research' && <div role=\"tablist\"",'{<div role="tablist"')
        text=text.replace("(sectionMode==='monitor'?[['current', '当前提示'], ['log', `提醒记录${signals.length ? ` ${signals.length}` : ''}`]]:[['current', '当前提示'], ['log', `提醒记录${signals.length ? ` ${signals.length}` : ''}`], ['research', '研究统计']])", "([['current', '当前提示'], ['log', `提醒记录${signals.length ? ` ${signals.length}` : ''}`]])")
        text=text.replace("sectionMode==='monitor'?['current','log']:['current', 'log', 'research']","['current','log']")
    elif name=='src/hooks/useQqqGexDisplayData.ts':
        text=re.sub(r'^  const \[(?:discoveryReplay|researchRequested|discoveryReplayLoading),[^\n]*\n','',text,flags=re.M)
        text=re.sub(r'^  const requestResearch =[^\n]*\n','',text,flags=re.M)
        text=re.sub(r'  useEffect\(\(\) => \{\n    if \(!researchRequested[\s\S]*?\n  \}, \[gexDates, researchRequested\]\);\n','',text)
        text=text.replace('discoveryReplayRequestedRef','initialDateSelectedRef')
        text=re.sub(r'\b(?:discoveryReplayLoading|discoveryReplay|requestResearch),?\s*','',text)
    elif name=='src/components/Strategy/qqq/terminal/QqqDirectionalSignalConsole.module.css':
        removed=('qqq-dir-research','qqq-dir-insight','qqq-dir-stat-row','qqq-dir-day-list','qqq-dir-footnote','qqq-dir-explanation')
        text=''.join(line for line in text.splitlines(keepends=True) if not any(key in line for key in removed))
    return text.encode('utf-8')
