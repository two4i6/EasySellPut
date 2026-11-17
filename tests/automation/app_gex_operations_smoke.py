#!/usr/bin/env python3
"""Actual GEX model behind signed app A/B, fixed host, optional UI and retained data (offline fixture)."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import zipfile
import tarfile
import platform
import os
import sqlite3
from cli_mcp_smoke import Mcp, run

parser=argparse.ArgumentParser();parser.add_argument('--archive',type=pathlib.Path,required=True);parser.add_argument('--bundle-directory',type=pathlib.Path);args=parser.parse_args()
host=pathlib.Path('tests/Meili.Automation.Host/bin/Release/net10.0/Meili.Automation.Host.dll').resolve()
node=shutil.which('node');assert node,'Node 24 fixture runtime required'
dotnet=shutil.which('dotnet');assert dotnet
base=[dotnet,str(host)];before=hashlib.sha256(host.read_bytes()).hexdigest()
model=pathlib.Path('web/qqq-gex/runtime-dist').resolve()
with zipfile.ZipFile(args.archive)as archive:declared={op['name']for op in json.loads(archive.read('operations.json'))}
with tempfile.TemporaryDirectory(prefix='actual GEX signed app ')as directory:
 root=pathlib.Path(directory)
 if args.bundle_directory:
  system='win'if os.name=='nt'else'osx'if platform.system()=='Darwin'else'linux'
  architecture='arm64'if platform.machine().lower()in('arm64','aarch64')else'x64'
  locked=json.loads(pathlib.Path('web/qqq-gex/node-runtime-lock.json').read_text())['platforms'][system+'-'+architecture]
  archive_path=args.bundle_directory.resolve()/'runtime'/locked['archive'];assert hashlib.sha256(archive_path.read_bytes()).hexdigest()==locked['archiveSha256']
  prefix=locked['archive'].removesuffix('.zip').removesuffix('.tar.gz')
  if system=='win':
   with zipfile.ZipFile(archive_path)as archive:binary=archive.read(prefix+'/node.exe')
  else:
   with tarfile.open(archive_path)as archive:binary=archive.extractfile(prefix+'/bin/node').read(256*1024*1024)
  assert hashlib.sha256(binary).hexdigest()==locked['executableSha256']
  runtime=root/('node.exe'if system=='win'else'node');runtime.write_bytes(binary);runtime.chmod(0o700);node=str(runtime)
  os.environ['PATH']=str(root/'no system executables');assert shutil.which('node')is None
 fixtures=root/'fixtures';profile=root/'profile';cache=profile/'cache';cache.mkdir(parents=True)
 subprocess.run([*base,'--gex-app-fixture-build',str(args.archive.resolve()),str(fixtures)],check=True,timeout=30)
 command=[*base,'--app-fixture',str(fixtures/'public.pem'),node]
 raw={'symbol':'QQQ','source':'synthetic package fixture','bars':[{'timestamp':'2026-01-02T14:30:00Z','open':600,'high':601,'low':599,'close':600,'volume':100}], 'captures':[{'valuationAt':'2026-01-02T14:32:00Z','expiry':1767571200,'spot':600,'result':{'receivedAt':'2026-01-02T14:32:01Z','options':[{'calls':[{'strike':600,'impliedVolatility':.2,'openInterest':100}],'puts':[{'strike':600,'impliedVolatility':.2,'openInterest':50}]}]}}]}
 input_file=cache/'qqq-gex-input.json';input_file.write_text(json.dumps(raw));db=cache/'qqq-gex.db';oracle=root/'oracle.db'
 def original(script,*arguments):
  result=subprocess.run([node,str(model/script),*map(str,arguments)],capture_output=True,text=True,check=True,timeout=120);return json.loads(result.stdout)
 expected=original('import.mjs',input_file,oracle)
 def install(name):
  result=subprocess.run([*command,'install',str(profile),str(fixtures/(name+'.espapp'))],capture_output=True,text=True,timeout=30)
  assert result.returncode==0,(result.stdout,result.stderr)
 install('1.0.0-core')
 client=Mcp(command,str(profile))
 try:
  names={t['name']for t in client.request('tools/list')['result']['tools']}
  assert 'get_qqq_gex_replay'in names and 'calculate_qqq_gex_local'not in names and 'rebuild_qqq_gex_history'not in names
  empty=client.call('get_qqq_gex_replay',{'from':'2026-01-02T05:00:00Z','to':'2026-01-03T05:00:00Z'})
  assert empty['structuredContent']['data']['status']=='cache_miss' and not db.exists()
  for operation,arguments in [('get_qqq_gex_archive',{'resource':'dates'}),('get_qqq_gex_live_decision',{})]:
   assert client.call(operation,arguments)['structuredContent']['data']['status']=='cache_miss'
  empty_lifecycle=client.call('get_qqq_gex_lifecycle',{'date':'2026-01-02'})['structuredContent']['data']
  assert empty_lifecycle['available']and not empty_lifecycle['storageAvailable']and empty_lifecycle['points']==[]and not db.exists()
  calculated=run(command,str(profile),'calculate_qqq_gex_local')['data'];assert calculated==expected,(calculated,expected)
  assert calculated['status']=='imported' and calculated['rows']==1
  inventory=client.call('get_qqq_gex_retained_summary',{})['structuredContent']['data']
  assert inventory['publishedDays']==1 and run(command,str(profile),'get_qqq_gex_retained_summary')['data']==inventory
  query='/api/analysis/qqq/pcs/backtest?stream=signals&from=2026-01-02T05%3A00%3A00.0000000%2B00%3A00&to=2026-01-03T05%3A00%3A00.0000000%2B00%3A00&page=1&pageSize=200'
  replay=original('query.mjs',oracle,query);retained=hashlib.sha256(db.read_bytes()).hexdigest()
  requested={'from':'2026-01-02T05:00:00Z','to':'2026-01-03T05:00:00Z'}
  actual=client.call('get_qqq_gex_replay',requested);assert not actual.get('isError'),actual
  assert actual['structuredContent']['data']==replay
  assert run(command,str(profile),'get_qqq_gex_replay','--from',requested['from'],'--to',requested['to'])['data']==replay
  assert hashlib.sha256(db.read_bytes()).hexdigest()==retained
  invalid=client.call('get_qqq_gex_replay',{'from':'2026-02-30T05:00:00Z','to':'2026-03-01T05:00:00Z'})
  assert invalid['isError']and invalid['structuredContent']['error']['code']=='invalid_arguments',invalid
  assert run(command,str(profile),'get_qqq_gex_replay','--from','bad-time','--to',requested['to'],code=2)['error']['code']=='invalid_arguments'
  for resource,arguments in [('dates',{}),('snapshots',{'date':'2026-01-02'}),('bars',{'date':'2026-01-02'}),('providers',{})]:
   from urllib.parse import urlencode
   route='/api/analysis/qqq/local-archive?'+urlencode({'resource':resource,'page':1,'pageSize':100,**arguments})
   expected_archive=original('query.mjs',db,route)
   archive_arguments={'resource':resource,**arguments}
   assert client.call('get_qqq_gex_archive',archive_arguments)['structuredContent']['data']==expected_archive
   flags=[part for key,value in archive_arguments.items()for part in ['--'+key,str(value)]]
   assert run(command,str(profile),'get_qqq_gex_archive',*flags)['data']==expected_archive
  invalid=client.call('get_qqq_gex_archive',{'resource':'snapshots'})
  assert invalid['isError']and invalid['structuredContent']['error']['code']=='invalid_arguments'
  invalid=client.call('get_qqq_gex_archive',{'resource':'dates','page':2})
  assert invalid['isError']and invalid['structuredContent']['error']['code']=='invalid_arguments'
  # The retained fixture lacks required daily PCS source inputs. Preserve the original model rejection.
  rejected=subprocess.run([node,str(model/'query.mjs'),str(oracle),'/api/analysis/qqq/pcs/local-decision?regimeMode=unified'],capture_output=True,timeout=120)
  assert rejected.returncode!=0
  for decision in [client.call('get_qqq_gex_live_decision',{})['structuredContent']['data'],run(command,str(profile),'get_qqq_gex_live_decision')['data']]:
   assert decision['status']=='calculation_failed'and not decision['complete']and decision['exitCode']==rejected.returncode
  lifecycle=client.call('get_qqq_gex_lifecycle',{'date':'2026-01-02'})['structuredContent']['data']
  assert lifecycle['available']and lifecycle['storageAvailable']and not lifecycle['complete']
  with sqlite3.connect(db)as connection:connection.execute('DELETE FROM qqq_gex_pcs_lifecycle')
  point={'time':'2026-01-02T14:32:00Z','status':'fixture observation, not live'};body=json.dumps(point,separators=(',',':'));digest=hashlib.sha256(body.encode()).hexdigest()
  with sqlite3.connect(db)as connection:
   connection.execute('CREATE TABLE IF NOT EXISTS qqq_gex_pcs_lifecycle(day TEXT,time INTEGER,body TEXT,sha256 TEXT)')
   connection.execute('INSERT INTO qqq_gex_pcs_lifecycle VALUES(?,?,?,?)',('2026-01-02',1,body,digest))
  for actual in [client.call('get_qqq_gex_lifecycle',{'date':'2026-01-02'})['structuredContent']['data'],run(command,str(profile),'get_qqq_gex_lifecycle','--date','2026-01-02')['data']]:
   assert actual['points']==[point]and actual['recorded']and actual['storageAvailable']and not actual['complete']
  with sqlite3.connect(db)as connection:connection.execute("UPDATE qqq_gex_pcs_lifecycle SET sha256='corrupt'")
  corrupt=client.call('get_qqq_gex_lifecycle',{'date':'2026-01-02'})
  assert corrupt['isError']and corrupt['structuredContent']['error']['code']=='operation_failed',corrupt
  with sqlite3.connect(db)as connection:connection.execute('UPDATE qqq_gex_pcs_lifecycle SET sha256=?',(digest,))
  retained=hashlib.sha256(db.read_bytes()).hexdigest()
  install('1.0.0-ui')
  assert client.call('get_qqq_gex_replay',requested)['structuredContent']['data']==replay
  install('1.0.1-ui')
  refreshed={t['name']for t in client.request('tools/list')['result']['tools']};assert 'get_qqq_gex_retained_summary_v2'in refreshed
  summary=client.call('get_qqq_gex_retained_summary_v2',{})['structuredContent']['data']
  assert summary['appVersion']=='1.0.1'and summary['publishedDays']==1
  assert run(command,str(profile),'get_qqq_gex_retained_summary_v2')['data']==summary
  assert client.call('get_qqq_gex_replay',requested)['structuredContent']['data']==replay
  assert hashlib.sha256(db.read_bytes()).hexdigest()==retained
 finally:client.close()
 expected_history=original('history.mjs',oracle,json.dumps({'limit':1,'retryFailed':False}))
 assert run(command,str(profile),'rebuild_qqq_gex_history','--limit','1')['data']==expected_history
 writer=Mcp(command,str(profile),writes=True)
 try:
  repeated=original('import.mjs',input_file,oracle)
  actual=writer.call('calculate_qqq_gex_local',{})
  assert actual['structuredContent']['data']==repeated,(actual,repeated)
  assert writer.call('rebuild_qqq_gex_history',{'limit':1})['structuredContent']['data']==expected_history
 finally:writer.close()
 assert declared=={'get_qqq_gex_retained_summary','calculate_qqq_gex_local','get_qqq_gex_replay','rebuild_qqq_gex_history','get_qqq_gex_archive','get_qqq_gex_lifecycle','get_qqq_gex_live_decision'},('Add a meaningful real CLI/MCP scenario for every signed app operation',declared)
 retained=hashlib.sha256(db.read_bytes()).hexdigest()
 production=pathlib.Path('src/Meili.Cli/bin/Release/net10.0/easysellput.dll').resolve()
 removed=subprocess.run([dotnet,str(production),'apps','uninstall','easysellput.qqq-gex','--data-dir',str(profile),'--json'],capture_output=True,text=True,timeout=20)
 assert removed.returncode==0,(removed.stdout,removed.stderr)
 assert hashlib.sha256(db.read_bytes()).hexdigest()==retained
 install('1.0.1-ui')
 assert run(command,str(profile),'get_qqq_gex_replay','--from',requested['from'],'--to',requested['to'])['data']==replay
 assert hashlib.sha256(db.read_bytes()).hexdigest()==retained
 assert hashlib.sha256(host.read_bytes()).hexdigest()==before
print('PASS: actual original GEX calculation/replay/history/archive/decision/lifecycle through signed app, unchanged host A/B, optional UI attachment, real added retained-data operation and uninstall/reinstall preservation (fixture, not live/native)')
