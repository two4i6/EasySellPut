#!/usr/bin/env python3
"""Actual signed liquidity A/B through fixed CLI + persistent official MCP. Fixture trust only in test host."""
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
with tempfile.TemporaryDirectory(prefix='liquidity fixed host ') as folder:
    root=pathlib.Path(folder);key=root/'fixture.pem';public=root/'public.pem';profile=root/'profile'
    subprocess.run(['openssl','ecparam','-name','prime256v1','-genkey','-noout','-out',str(key)],check=True)
    subprocess.run(['openssl','pkey','-in',str(key),'-pubout','-out',str(public)],check=True)
    command=['dotnet',str(host),'--app-fixture',str(public),node]
    def install(version):
        archive=root/(version+'.espapp')
        subprocess.run(['python3','build/pack-app.py','--app','market-liquidity','--repository','test/source','--version',version,'--key',str(key),'--output',str(archive)],check=True,capture_output=True)
        subprocess.run([*command,'install',str(profile),str(archive)],check=True,capture_output=True,timeout=20)
    install('1.0.0')
    client=Mcp(command,str(profile))
    try:
        pid=client.process.pid
        for version in ('1.0.0','1.0.1'):
            if version=='1.0.1':install(version)
            tools=client.request('tools/list')['result']['tools']
            assert len([tool for tool in tools if tool['name']=='get_market_liquidity'])==1
            assert not any('install' in tool['name'] and 'app' in tool['name'] for tool in tools)
            response=client.call('get_market_liquidity',{})
            assert not response.get('isError'),response
            report=response['structuredContent']['data']
            assert report['pressureIndex']['score']==49.8 and len(report['metrics'])==6 and len(report['sectors'])==11
            cli=run(command,str(profile),'get_market_liquidity')['data']
            assert cli['metrics']==report['metrics'] and cli['pressureIndex']==report['pressureIndex']
            assert [s['relativeDollarVolume'] for s in cli['sectors']]==[s['relativeDollarVolume'] for s in report['sectors']]
            assert client.process.pid==pid
        # Uninstall through the real CLI manager, not a protocol-only fake. User data remain untouched.
        marker=profile/'apps/data/easysellput.market-liquidity/keep.txt';marker.parent.mkdir(parents=True);marker.write_text('preserve')
        subprocess.run([*command,'apps','uninstall','easysellput.market-liquidity','--data-dir',str(profile),'--json'],check=True,capture_output=True,timeout=20)
        tools=client.request('tools/list')['result']['tools']
        assert 'get_market_liquidity' not in {tool['name'] for tool in tools}
        rejected=client.call('get_market_liquidity',{})
        assert rejected.get('isError'),rejected
        assert marker.read_text()=='preserve'
        install('1.0.1')
        assert client.call('get_market_liquidity',{})['structuredContent']['data']['pressureIndex']['score']==49.8
        assert marker.read_text()=='preserve'
    finally:client.close()
assert hashlib.sha256(host.read_bytes()).hexdigest()==before
print('PASS: actual signed liquidity A/B CLI + persistent MCP, stable contract, uninstall/reinstall/data preservation and fixed host hash (fixture)')
