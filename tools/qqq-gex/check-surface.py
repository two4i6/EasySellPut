#!/usr/bin/env python3
"""Guard retired presentation dependencies without removing shared analytics."""
import json,pathlib,re
root=pathlib.Path(__file__).resolve().parents[2];web=root/'web/qqq-gex'
removed=['adapters/json-data-modal.tsx','upstream/src/components/DataViewButton.tsx','upstream/src/components/JSONDataModal.tsx','upstream/src/store/useAISettingsStore.ts','upstream/src/components/Strategy/qqq/terminal/QqqDirectionalResearchOverview.tsx']
for name in removed:
 if(web/name).exists():raise SystemExit('Retired presentation file remains: '+name)
pattern=re.compile(r'ASK AI|askAi|aiContext|qqq-gex-ai|JSONDataModal|useAISettingsStore|@ai-sdk|researchContent|researchReplay|onResearchOpen|QQQ_GEX_RIGHT_TAB_LABELS\.research')
for path in [web/'main.tsx',web/'local.css']:
 if re.search(r'historyLifecycle|qqq-local-history-lifecycle|qqq-local-history-date|PCS 历史观察',path.read_text()):raise SystemExit('Retired local strip remains: '+path.name)
for directory in ['upstream','adapters','runtime','dist']:
 for path in (web/directory).rglob('*'):
  if path.is_file() and path.suffix in {'.ts','.tsx','.js','.mjs','.json','.css'}:
   if pattern.search(path.read_text()):raise SystemExit('Retired presentation reference: '+str(path.relative_to(web)))
for path in web.glob('*.md'):
 if pattern.search(path.read_text()):raise SystemExit('Retired presentation documentation: '+path.name)
packages=json.loads((web/'package.json').read_text())
for name in ['ai','@ai-sdk/openai']:
 if name in packages.get('dependencies',{}):raise SystemExit('Retired dependency remains: '+name)
# Shared calculations and bounded read tools remain part of the product.
for name in ['qqqGexCalculation.ts','qqqExposureWorkbench.ts','qqqIntradayDirectionalSummary.ts','engines/analysis/QqqGexResearch.ts']:
 if not(web/'upstream/src/lib'/name).is_file():raise SystemExit('Shared calculation removed: '+name)
# The catalog embeds app-owned facade metadata through GexContracts.All.
contracts=json.loads((web/'public-contracts.json').read_text())
packaged={operation['name']:operation for operation in json.loads((web/'operations.json').read_text())}
for contract in contracts:
 operation=packaged.get(contract['name'])
 if operation is None or operation['schema']!=contract['schema'] or operation['writes']!=contract['writes']:raise SystemExit('Packaged facade contract differs: '+contract['name'])
read_tools={operation['name'] for operation in contracts if operation.get('writes') is False}
for name in ['get_qqq_gex_archive','get_qqq_gex_view','get_qqq_gex_replay']:
 if name not in read_tools:raise SystemExit('Read tool removed or made writable: '+name)
if 'Apps.QqqGex.GexContracts.All' not in(root/'src/Meili.Application/OperationCatalog.Coverage.cs').read_text():raise SystemExit('App contracts disconnected from the host catalog')
print('PASS: retired workbench surfaces/dependencies absent; shared analytics and read tools retained')
