import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';import {importInput} from './import';
const [path,rawOptions]=process.argv.slice(2),options=JSON.parse(rawOptions??'{}'),limit=options.limit??100;
if(!Number.isInteger(limit)||limit<1||limit>400)throw Error('History batch limit must be 1–400');
const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS qqq_gex_observed_imports(identity TEXT PRIMARY KEY,status TEXT NOT NULL,error TEXT,updated_at INTEGER NOT NULL)');
try{
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='qqq_gex_observed_inputs'").get()){console.log(JSON.stringify({status:'no_observed_inputs',complete:false,processed:0}));process.exitCode=0;}
 else {
 const identities=db.prepare("SELECT i.identity FROM qqq_gex_observed_inputs i LEFT JOIN qqq_gex_observed_imports p ON i.identity=p.identity WHERE p.identity IS NULL OR (?=1 AND p.status!='imported') ORDER BY CASE WHEN p.identity IS NULL THEN 0 ELSE 1 END,i.received_at LIMIT ?").all(options.retryFailed?1:0,limit);const results=[];
 for(const item of identities){let status='partial',error:string|null=null;try{const row=db.prepare('SELECT body,body_sha256 FROM qqq_gex_observed_inputs WHERE identity=?').get(item.identity)!;const body=String(row.body);if(createHash('sha256').update(body).digest('hex').toUpperCase()!==row.body_sha256)throw Error('Observed input integrity failed');await importInput('',path,body);status='imported';}catch(e){error=e instanceof Error?e.message:'Import failed';}db.prepare('INSERT INTO qqq_gex_observed_imports VALUES(?,?,?,?) ON CONFLICT(identity) DO UPDATE SET status=excluded.status,error=excluded.error,updated_at=excluded.updated_at').run(item.identity,status,error,Date.now());results.push({identity:item.identity,status,error});}
 const pending=Number(db.prepare('SELECT count(*) n FROM qqq_gex_observed_inputs i LEFT JOIN qqq_gex_observed_imports p ON i.identity=p.identity WHERE p.identity IS NULL').get()!.n);console.log(JSON.stringify({status:results.some(r=>r.status==='partial')?'partial':'processed',complete:false,processed:results.length,pending,hasMore:pending>0,results,coverage:'Only retained normalized observations were attempted; no historical gaps were filled'}));
 }
}finally{db.close();}
