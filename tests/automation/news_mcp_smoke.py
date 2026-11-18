#!/usr/bin/env python3
"""Actual signed news A/B through fixed CLI + persistent official MCP. Fixture trust only in test host."""
import json
import hashlib
import pathlib
import shutil
import subprocess
import tempfile
from cli_mcp_smoke import Mcp, run

host=pathlib.Path('tests/Meili.Automation.Host/bin/Release/net10.0/Meili.Automation.Host.dll').resolve()
node=shutil.which('node')
assert node
before=hashlib.sha256(host.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix='news fixed host ') as folder:
    root=pathlib.Path(folder);key=root/'fixture.pem';public=root/'public.pem';profile=root/'profile'
    subprocess.run(['openssl','ecparam','-name','prime256v1','-genkey','-noout','-out',str(key)],check=True)
    subprocess.run(['openssl','pkey','-in',str(key),'-pubout','-out',str(public)],check=True)
    command=['dotnet',str(host),'--app-fixture',str(public),node]
    def install(version):
        archive=root/(version+'.espapp')
        subprocess.run(['python3','build/pack-app.py','--app','news-fundamentals','--repository','test/source','--version',version,'--key',str(key),'--output',str(archive)],check=True,capture_output=True)
        subprocess.run([*command,'install',str(profile),str(archive)],check=True,capture_output=True,timeout=20)
    profile.mkdir(parents=True)
    bookmarks=profile/'web-workspace.json'
    bookmarks.write_text(json.dumps(dict(SchemaVersion=1,ReduceMotion=False,Tabs=[dict(Id='a'*32,Name='Personal',Url='https://example.com/personal')])))
    bookmark_hash=hashlib.sha256(bookmarks.read_bytes()).hexdigest()
    install('1.0.0')
    client=Mcp(command,str(profile))
    try:
        pid=client.process.pid
        for version in ('1.0.0','1.0.1'):
            if version=='1.0.1':install(version)
            for name,args in [('get_news',{'symbol':'AAPL','limit':30}),('get_fundamentals',{'symbol':'AAPL'}),('get_financials',{'symbol':'AAPL'})]:
                tools=client.request('tools/list')['result']['tools']
                assert len([t for t in tools if t['name']==name])==1
                response=client.call(name,args)
                assert not response.get('isError'),response
                result=response['structuredContent']['data']
                cli=run(command,str(profile),name,*[part for k,v in args.items()for part in ('--'+k,str(v))])['data']
                assert cli==result
                if name=='get_news':assert result[0]['url']=='https://example.com' and result[0]['source']=='fixture'
                else:assert result['symbol']=='AAPL' and result['source']=='fixture'
            assert client.process.pid==pid
        assert client.call('get_news',{'symbol':'AAPL','limit':51}).get('isError')
        # Uninstall through the real CLI manager, not a protocol-only fake. User data remain untouched.
        marker=profile/'apps/data/easysellput.news-fundamentals/keep.txt';marker.parent.mkdir(parents=True);marker.write_text('preserve')
        subprocess.run([*command,'apps','uninstall','easysellput.news-fundamentals','--data-dir',str(profile),'--json'],check=True,capture_output=True,timeout=20)
        tools=client.request('tools/list')['result']['tools']
        assert not {'get_news','get_fundamentals','get_financials'} & {tool['name'] for tool in tools}
        rejected=client.call('get_news',{'symbol':'AAPL'})
        assert rejected.get('isError'),rejected
        assert marker.read_text()=='preserve'
        install('1.0.1')
        assert client.call('get_news',{'symbol':'AAPL'})['structuredContent']['data'][0]['source']=='fixture'
        assert marker.read_text()=='preserve'
        assert hashlib.sha256(bookmarks.read_bytes()).hexdigest()==bookmark_hash
    finally:client.close()
assert hashlib.sha256(host.read_bytes()).hexdigest()==before
print('PASS: actual signed news A/B CLI + persistent MCP, stable contract, uninstall/reinstall/data preservation and fixed host hash (fixture)')
