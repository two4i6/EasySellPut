#!/usr/bin/env python3
"""Exercise real app re-signing/catalog/draft promotion offline. All GitHub writes are intercepted."""
import argparse
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
from unittest import mock

ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'build/release'))
spec=importlib.util.spec_from_file_location('app_release_smoke_target',ROOT/'build/release/app-release.py')
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
parser=argparse.ArgumentParser();parser.add_argument('--app',choices=['qqq-gex','market-liquidity','news-fundamentals'],default='qqq-gex');parser.add_argument('--archive',type=pathlib.Path,required=True);parser.add_argument('--key',type=pathlib.Path,required=True);parser.add_argument('--public-key',type=pathlib.Path,required=True);parser.add_argument('--repository',required=True);args=parser.parse_args()
plan=dict(repository=args.repository,sourceCommit='a'*40,ciRunId=123)
with tempfile.TemporaryDirectory(prefix='offline app release ') as directory:
    root=pathlib.Path(directory);prepared=root/'prepared';prepared.mkdir();published=root/'published';published.mkdir()
    version=json.loads(__import__('zipfile').ZipFile(args.archive).read('app.json'))['version']
    options=argparse.Namespace(artifact=args.archive,version=version,run_id='123',app=args.app)
    app_id=release.definition(args.app)['id']
    try:release.validate_package(args.archive,args.repository,version,'market-liquidity' if args.app=='qqq-gex' else 'qqq-gex')
    except ValueError:pass
    else:raise AssertionError('Foreign app artifact accepted')
    calls=[];native_run=subprocess.run
    def run(command,*positional,**kwargs):
        if command[:2]==['gh','api']:
            return subprocess.CompletedProcess(command,1,stdout='',stderr='gh: Not Found (HTTP 404)')
        assert command[0]=='openssl', command
        return native_run(command,*positional,**kwargs)
    def gh(*command):
        calls.append(tuple(map(str,command)))
        if command[:2]==('release','view'):
            names=[f'{app_id}-{version}.espapp',release.CATALOG,release.CATALOG+'.sig','app-release.json','app-release.json.sig']
            return json.dumps(dict(isDraft=True,isPrerelease=True,targetCommitish=plan['sourceCommit'],assets=[dict(name=n)for n in names]))
        if command[:2]==('release','download'):
            name=command[command.index('--pattern')+1];target=pathlib.Path(command[command.index('--dir')+1]);shutil.copyfile(prepared/name,target/name)
        return ''
    with mock.patch.object(release,'PUBLIC',args.public_key),mock.patch.object(release,'select',return_value=plan),mock.patch.object(release,'previous_catalog',return_value=None),mock.patch.object(release,'gh',side_effect=gh),mock.patch.object(release.subprocess,'run',side_effect=run),mock.patch.dict(os.environ,dict(UPDATE_SIGNING_KEY=args.key.read_text(),GITHUB_RUN_ID='1000')):
        release.prepare(options,plan,prepared)
        assert not (prepared/'private.pem').exists()
        create=next(c for c in calls if c[:2]==('release','create'))
        assert '--draft' in create and '--prerelease' in create
        index=json.loads((prepared/'app-release.json').read_text());catalog=json.loads((prepared/release.CATALOG).read_text())
        assert catalog['apps'][0]['sha256']==index['sha256'] and index['sourceCommit']==plan['sourceCommit']
        release.publish(options,plan,published)
        writes=[c for c in calls if c[:2]in[('release','edit'),('release','create'),('release','upload')]]
        assert all('--latest=false' in c for c in writes if c[:2]==('release','edit') or (c[:2]==('release','create') and c[2]=='apps'))
        assert any(c[:3]==('release','upload','apps')for c in writes)
        # Another draft must not overwrite a newer catalog, even though its package remains correctly signed.
        blocked=root/'blocked';blocked.mkdir();before=len(writes)
        with mock.patch.object(release,'previous_catalog',return_value=dict(sequence=1001,apps=[])):
            try:release.publish(options,plan,blocked)
            except ValueError:pass
            else:raise AssertionError('Stale catalog publication was accepted')
        assert len([c for c in calls if c[:2]in[('release','edit'),('release','create'),('release','upload')]])==before
print('PASS: real re-signing, signed catalog/provenance, draft then explicit non-Latest promotion, private-key cleanup and stale-catalog rejection (all GitHub writes intercepted)')
