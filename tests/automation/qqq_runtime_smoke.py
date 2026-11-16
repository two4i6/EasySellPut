#!/usr/bin/env python3
"""Run the packaged GEX model without a system Node executable; then reject tampering."""
import argparse,json,pathlib,subprocess,tempfile,os
p=argparse.ArgumentParser();p.add_argument('--executable',type=pathlib.Path,required=True);a=p.parse_args()
with tempfile.TemporaryDirectory(prefix='qqq runtime data ') as folder:
 root=pathlib.Path(folder);(root/'cache').mkdir()
 raw={'symbol':'QQQ','source':'synthetic package fixture','bars':[{'timestamp':'2026-01-02T14:30:00Z','open':600,'high':601,'low':599,'close':600,'volume':100}], 'captures':[{'valuationAt':'2026-01-02T14:32:00Z','expiry':1767571200,'spot':600,'result':{'receivedAt':'2026-01-02T14:32:01Z','options':[{'calls':[{'strike':600,'impliedVolatility':.2,'openInterest':100}],'puts':[{'strike':600,'impliedVolatility':.2,'openInterest':50}]}]}}]}
 (root/'cache/qqq-gex-input.json').write_text(json.dumps(raw));env=dict(os.environ,PATH=str(root/'no executables'))
 command=[str(a.executable.resolve()),'calculate_qqq_gex_local','--allow-writes','--json','--data-dir',str(root),'--timeout','120']
 result=subprocess.run(command,env=env,capture_output=True,text=True,timeout=150);value=json.loads(result.stdout)
 assert result.returncode==0 and value['data']['status']=='imported',value
 replay=subprocess.run([str(a.executable.resolve()),'get_qqq_gex_replay','--from','2026-01-02T05:00:00Z','--to','2026-01-03T05:00:00Z','--json','--data-dir',str(root)],env=env,capture_output=True,text=True,timeout=60);response=json.loads(replay.stdout);assert replay.returncode==0 and response['data']['available'] and response['data']['fingerprint']==response['data']['repeatedFingerprint'],response
 binaries=list((root/'cache/qqq-runtime').rglob('node.exe' if os.name=='nt' else 'node'));assert len(binaries)==1
 assert subprocess.check_output([str(binaries[0]),'--version'],env=env,text=True).strip()=='v24.22.1'
 with binaries[0].open('ab') as f:f.write(b'tampered')
 rejected=subprocess.run(command,env=env,capture_output=True,text=True,timeout=30);assert rejected.returncode!=0 and not json.loads(rejected.stdout)['success'],rejected.stdout
 print('PASS: packaged GEX calculation without system Node; extracted runtime tampering rejected')
