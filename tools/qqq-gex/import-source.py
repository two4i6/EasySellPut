#!/usr/bin/env python3
"""Import the pinned QQQ workbench dependency closure without rewriting algorithms."""
import argparse, hashlib, json, pathlib, re, shutil, subprocess

PIN = 'd60e24b56e308a81723f6c206fb52d22ddc0e9f8'
ROOT = pathlib.Path(__file__).resolve().parents[2]
IMPORT = re.compile(r'''(?:from\s*|import\s*\(|import\s*|require\s*\()\s*['"]([^'"]+)['"]''')
SEEDS = ['src/lib/qqqHeatmapPresentation.test.ts', 'src/lib/qqqOptionActivityScope.test.ts', 'src/lib/qqqIntradayIndicators.test.ts', 'src/lib/qqqExposureSides.test.ts', 'src/lib/qqqExposureReplay.test.ts', 'src/lib/qqqMaxPain.test.ts', 'src/lib/qqqIndicatorConsistency.test.ts', 'src/lib/qqqExposureArchive.test.ts', 'src/lib/engines/analysis/QqqIntradayDirectional.test.ts', 'src/lib/qqqIntradayDirectionalSignals.test.ts', 'src/lib/engines/analysis/QqqGexResearch.test.ts', 'src/lib/qqqGexCaptureBuilder.ts', 'src/lib/qqqGexCalculation.test.ts', 'src/lib/qqqGammaModel.test.ts', 'src/lib/qqqGammaModel.worker.ts', 'src/lib/qqqExposureWire.worker.ts', 'src/lib/qqqDayScenario.worker.ts', 'src/App.css', 'src/app/globals.css', 'src/lib/qqqExposureWire.test.ts', 'src/lib/qqqGexInputQuality.test.ts', 'src/app/analysis/qqq/gex/page.tsx', 'src/app/analysis/qqq/gex/page.component.tsx',
 'src/app/api/analysis/qqq/pcs/route.ts', 'src/app/api/analysis/qqq/pcs/backtest/route.ts',
 'src/app/api/analysis/qqq/gex/day/route.ts', 'src/app/api/analysis/qqq/gex/exposure/route.ts',
 'src/app/api/analysis/qqq/gex/intraday-context/route.ts', 'src/app/api/analysis/qqq/gex/spread-quote/route.ts',
 'src/app/api/proxy/yahoo/quote-stream/route.ts', 'src/app/api/proxy/yahoo/history/route.ts']

def main():
 p=argparse.ArgumentParser(); p.add_argument('source',type=pathlib.Path); args=p.parse_args()
 source=args.source.resolve()
 sha=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
 if sha != PIN: raise SystemExit('Source HEAD differs from reviewed commit')
 if subprocess.check_output(['git','-C',str(source),'status','--porcelain'],text=True).strip():
  raise SystemExit('Source worktree must be clean')
 target=ROOT/'web/qqq-gex/upstream'
 if target.exists(): raise SystemExit('Destination exists; review changes before importing again')
 pending=[source/x for x in SEEDS]; seen=set(); missing=[]; packages=set()
 while pending:
  path=pending.pop()
  if path in seen: continue
  if not path.is_file(): missing.append(str(path.relative_to(source))); continue
  seen.add(path)
  if path.suffix not in ('.ts','.tsx','.js','.jsx'): continue
  for name in IMPORT.findall(path.read_text()):
   if name.startswith('@/'): base=source/'src'/name[2:]
   elif name.startswith('.'): base=path.parent/name
   else: packages.add(name.split('/')[0] if not name.startswith('@') else '/'.join(name.split('/')[:2])); continue
   found=next((x.resolve() for x in [base,*[pathlib.Path(str(base)+ext) for ext in ('.ts','.tsx','.js','.jsx','.json','.css')],*[base/('index'+ext) for ext in ('.ts','.tsx','.js')]] if x.is_file()),None)
   if found is None: missing.append(str(path.relative_to(source))+': '+name)
   elif source in found.parents: pending.append(found)
   else: raise SystemExit('Import escaped source tree')
 files=[]
 for path in sorted(seen):
  relative=path.relative_to(source); dest=target/relative; dest.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(path,dest)
  files.append({'path':str(relative),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size})
 manifest={'repository':'https://github.com/two4i6/option','commit':sha,'status':'source-import-only','seeds':SEEDS,'files':files,'externalPackages':sorted(packages),'unresolvedImports':sorted(set(missing))}
 (target.parent/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'files':len(files),'bytes':sum(x['bytes'] for x in files),'unresolved':len(manifest['unresolvedImports'])}))

if __name__=='__main__': main()
