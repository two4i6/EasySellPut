#!/usr/bin/env python3
"""Kill real SQLite archive compaction after a committed batch, then resume without losing decoded bytes.
Use --source-db for a read-only benchmark source; all mutations occur on a temporary backup.
"""
import argparse, gzip, hashlib, json, pathlib, sqlite3, subprocess, tempfile, time
from contextlib import closing


def digest(path):
    with closing(sqlite3.connect(path)) as db, db:
        def decode(value):
            if isinstance(value, bytes): return gzip.decompress(value) if value[:2] == b'\x1f\x8b' else value
            if isinstance(value, str) and value.startswith('@observed-v1:'):
                return decode(db.execute('SELECT body FROM qqq_gex_observed_inputs WHERE identity=?', (value[13:],)).fetchone()[0])
            return value.encode() if isinstance(value, str) else value
        result = {}
        for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
            columns = [r[1] for r in db.execute('PRAGMA table_info(' + table + ')') if r[1] != 'encoding']
            rows = []
            for row in db.execute('SELECT ' + ','.join(columns) + ' FROM ' + table):
                values = [decode(v) if col == 'body' else v for col, v in zip(columns, row)]
                rows.append(json.dumps([{'sha256': hashlib.sha256(v).hexdigest()} if isinstance(v, bytes) else v for v in values], sort_keys=True))
            result[table] = hashlib.sha256('\n'.join(sorted(rows)).encode()).hexdigest()
        return result


def check(command, source_db=None):
    with tempfile.TemporaryDirectory(prefix='gex compact recovery ') as folder:
        root = pathlib.Path(folder); (root / 'cache').mkdir(); dbpath = root / 'cache/qqq-gex.db'
        if source_db:
            with closing(sqlite3.connect(source_db)) as source, closing(sqlite3.connect(dbpath)) as target: source.backup(target)
        else:
            subprocess.run(command + ['get_cache_status', '--data-dir', str(root), '--json'], capture_output=True, check=True)
            with closing(sqlite3.connect(dbpath)) as db, db:
                db.execute('CREATE TABLE qqq_gex_local_rows(row_key TEXT PRIMARY KEY,body TEXT,sha256 TEXT)')
                for i in range(128):
                    body = json.dumps({'fixture': 'synthetic crash-recovery bytes; not historical market data', 'row': i, 'profile': [{'strike': j, 'callGex': .123456789, 'putGex': -.987654321} for j in range(6000)]})
                    db.execute('INSERT INTO qqq_gex_local_rows VALUES(?,?,?)', (str(i), body, hashlib.sha256(body.encode()).hexdigest().upper()))
        before = digest(dbpath)
        args = command + ['clear_cache', '--category', 'qqq_gex_wire', '--mode', 'compact', '--data-dir', str(root), '--json']
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        killed_at = None; deadline = time.monotonic() + 30
        with closing(sqlite3.connect(dbpath, timeout=.1)) as db, db:
            while process.poll() is None and time.monotonic() < deadline:
                try:
                    compressed, total = db.execute("SELECT SUM(typeof(body)='blob'),COUNT(*) FROM qqq_gex_local_rows").fetchone()
                    if 0 < compressed < total:
                        process.kill(); killed_at = compressed; break
                except sqlite3.OperationalError: pass
                time.sleep(.002)
        stdout, stderr = process.communicate(timeout=30)
        assert killed_at is not None, ('No in-flight committed batch observed; crash recovery not verified', stdout, stderr)
        assert digest(dbpath) == before, 'Interrupted maintenance changed protected decoded contents'
        subprocess.run(command + ['get_cache_status', '--data-dir', str(root), '--json'], capture_output=True, check=True)
        resumed = subprocess.run(args, capture_output=True, text=True, check=True, timeout=120)
        assert json.loads(resumed.stdout)['data'][0]['compacted']
        assert digest(dbpath) == before
        with closing(sqlite3.connect(dbpath)) as db, db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert db.execute("SELECT COUNT(*) FROM qqq_gex_local_rows WHERE typeof(body)='text'").fetchone()[0] == 0
        print(json.dumps({'result': 'PASS', 'killedAfterCompressedRows': killed_at, 'protectedDigestUnchanged': True, 'resumeAndIntegrity': 'passed', 'fixture': 'copied supplied source' if source_db else 'synthetic bytes'}))

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--dll'); p.add_argument('--executable'); p.add_argument('--source-db', type=pathlib.Path); a = p.parse_args()
    check([a.executable] if a.executable else ['dotnet', a.dll or 'src/Meili.Cli/bin/Debug/net10.0/easysellput.dll'], a.source_db)
