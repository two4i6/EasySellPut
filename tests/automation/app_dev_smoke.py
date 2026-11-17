#!/usr/bin/env python3
"""Separate development host: scratch-only execution and unchanged production trust/binaries."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import tempfile
parser=argparse.ArgumentParser();parser.add_argument('--archive',type=pathlib.Path,required=True);parser.add_argument('--public-key',type=pathlib.Path,required=True);args=parser.parse_args()
host=pathlib.Path('tools/Meili.AppDev/bin/Release/net10.0/Meili.AppDev.dll').resolve()
production=pathlib.Path('src/Meili.Cli/bin/Release/net10.0/easysellput.dll').resolve()
before=hashlib.sha256(production.read_bytes()).hexdigest()
base=['dotnet',str(host),'--package',str(args.archive.resolve()),'--public-key',str(args.public_key.resolve()),'--repository','test/source']
result=subprocess.run([*base,'--operation','get_qqq_gex_retained_summary'],capture_output=True,text=True,timeout=30)
assert result.returncode==0,(result.stdout,result.stderr)
body=json.loads(result.stdout);assert body['success'] and body['data']['status']=='empty' and body['data']['storageAvailable'] is False
with tempfile.TemporaryDirectory(prefix='never select this user profile ')as directory:
    root=pathlib.Path(directory);data=root/'history';data.write_text('retained observations')
    denied=subprocess.run([*base,'--data-dir',directory],capture_output=True,text=True,timeout=20)
    assert denied.returncode==2 and not denied.stdout and data.read_text()=='retained observations'
    rejected=subprocess.run(['dotnet',str(production),'apps','install','--package',str(args.archive.resolve()),'--data-dir',directory,'--json'],capture_output=True,text=True,timeout=20)
    assert rejected.returncode!=0 and json.loads(rejected.stdout)['success'] is False
    assert not (root/'apps'/'registry.json').exists() and data.read_text()=='retained observations'
assert hashlib.sha256(production.read_bytes()).hexdigest()==before
names=[item for item in json.loads(host.with_suffix('.deps.json').read_text())['libraries']]
assert not any(name.split('/')[0]in['Meili.Shared','Meili.App','Meili.Mac']for name in names)
print('PASS: independent scratch-only developer host, actual GEX evidence operation, unchanged production binary/trust and no GUI assembly dependencies')
