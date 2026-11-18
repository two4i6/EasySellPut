#!/usr/bin/env python3
"""Offline production CLI migration acceptance. Synthetic temporary archives only."""
import argparse,hashlib,json,os,pathlib,select,sqlite3,subprocess,tempfile,threading,time,gzip
p=argparse.ArgumentParser();p.add_argument('--dll',required=True);p.add_argument('--host',required=True);p.add_argument('--dotnet',default='dotnet');a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2];web=root/'web/qqq-gex';folder=pathlib.Path(tempfile.mkdtemp(prefix='gex-production-cli-'));env=dict(os.environ);env.pop('MEILI_GEX_ARCHIVE_CODEC',None)
dll=str(pathlib.Path(a.dll).resolve());host=str(pathlib.Path(a.host).resolve())
def cli(action,*args,ok=True):
 r=subprocess.run([a.dotnet,dll,'gex-archive',action,*map(str,args),'--json'],env=env,capture_output=True,text=True)
 if ok: assert r.returncode==0,(r.stdout,r.stderr);return json.loads(r.stdout)['data']
 assert r.returncode!=0,r.stdout;return r
source=folder/'source.db';inputfile=folder/'input.json'
from datetime import datetime,timedelta,timezone
start=datetime(2026,1,2,14,30,tzinfo=timezone.utc)
def iso(t):return t.isoformat().replace('+00:00','Z')
contract={'strike':600,'impliedVolatility':.2,'openInterest':100,'bid':1,'ask':1.1}
document={'symbol':'QQQ','source':'SYNTHETIC-production-migration-NOT-LIVE','captures':[{'valuationAt':iso(start+timedelta(minutes=2*i)),'expiry':int(datetime(2026,1,d,tzinfo=timezone.utc).timestamp()),'spot':600+i*.01,'result':{'receivedAt':iso(start+timedelta(minutes=2*i)),'options':[{'calls':[contract],'puts':[contract]}]}} for i in range(36) for d in [2,5]],'bars':[{'timestamp':iso(start+timedelta(minutes=2*i)),'open':600,'high':601,'low':599,'close':600,'volume':100} for i in range(36)]}
inputfile.write_text(json.dumps(document,separators=(',',':')))
subprocess.run(['node','runtime-dist/import.mjs',str(inputfile),str(source)],cwd=web,env=env,check=True,capture_output=True)
raw=inputfile.read_bytes();h=hashlib.sha256(raw).hexdigest();binary=bytes(range(256))*20
with sqlite3.connect(source) as c:
 c.executescript('CREATE TABLE qqq_gex_observed_inputs(identity TEXT PRIMARY KEY,received_at INTEGER,body_sha256 TEXT,body BLOB);CREATE TABLE qqq_gex_provider_raw(sha256 TEXT PRIMARY KEY,source TEXT,as_of INTEGER,fetched_at INTEGER,body BLOB,encoding TEXT)')
 c.execute('INSERT INTO qqq_gex_observed_inputs VALUES(?,?,?,?)',('observed',123,h.upper(),raw.decode()))
 c.execute('UPDATE qqq_gex_raw SET body=? WHERE sha256=?',('@observed-v1:observed',h))
 for b,encoding in [(binary,'identity'),(binary+b'extra','gzip-v1')]:c.execute('INSERT INTO qqq_gex_provider_raw VALUES(?,?,?,?,?,?)',(hashlib.sha256(b).hexdigest().upper(),'synthetic',123,456,b if encoding=='identity' else gzip.compress(b,compresslevel=1,mtime=0),encoding))
route='/api/analysis/qqq/local-analysis?date=2026-01-02&expiry=2026-01-02&at=2026-01-02T21:00:00Z&analysis=replayTable'
def query(db,uri=route):return json.loads(subprocess.check_output(['node','runtime-dist/query.mjs',str(db),uri],cwd=web,env=env,stderr=subprocess.PIPE))
original=query(source)
# A running source application can continue writing. Online backup must be a
# consistent point-in-time snapshot; it must never modify or lock out the source.
stop=threading.Event();started=threading.Event();errors=[]
def writer():
 try:
  with sqlite3.connect(source,timeout=10) as c:
   c.execute('PRAGMA journal_mode=WAL');started.set()
   while not stop.is_set():c.execute('UPDATE qqq_gex_cache_meta SET generation=generation+1');c.commit();stop.wait(.01)
 except Exception as e:errors.append(str(e));started.set()
t=threading.Thread(target=writer);t.start();started.wait(5)
dest=folder/'isolated-v2'/'cache'/'qqq-gex.db'
try:result=cli('migrate','--source',source,'--destination',dest)
finally:stop.set();t.join(10)
assert not errors,errors;assert result['status']=='complete';assert query(dest)==original
backup=pathlib.Path(result['backup']);assert hashlib.sha256(backup.read_bytes()).hexdigest().upper()==result['backupSha256']
with sqlite3.connect(dest) as c:
 assert c.execute('SELECT version,status FROM qqq_gex_archive_format').fetchone()==(2,'ready')
 for sql in ['INSERT OR IGNORE INTO qqq_gex_cache_meta VALUES(1,0)','UPDATE qqq_gex_cache_meta SET generation=999','DELETE FROM qqq_gex_provider_raw']:
  try:c.execute(sql)
  except sqlite3.OperationalError as e:assert 'gex_v2_writer' in str(e),str(e)
  else:raise AssertionError('Old-client write was not blocked')
assert cli('migrate','--source',source,'--destination',dest,'--resume')['status']=='complete'
# New Node runtime still writes, with codec selected by the guarded database,
# not an environment variable. Re-read actual newly archived bodies afterward.
document['source']+='-next';inputfile.write_text(json.dumps(document,separators=(',',':')))
subprocess.run(['node','runtime-dist/import.mjs',str(inputfile),str(dest)],cwd=web,env=env,check=True,capture_output=True)
with sqlite3.connect(dest) as c:assert c.execute("SELECT count(*) FROM qqq_gex_raw WHERE substr(body,1,4)=x'51474558'").fetchone()[0]>=1
legacy=folder/'downgrade.db';cli('downgrade','--source',dest,'--destination',legacy);assert query(legacy)==query(dest)
with sqlite3.connect(legacy) as c:c.execute('UPDATE qqq_gex_cache_meta SET generation=generation+1')
restored=folder/'restored.db';cli('restore','--source',dest,'--destination',restored);assert query(restored)==original
# Existing/running destination must never be replaced.
with sqlite3.connect(legacy) as occupied:
 old=legacy.read_bytes();cli('migrate','--source',source,'--destination',legacy,ok=False);assert legacy.read_bytes()==old
# Real process death during the second uncommitted batch, then CLI resume.
crashed=folder/'crash.db'
child=subprocess.Popen([a.dotnet,host,'migration-wait',str(inputfile),str(folder/'host.json'),str(source),str(crashed)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
ready=threading.Event();line=[]
def read_marker():line.append(child.stdout.readline());ready.set()
threading.Thread(target=read_marker,daemon=True).start()
assert ready.wait(30), 'Crash checkpoint timeout';assert 'migration-uncommitted' in line[0],(line,child.stderr.read())
cli('migrate','--source',source,'--destination',crashed,'--resume',ok=False) # lease rejects concurrent migrator
child.kill();child.wait(10);assert not crashed.exists()
# Pending workspace cannot be opened by an updated normal reader.
with sqlite3.connect(str(crashed)+'.migration.db') as c:working=c.execute('SELECT work FROM migration').fetchone()[0]
pending=subprocess.run(['node','runtime-dist/query.mjs',working,route],cwd=web,env=env,capture_output=True,text=True);assert pending.returncode!=0
cli('migrate','--source',source,'--destination',crashed,'--resume');assert query(crashed)==original
# Trusted backup corruption is fatal, including resume; no publication/overwrite.
with open(str(crashed)+'.backup.db','ab') as f:f.write(b'corrupt')
cli('migrate','--source',source,'--destination',crashed,'--resume',ok=False)
print(json.dumps({'status':'PASS','kind':'synthetic only','directory':str(folder),'checks':['live-source WAL snapshot','real CLI migrate/status/resume','Node and .NET actual storage','old-client DML fence','updated writer auto-v2','downgrade','verified-backup restore','occupied destination refusal','concurrent migrator lease','SIGKILL and partial batch resume','pending reader rejection','backup corruption refusal','fixed replay equality'],'sourceRemainsReadable':query(source)==original}))
