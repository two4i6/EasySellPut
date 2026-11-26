"""Original C# ingestion versus actual signed app ingestion using the identical source fixture."""
from contextlib import closing
import gzip
import hashlib
import json
import pathlib
import sqlite3
import subprocess
from cli_mcp_smoke import Mcp,run


def check_capture(base,node,fixtures,root,mode="aligned"):
 root=root/mode
 root.mkdir()
 original=root/'original capture';profile=root/'app capture'
 command=[*base,'--app-capture-fixture-mode',str(fixtures/'public.pem'),node,mode]
 result=subprocess.run([*base,'--gex-capture-original',str(original),mode],capture_output=True,text=True,encoding='utf-8',timeout=120)
 assert result.returncode==0,(result.stdout,result.stderr)
 expected=json.loads(result.stdout)
 installed=subprocess.run([*command,'install',str(profile),str(fixtures/'1.0.0-core.espapp')],capture_output=True,text=True,encoding='utf-8',timeout=30)
 assert installed.returncode==0,(installed.stdout,installed.stderr)
 actual=run(command,str(profile),'capture_qqq_gex_input')['data']
 published=pathlib.Path(actual.pop('inputPath'))
 expected_input=profile/'cache/qqq-gex-input.json'
 # Windows can return long-form paths for a temporary directory's 8.3 alias.
 # Compare the existing file identity, not its lexical spelling.
 assert published.is_file() and expected_input.is_file(),{'published':str(published),'expected':str(expected_input),'publishedExists':published.is_file(),'expectedExists':expected_input.is_file()}
 assert published.samefile(expected_input),{'published':str(published),'expected':str(expected_input)}
 expected.pop('inputPath');assert actual==expected,(actual,expected)
 assert actual['status']=='captured_input'
 if mode=='current-display-cboe':assert actual['displayBars']>actual['bars'] and actual['bars']>0
 if mode=='current-display-cboe':assert actual['matchingRegularBars']==1 and actual['providerCoverageComplete']
 elif mode in('aligned','large'):assert actual['matchingRegularBars']==4 and actual['providerCoverageComplete']
 else:assert not actual['providerCoverageComplete']
 def body(directory):return json.loads((directory/'cache/qqq-gex-input.json').read_text(encoding='utf-8'))
 def without_receipt_time(value):
  value.pop('evaluationAt');value.pop('receivedAt')
  display=value.get('displayPrices',{}).get('provenance')
  if display:
   observed=display.pop('observedAt');cutoff=display.pop('requestedUntil')
   from datetime import datetime,timezone
   parse=lambda text:datetime.fromisoformat(text.replace('Z','+00:00'))
   assert parse(cutoff)<=parse(observed) and abs((datetime.now(timezone.utc)-parse(observed)).total_seconds())<120
   assert all(parse(bar['timestamp']).timestamp()+120<=parse(cutoff).timestamp() for bar in value['displayPrices']['bars'])
  return value
 expected_body=without_receipt_time(body(original));actual_body=without_receipt_time(body(profile))
 assert actual_body==expected_body,[(key,actual_body[key],expected_body[key])for key in actual_body if actual_body[key]!=expected_body[key]]
 db=profile/'cache/qqq-gex.db'
 with closing(sqlite3.connect(db))as connection,connection:
  rows=connection.execute('SELECT sha256,body,encoding FROM qqq_gex_provider_raw').fetchall()
  assert len(rows)==1 and rows[0][2]=='gzip-v1'
  raw=gzip.decompress(rows[0][1]);assert hashlib.sha256(raw).hexdigest().upper()==rows[0][0]
  assert '原始字节'.encode()in raw
  observations=connection.execute('SELECT body_sha256,body FROM qqq_gex_observed_inputs').fetchall()
  assert len(observations)==1 and hashlib.sha256(gzip.decompress(observations[0][1])).hexdigest().upper()==observations[0][0]
 retained=(profile/'cache/qqq-gex-input.json').read_bytes()
 reader=Mcp(command,str(profile))
 try:
  assert 'capture_qqq_gex_input'not in{tool['name']for tool in reader.request('tools/list')['result']['tools']}
  rejected=reader.call('capture_qqq_gex_input',{})
  assert rejected['isError']and rejected['structuredContent']['error']['code']=='permission_denied'
 finally:reader.close()
 writer=Mcp(command,str(profile),writes=True)
 try:
  result=writer.call('capture_qqq_gex_input',{})
  assert not result.get('isError'),result
  repeated=result['structuredContent']['data'];repeated.pop('inputPath');assert repeated==expected
 finally:writer.close()
 if mode=='current-display-cboe':
  calculated=run(command,str(profile),'calculate_qqq_gex_local')['data']
  assert calculated['status']in('imported','partial'),calculated
  state='published'if calculated['status']=='imported'else'partial'
  reader=Mcp(command,str(profile))
  try:
   for basis,count in [('display',9),('valuation',1)]:
    arguments={'resource':'bars','date':'2026-11-13','priceBasis':basis,'archiveState':state}
    archive=reader.call('get_qqq_gex_archive',arguments)['structuredContent']['data']
    assert archive['available'] and len(archive['items'])==count,(basis,archive)
    flags=[part for key,value in arguments.items()for part in ['--'+key,str(value)]]
    assert run(command,str(profile),'get_qqq_gex_archive',*flags)['data']==archive
  finally:reader.close()
 assert (profile/'cache/qqq-gex-input.json').read_bytes()==retained,'Repeated unchanged source must retain first observed evidence'
 with closing(sqlite3.connect(db))as connection,connection:assert connection.execute('SELECT count(*) FROM qqq_gex_observed_inputs').fetchone()[0]==1

 print('PASS: signed app ingestion versus original C# source semantics: '+mode)


def check_source_failure(base,node,fixtures,root):
 mode='source-fail';profile=root/mode;original=root/'original failure'
 expected=subprocess.run([*base,'--gex-capture-original',str(original),mode],capture_output=True,text=True,encoding='utf-8',timeout=30)
 assert expected.returncode==1,(expected.stdout,expected.stderr)
 command=[*base,'--app-capture-fixture-mode',str(fixtures/'public.pem'),node,mode]
 installed=subprocess.run([*command,'install',str(profile),str(fixtures/'1.0.0-core.espapp')],capture_output=True,text=True,encoding='utf-8',timeout=30)
 assert installed.returncode==0,(installed.stdout,installed.stderr)
 actual=run(command,str(profile),'capture_qqq_gex_input',code=1)
 assert actual['error']==json.loads(expected.stdout)['error'],(actual,expected.stdout)
 writer=Mcp(command,str(profile),writes=True)
 try:
  failed=writer.call('capture_qqq_gex_input',{})
  assert failed['isError']and failed['structuredContent']['error']==actual['error']
 finally:writer.close()
 assert not (profile/'cache/qqq-gex-input.json').exists()
 print('PASS: signed source failure keeps original CLI/MCP error and publishes no input')
