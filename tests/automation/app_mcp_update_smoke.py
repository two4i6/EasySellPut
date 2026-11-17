#!/usr/bin/env python3
"""Fixed-host signed app updates through real CLI/official SDK MCP; fixture trust exists only in test host."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import queue
import time
from cli_mcp_smoke import Mcp, run

host = pathlib.Path('tests/Meili.Automation.Host/bin/Release/net10.0/Meili.Automation.Host.dll').resolve()
node = shutil.which('node')
assert node, 'Node 24 test runtime required'
before = hashlib.sha256(host.read_bytes()).hexdigest()
base = ['dotnet', str(host)]
with tempfile.TemporaryDirectory(prefix='signed apps and MCP ') as directory:
    root = pathlib.Path(directory); fixtures = root / 'fixtures'
    subprocess.run([*base, '--app-fixture-build', str(fixtures)], check=True, timeout=20)
    command = [*base, '--app-fixture', str(fixtures / 'public.pem'), node]
    for protocol,subscribe in [('2025-06-18',False),('2025-11-25',False),('2026-07-28',False),('2026-07-28',True)]:
        profile = root / (protocol + ("-subscribed" if subscribe else ""))
        def install(version):
            completed = subprocess.run([*command, 'install', str(profile), str(fixtures / (version + '.espapp'))], capture_output=True, text=True, timeout=20)
            assert completed.returncode == 0, (completed.stdout, completed.stderr)
        install('1.0.0')
        class Client(Mcp):
            def request(self, method, params=None):
                if method == 'initialize' and protocol == '2026-07-28':
                    discovered = super().request('server/discover', {})
                    assert 'result' in discovered and '2026-07-28' in discovered['result']['supportedVersions'], discovered
                    info = discovered['result']['_meta']['io.modelcontextprotocol/serverInfo']
                    return {'result': dict(serverInfo=info, capabilities=discovered['result']['capabilities'])}
                return super().request(method, params)
            def send(self, message):
                if protocol == '2026-07-28':
                    if message.get('method') == 'notifications/initialized':
                        return
                    message.setdefault('params', {})['_meta'] = {
                        'io.modelcontextprotocol/protocolVersion': protocol,
                        'io.modelcontextprotocol/clientCapabilities': {},
                        'io.modelcontextprotocol/clientInfo': dict(name='EasySellPut app fixture',version='1.0')}
                elif message.get('method') == 'initialize':
                    message['params']['protocolVersion'] = protocol
                super().send(message)
        print("Checking", protocol, flush=True)
        client = Client(command, str(profile))
        try:
            names = {t['name'] for t in client.request('tools/list')['result']['tools']}
            assert 'app_easysellput_test_summary' in names and 'app_easysellput_test_record' not in names
            assert 'app_easysellput_test_added' not in names
            a = client.call('app_easysellput_test_summary', {})
            assert a['structuredContent']['data']['version'] == '1.0.0'
            market=client.call('app_easysellput_test_market',{})['structuredContent']['data']
            quote=market['quotes'][0]
            assert quote['source']=='fixture' and quote['price']==100 and quote['delayMinutes']==15 and quote['asOf']=='2026-11-13T15:00:00+00:00',quote
            assert run(command,str(profile),'app_easysellput_test_market')['data']==market
            denied = client.call('app_easysellput_test_record', {})
            assert denied['isError'] and not denied['structuredContent']['success']
            pid = client.process.pid
            if subscribe:
                client.send({'jsonrpc':'2.0','id':9000,'method':'subscriptions/listen','params':{'notifications':{'toolsListChanged':True}}})
                ack=client.messages.get(timeout=10)
                assert ack.get('method')=='notifications/subscriptions/acknowledged',ack
                assert ack['params']['_meta']['io.modelcontextprotocol/subscriptionId']==9000 and ack['params']['notifications']['toolsListChanged'] is True,ack
            install('1.0.1')  # An initialized, idle MCP connection does not pin app A.
            if protocol != '2026-07-28' or subscribe:
                deadline=time.monotonic()+10
                while not any(m.get('method')=='notifications/tools/list_changed' for m in client.notifications):
                    remaining=deadline-time.monotonic()
                    assert remaining>0,('No app catalog change notification',client.notifications,client.errors)
                    try:message=client.messages.get(timeout=remaining)
                    except queue.Empty:raise AssertionError('MCP app update notification timed out')
                    assert 'id' not in message,message
                    client.notifications.append(message)
            refreshed = client.request('tools/list')['result']
            assert 'app_easysellput_test_added' in {t['name'] for t in refreshed['tools']}
            if protocol == '2026-07-28':
                assert refreshed['ttlMs'] == 0 and refreshed['cacheScope'] == 'private'
                if not subscribe:assert not client.notifications,client.notifications
                else:
                    event=next(m for m in client.notifications if m.get('method')=='notifications/tools/list_changed')
                    assert event['params']['_meta']['io.modelcontextprotocol/subscriptionId']==9000,event
            resource = client.request('resources/read', {'uri':'easysellput://capabilities'})
            capabilities = json.loads(resource['result']['contents'][0]['text'])
            assert 'app_easysellput_test_added' in {o['name'] for o in capabilities['operations']}
            b = client.call('app_easysellput_test_summary', {})
            assert b['structuredContent']['data']['version'] == '1.0.1' and client.process.pid == pid
            result = run(command, str(profile), 'app_easysellput_test_summary')
            assert result['data'] == b['structuredContent']['data']
            invalid = client.call('app_easysellput_test_summary', {'unexpected': True})
            assert invalid['isError']
            if subscribe:
                client.send({'jsonrpc':'2.0','method':'notifications/cancelled','params':{'requestId':9000,'reason':'fixture complete'}})
                assert 'result' in client.request('tools/list')
        finally:
            client.close()
        writer = Client(command, str(profile), writes=True)
        try:
            assert writer.call('app_easysellput_test_record', {})['structuredContent']['data']['allowWrites'] is True
        finally:
            writer.close()
assert hashlib.sha256(host.read_bytes()).hexdigest() == before
print('PASS: fixed host, signed app A/B, long-lived official MCP in 2025/2026 modes, CLI parity, read-only enforcement and EOF (fixture trust only)')
