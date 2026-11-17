#!/usr/bin/env python3
"""Run the packaged GEX model without a system Node executable; then reject tampering."""
import argparse,json,pathlib,subprocess,tempfile,os,base64,shutil
from cli_mcp_smoke import Mcp
p=argparse.ArgumentParser();p.add_argument('--executable',type=pathlib.Path,required=True);a=p.parse_args()
with tempfile.TemporaryDirectory(prefix='qqq runtime data ') as folder:
 root=pathlib.Path(folder);(root/'cache').mkdir()
 raw={'symbol':'QQQ','source':'synthetic package fixture','bars':[{'timestamp':'2026-01-02T14:30:00Z','open':600,'high':601,'low':599,'close':600,'volume':100}], 'captures':[{'valuationAt':'2026-01-02T14:32:00Z','expiry':1767571200,'spot':600,'result':{'receivedAt':'2026-01-02T14:32:01Z','options':[{'calls':[{'strike':600,'impliedVolatility':.2,'openInterest':100}],'puts':[{'strike':600,'impliedVolatility':.2,'openInterest':50}]}]}}]}
 (root/'cache/qqq-gex-input.json').write_text(json.dumps(raw));env=dict(os.environ,PATH=str(root/'no executables'))
 command=[str(a.executable.resolve()),'calculate_qqq_gex_local','--allow-writes','--json','--data-dir',str(root),'--timeout','120']
 result=subprocess.run(command,env=env,capture_output=True,text=True,timeout=150);value=json.loads(result.stdout)
 assert result.returncode==0 and value['data']['status']=='imported',value
 replay=subprocess.run([str(a.executable.resolve()),'get_qqq_gex_replay','--from','2026-01-02T05:00:00Z','--to','2026-01-03T05:00:00Z','--json','--data-dir',str(root)],env=env,capture_output=True,text=True,timeout=60);response=json.loads(replay.stdout);assert replay.returncode==0 and response['data']['available'] and response['data']['fingerprint']==response['data']['repeatedFingerprint'],response
 # Two thousand distinct strike filters exceed the Windows command-line limit.
 # The final valid strike proves the bounded stdin query was not truncated.
 old_path=os.environ.get('PATH','');os.environ['PATH']=env['PATH'];reader=None
 try:
  reader=Mcp([str(a.executable.resolve())],folder,response_timeout=120)
  strikes=[499.123456789+i*.0000001 for i in range(1999)]+[600]
  response=reader.call('get_qqq_gex_view',{'resource':'analysis','analysis':'exposure','date':'2026-01-02','expiry':'2026-01-05','at':'2026-01-02T14:35:00Z','strikes':strikes,'length':262144})
  assert not response.get('isError'),response
  chunk=response['structuredContent']['data'];assert chunk.get('available') and not chunk['hasMore'],chunk
  model=json.loads(base64.b64decode(chunk['bodyBase64']));assert model['available'] and any(point[0]==600 for point in model['result']['values']),model
 finally:
  if reader:reader.close()
  os.environ['PATH']=old_path
 # First expansion is shared by simultaneous read/write consumers, not an overwrite
 # of a running Windows node.exe. Copy only the closed fixture's retained input/store.
 shared=root/'parallel profile';shutil.copytree(root/'cache',shared/'cache')
 parallel=[]
 for operation,arguments in [('calculate_qqq_gex_local',[]),('get_qqq_gex_replay',['--from','2026-01-02T05:00:00Z','--to','2026-01-03T05:00:00Z'])]:
  parallel.append(subprocess.Popen([str(a.executable.resolve()),operation,*arguments,'--json','--data-dir',str(shared),'--timeout','120'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True))
 for process in parallel:
  stdout,stderr=process.communicate(timeout=150)
  assert process.returncode==0 and json.loads(stdout)['success'],(stdout,stderr)
 assert len(list((shared/'apps/runtimes/node24').rglob('node.exe' if os.name=='nt' else 'node')))==1
 binaries=list((root/'apps/runtimes/node24').rglob('node.exe' if os.name=='nt' else 'node'));assert len(binaries)==1
 assert subprocess.check_output([str(binaries[0]),'--version'],env=env,text=True).strip()=='v24.22.1'
 with binaries[0].open('ab') as f:f.write(b'tampered')
 rejected=subprocess.run(command,env=env,capture_output=True,text=True,timeout=30);assert rejected.returncode!=0 and not json.loads(rejected.stdout)['success'],rejected.stdout
 print('PASS: packaged GEX calculation and 2,000-strike read-only MCP query without system Node; extracted runtime tampering rejected')
