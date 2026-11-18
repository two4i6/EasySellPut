#!/usr/bin/env python3
"""Signed options A/B through unchanged CLI + persistent MCP; real data files, explicit writes, isolated fixture trust."""
import hashlib,json,pathlib,shutil,subprocess,tempfile
from cli_mcp_smoke import Mcp,run
from check_capability_coverage import verify,pointer
host=pathlib.Path('tests/Meili.Automation.Host/bin/Release/net10.0/Meili.Automation.Host.dll').resolve()
before=hashlib.sha256(host.read_bytes()).hexdigest();node=shutil.which('node');assert node
ops=json.loads(pathlib.Path('web/options-strategy/operations.json').read_text());names={o['name']for o in ops};writes={o['name']for o in ops if o['writes']}
cases=[c for c in json.loads(pathlib.Path('tests/automation/capability_cases.json').read_text())['cases']if c['operation']in names]
assert len(cases)==12
with tempfile.TemporaryDirectory(prefix='options fixed host ')as temp:
 root=pathlib.Path(temp);key=root/'fixture.pem';public=root/'public.pem'
 subprocess.run(['openssl','ecparam','-name','prime256v1','-genkey','-noout','-out',str(key)],check=True)
 subprocess.run(['openssl','pkey','-in',str(key),'-pubout','-out',str(public)],check=True)
 command=['dotnet',str(host),'--app-fixture',str(public),node]
 profiles=[root/'cli',root/'mcp'];[p.mkdir()for p in profiles]
 bookmarks=profiles[1]/'web-workspace.json';bookmarks.write_text('{"SchemaVersion":1,"Tabs":[]}');bookmark_hash=hashlib.sha256(bookmarks.read_bytes()).hexdigest()
 def install(version):
  archive=root/(version+'.espapp')
  if not archive.exists():subprocess.run(['python3','build/pack-app.py','--app','options-strategy','--repository','test/source','--version',version,'--key',str(key),'--output',str(archive)],check=True,capture_output=True)
  for p in profiles:subprocess.run([*command,'install',str(p),str(archive)],check=True,capture_output=True,timeout=25)
 install('1.0.0');reader=Mcp(command,str(profiles[1]));writer=Mcp(command,str(profiles[1]),writes=True,response_timeout=30)
 try:
  pid=writer.process.pid
  for version in ['1.0.0','1.0.1']:
   if version=='1.0.1':install(version)
   advertised={t['name']for t in reader.request('tools/list')['result']['tools']};assert names-writes<=advertised and not writes&advertised
   for case in cases:
    name=case['operation'];args=case['arguments'];file=root/'arguments.json';file.write_text(json.dumps(args))
    if name in writes:assert reader.call(name,args).get('isError')
    cli=run(command,str(profiles[0]),name,'--input',str(file),'--allow-writes')
    result=writer.call(name,args);assert not result.get('isError'),result;mcp=result['structuredContent']
    verify(case,cli,{});verify(case,mcp,{})
    for path in case['compare']:assert pointer(cli,path)==pointer(mcp,path),(name,path)
   assert writer.process.pid==pid
  saved=next(c for c in cases if c['operation']=='save_strategy')['arguments']|{'name':'Retained entry'}
  assert not writer.call('save_strategy',saved).get('isError')
  strategy=profiles[1]/'strategies.json';original=strategy.read_bytes()
  marker=profiles[1]/'apps/data/easysellput.options-strategy/keep';marker.parent.mkdir(parents=True);marker.write_text('retain')
  subprocess.run([*command,'apps','uninstall','easysellput.options-strategy','--data-dir',str(profiles[1]),'--json'],check=True,capture_output=True,timeout=25)
  tools={t['name']for t in reader.request('tools/list')['result']['tools']};assert not names&tools and 'calculate_option'in tools and 'get_quotes'in tools
  assert writer.call('get_saved_strategies',{}).get('isError');assert strategy.read_bytes()==original and marker.read_text()=='retain'
  assert hashlib.sha256(bookmarks.read_bytes()).hexdigest()==bookmark_hash
  install('1.0.1');assert not writer.call('get_saved_strategies',{}).get('isError');assert strategy.read_bytes()==original
 finally:
  # Two initialized sessions intentionally share this profile; assert cleanup after BOTH owners stop.
  for client in [reader,writer]:client.process.stdin.close()
  for client in [reader,writer]:assert client.process.wait(timeout=15)==0,''.join(client.errors)
  assert not list((profiles[1]/'.mcp-runtime').glob('*.json'))
assert hashlib.sha256(host.read_bytes()).hexdigest()==before
print('PASS: twelve signed options A/B operations, read/write permission parity, retained entry prices/data, lifecycle and fixed host (fixture)')
