#!/usr/bin/env python3
"""Import the pinned QQQ workbench dependency closure without rewriting algorithms."""
import argparse, hashlib, json, pathlib, re, shutil, subprocess
from local_source_policy import transform, POLICY

PIN = '8abee90a260071cbe9b1519a56548e8bf5a8d18e'
ROOT = pathlib.Path(__file__).resolve().parents[2]
IMPORT = re.compile(r'''(?:from\s*|import\s*\(|import\s*|require\s*\()\s*['"]([^'"]+)['"]''')
SEEDS = ['src/lib/qqqHeatmapDiscovery.test.ts','src/components/Strategy/qqq/qqqDirectionalChartMarkers.test.ts','src/components/Strategy/qqq/qqqChartDisplayPreferences.test.ts','src/lib/qqqIntradaySetup.test.ts','src/lib/qqqChartObservationBands.test.ts','src/components/Button.tsx', 'src/components/Strategy/qqq/QqqIntradayLifecycle.test.tsx', 'src/components/Strategy/qqq/QqqIntradayLifecycle.tsx', 'src/lib/engines/analysis/QqqPcsEntrySnapshot.test.ts', 'src/lib/engines/analysis/QqqDailyMarketBase.test.ts', 'src/lib/engines/analysis/PcsReactiveRule.test.ts', 'src/lib/engines/leveraged-overlay/v2/strategies/pcs-contract-profile.test.ts', 'src/lib/engines/leveraged-overlay/v2/strategies/put-credit-spread.test.ts', 'src/lib/qqqIntradayDirectionalSummary.test.ts', 'src/lib/qqqHeatmapPresentation.test.ts', 'src/lib/qqqOptionActivityScope.test.ts', 'src/lib/qqqIntradayIndicators.test.ts', 'src/lib/qqqExposureSides.test.ts', 'src/lib/qqqExposureReplay.test.ts', 'src/lib/qqqMaxPain.test.ts', 'src/lib/qqqIndicatorConsistency.test.ts', 'src/lib/qqqExposureArchive.test.ts', 'src/lib/engines/analysis/QqqIntradayDirectional.test.ts', 'src/lib/qqqIntradayDirectionalSignals.test.ts', 'src/lib/engines/analysis/QqqGexResearch.test.ts', 'src/lib/qqqGexCaptureBuilder.ts', 'src/lib/qqqGexCalculation.test.ts', 'src/lib/qqqGammaModel.test.ts', 'src/lib/qqqGammaModel.worker.ts', 'src/lib/qqqExposureWire.worker.ts', 'src/lib/qqqDayScenario.worker.ts', 'src/App.css', 'src/app/globals.css', 'src/lib/qqqExposureWire.test.ts', 'src/lib/qqqGexInputQuality.test.ts', 'src/app/analysis/qqq/gex/page.tsx', 'src/app/analysis/qqq/gex/page.component.tsx',
 'src/app/api/analysis/qqq/pcs/route.ts', 'src/app/api/analysis/qqq/pcs/backtest/route.ts',
 'src/app/api/analysis/qqq/gex/day/route.ts', 'src/app/api/analysis/qqq/gex/exposure/route.ts',
 'src/app/api/analysis/qqq/gex/intraday-context/route.ts', 'src/app/api/analysis/qqq/gex/spread-quote/route.ts',
 'src/app/api/proxy/yahoo/quote-stream/route.ts', 'src/app/api/proxy/yahoo/history/route.ts']

def main():
 p=argparse.ArgumentParser(); p.add_argument('source',type=pathlib.Path); p.add_argument('--bootstrap-full-source',action='store_true'); args=p.parse_args()
 source=args.source.resolve()
 sha=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
 if sha != PIN: raise SystemExit('Source HEAD differs from reviewed commit')
 if subprocess.check_output(['git','-C',str(source),'status','--porcelain'],text=True).strip():
  raise SystemExit('Source worktree must be clean')
 target=ROOT/'web/qqq-gex/upstream'
 if target.exists(): raise SystemExit('Destination exists; review changes before importing again')
 selection_path=ROOT/'tools/qqq-gex/source-selection.json'
 selection=json.loads(selection_path.read_text()) if selection_path.exists() and not args.bootstrap_full_source else None
 if selection and selection['sourceCommit']!=sha:raise SystemExit('Review dependency selection for this source commit, or bootstrap into an isolated staging copy')
 pending=[source/x for x in (selection['retainedPaths'] if selection else SEEDS)]; seen=set(); missing=[]; packages=set(selection['referencedPackages'] if selection else [])
 while pending:
  path=pending.pop()
  if path in seen: continue
  if not path.is_file(): missing.append(str(path.relative_to(source))); continue
  seen.add(path)
  if selection:continue
  if path.suffix not in ('.ts','.tsx','.js','.jsx'): continue
  for name in IMPORT.findall(transform(path.relative_to(source),path.read_bytes()).decode("utf-8")):
   if name.startswith('@/'): base=source/'src'/name[2:]
   elif name.startswith('.'): base=path.parent/name
   else: packages.add(name.split('/')[0] if not name.startswith('@') else '/'.join(name.split('/')[:2])); continue
   found=next((x.resolve() for x in [base,*[pathlib.Path(str(base)+ext) for ext in ('.ts','.tsx','.js','.jsx','.json','.css')],*[base/('index'+ext) for ext in ('.ts','.tsx','.js')]] if x.is_file()),None)
   if found is None: missing.append(str(path.relative_to(source))+': '+name)
   elif source in found.parents: pending.append(found)
   else: raise SystemExit('Import escaped source tree')
 files=[]
 for path in sorted(seen):
  relative=path.relative_to(source); dest=target/relative; dest.parent.mkdir(parents=True,exist_ok=True); original=path.read_bytes(); local=transform(relative,original); dest.write_bytes(local)
  item={'path':relative.as_posix(),'sha256':hashlib.sha256(local).hexdigest(),'bytes':len(local)}
  if local!=original:item['upstreamSha256']=hashlib.sha256(original).hexdigest();item['localPolicy']=POLICY
  files.append(item)
 manifest={'repository':'https://github.com/two4i6/option','commit':sha,'status':'pinned-source-with-reviewed-local-presentation-policy','localPresentationPolicy':POLICY,'seeds':([x for x in SEEDS if x in selection['retainedPaths']] if selection else SEEDS),'files':files,'externalPackages':sorted(packages),'unresolvedImports':sorted(set(missing))}
 if selection:manifest['dependencySelection']={'path':'tools/qqq-gex/source-selection.json','sha256':hashlib.sha256(json.dumps(selection,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'sourceDataOnly':selection['sourceDataOnly']}
 (target.parent/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'files':len(files),'bytes':sum(x['bytes'] for x in files),'unresolved':len(manifest['unresolvedImports'])}))

if __name__=='__main__': main()
