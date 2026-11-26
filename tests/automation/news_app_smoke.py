#!/usr/bin/env python3
"""Signed news archive + real engine framing. Synthetic replies never open article URLs."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import tempfile
import zipfile


def check(archive,public_key,repository):
    with tempfile.TemporaryDirectory(prefix='news app ') as folder:
        root=pathlib.Path(folder)
        with zipfile.ZipFile(archive) as package:
            manifest=json.loads(package.read('app.json'))
            assert manifest['id']=='easysellput.news-fundamentals' and manifest['repository']==repository and manifest['ui'] is None
            assert set(package.namelist())=={f['path'] for f in manifest['files']}|{'app.json','app.sig'}
            for f in manifest['files']:
                body=package.read(f['path']);assert len(body)==f['size'] and hashlib.sha256(body).hexdigest()==f['sha256']
            for name in ('app.json','app.sig'):(root/name).write_bytes(package.read(name))
            script=root/'report.mjs';script.write_bytes(package.read(manifest['engine']))
            ops=json.loads(package.read('operations.json'))
            assert {o['name'] for o in ops}=={'get_news','get_fundamentals','get_financials'}
        verify="import{verify}from'node:crypto';import{readFileSync}from'node:fs';if(!verify('sha256',readFileSync(process.argv[1]),readFileSync(process.argv[2]),readFileSync(process.argv[3])))process.exit(1);"
        subprocess.run(['node','--input-type=module','-e',verify,str(root/'app.json'),str(public_key),str(root/'app.sig')],check=True)
        for op in ops:
            assert op['writes'] is False and op['hostOperations']==[op['name']]
            args={'symbol':'AAPL'}|({'limit':30}if op['name']=='get_news' else{})
            value=[dict(title='原始新闻',url='https://example.com/article?q=literal',published=None,source='fixture')]if op['name']=='get_news' else dict(symbol='AAPL',source='fixture',asOf=None,missing=None)
            request=dict(protocol=1,framing='host-jsonl-v1',operation=op['name'],arguments=args,context=dict(appId=manifest['id'],hostOperations=[op['name']]))
            for reply in (dict(success=True,data=value),dict(success=False,error=dict(code='data_source_error',message='fixture source failed'))):
                result=subprocess.run(['node',str(script)],input=json.dumps(request)+'\n'+json.dumps(dict(type='hostResult',id=1,result=reply))+'\n',text=True,encoding="utf-8",capture_output=True,timeout=15,check=True)
                frames=[json.loads(line)for line in result.stdout.splitlines()]
                assert frames[0]==dict(type='hostCall',id=1,operation=op['name'],arguments=args)
                assert len(frames)==2
                if reply['success']:assert frames[1]['result']==value
                else:assert frames[1]['result']['$appError']['code']=='data_source_error'
    print('PASS: signed news core, three real engine operations, exact sources/URLs/null dates and source-error propagation (fixture)')


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--archive',type=pathlib.Path,required=True);p.add_argument('--public-key',type=pathlib.Path,required=True);p.add_argument('--repository',required=True)
    a=p.parse_args();check(a.archive,a.public_key,a.repository)
