#!/usr/bin/env python3
"""Real signed archive/Node execution with synthetic host replies; no provider claims."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import tempfile
import zipfile


def check(archive, public_key, repository):
    with tempfile.TemporaryDirectory(prefix='liquidity app ') as folder:
        root=pathlib.Path(folder)
        with zipfile.ZipFile(archive) as package:
            body=package.read('app.json');manifest=json.loads(body)
            assert manifest['id']=='easysellput.market-liquidity' and manifest['repository']==repository
            assert manifest['ui'] is None and manifest['runtime']=='node24'
            assert manifest['engine']=='engine/report.mjs'
            assert set(package.namelist())=={f['path'] for f in manifest['files']}|{'app.json','app.sig'}
            for file in manifest['files']:
                payload=package.read(file['path'])
                assert len(payload)==file['size'] and hashlib.sha256(payload).hexdigest()==file['sha256']
            operations=json.loads(package.read('operations.json'))
            assert len(operations)==1 and operations[0]['name']=='get_market_liquidity'
            assert operations[0]['writes'] is False and operations[0]['hostOperations']==['get_market_liquidity']
            for name in ('app.json','app.sig'):(root/name).write_bytes(package.read(name))
            script=root/'report.mjs';script.write_bytes(package.read(manifest['engine']))
        verify="import{verify}from'node:crypto';import{readFileSync}from'node:fs';if(!verify('sha256',readFileSync(process.argv[1]),readFileSync(process.argv[2]),readFileSync(process.argv[3])))process.exit(1);"
        subprocess.run(['node','--input-type=module','-e',verify,str(root/'app.json'),str(public_key),str(root/'app.sig')],check=True)
        report={'generatedAt':'2026-11-16T12:00:00Z','metrics':[{'id':'sofr_iorb','latest':None,'unavailableReason':'fixture missing','observations':[]}],'sectors':[], 'pressureIndex':{'score':None,'band':'unavailable'}}
        request=dict(protocol=1,framing='host-jsonl-v1',operation='get_market_liquidity',arguments={},context=dict(appId=manifest['id'],appVersion=manifest['version'],hostOperations=['get_market_liquidity']))
        reply=dict(type='hostResult',id=1,result=dict(success=True,data=report))
        for result in (reply,dict(type='hostResult',id=1,result=dict(success=False,error=dict(code='data_source_error',message='fixture offline')))):
            completed=subprocess.run(['node',str(script)],input=json.dumps(request)+'\n'+json.dumps(result)+'\n',text=True,capture_output=True,timeout=15,check=True)
            frames=[json.loads(line) for line in completed.stdout.splitlines()]
            assert frames[0]==dict(type='hostCall',id=1,operation='get_market_liquidity',arguments={})
            assert len(frames)==2 and frames[1]['type']=='result'
            if result['result']['success']:assert frames[1]['result']==report
            else:assert frames[1]['result']['$appError']['code']=='data_source_error'
        bad=request|{'arguments':{'unexpected':True}}
        completed=subprocess.run(['node',str(script)],input=json.dumps(bad)+'\n',text=True,capture_output=True,timeout=15,check=True)
        assert json.loads(completed.stdout)['result']['$appError']['code']=='invalid_arguments'
    print('PASS: signed liquidity package, exact shared snapshot, missingness, host errors and argument rejection (fixture)')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--archive',type=pathlib.Path,required=True);parser.add_argument('--public-key',type=pathlib.Path,required=True);parser.add_argument('--repository',required=True)
    args=parser.parse_args();check(args.archive,args.public_key,args.repository)
