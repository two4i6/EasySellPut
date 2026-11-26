#!/usr/bin/env python3
"""Verify pinned originals and explicitly reviewed local presentation reductions."""
import argparse,hashlib,json,pathlib,subprocess
from local_source_policy import transform,POLICY
parser=argparse.ArgumentParser();parser.add_argument('--upstream',type=pathlib.Path);args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]/'web/qqq-gex'
manifest=json.loads((root/'source-manifest.json').read_text());patched=0
if 'dependencySelection'in manifest:
 selection_path=root.parents[1]/manifest['dependencySelection']['path'];selection=json.loads(selection_path.read_text())
 if hashlib.sha256(json.dumps(selection,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=manifest['dependencySelection']['sha256'] or set(selection['retainedPaths'])!={x['path']for x in manifest['files']}:raise SystemExit('Dependency selection mismatch')
for item in manifest['files']:
 path=root/'upstream'/item['path'];body=path.read_bytes()
 if hashlib.sha256(body).hexdigest()!=item['sha256']:raise SystemExit('Local source changed: '+item['path'])
 if 'localPolicy'in item:
  if item['localPolicy']!=POLICY or len(item.get('upstreamSha256',''))!=64:raise SystemExit('Unreviewed local policy: '+item['path'])
  patched+=1
 if args.upstream:
  original=subprocess.check_output(['git','-C',str(args.upstream),'show',manifest['commit']+':'+item['path']])
  if hashlib.sha256(original).hexdigest()!=item.get('upstreamSha256',item['sha256']):raise SystemExit('Pinned upstream mismatch: '+item['path'])
  if transform(item['path'],original)!=body:raise SystemExit('Local policy is not reproducible: '+item['path'])
print(f"PASS: {len(manifest['files'])-patched} unchanged source hashes and {patched} reviewed local presentation patches at {manifest['commit']}"+('; reproduced from upstream Git objects'if args.upstream else ''))
