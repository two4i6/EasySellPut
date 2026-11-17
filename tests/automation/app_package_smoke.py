#!/usr/bin/env python3
"""Verify the independently built GEX artifact; fixture keys are never product trust overrides."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sqlite3
import tempfile
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--archive', type=pathlib.Path, required=True)
parser.add_argument('--public-key', type=pathlib.Path, required=True)
parser.add_argument('--repository', required=True)
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix='app-package-smoke-') as folder:
    root = pathlib.Path(folder)
    with zipfile.ZipFile(args.archive) as archive:
        body = archive.read('app.json'); manifest = json.loads(body)
        (root / 'app.json').write_bytes(body); (root / 'app.sig').write_bytes(archive.read('app.sig'))
        assert manifest['repository'] == args.repository
        assert manifest['id'] == 'easysellput.qqq-gex' and manifest['hostApi'] == manifest['engineProtocol'] == 1
        source = json.loads(pathlib.Path('web/qqq-gex/source-manifest.json').read_text())
        assert manifest['modelVersion'] == source['commit']
        names = [f['path'] for f in manifest['files']]
        assert len(names) == len(set(n.lower() for n in names))
        assert set(archive.namelist()) == set(names) | {'app.json', 'app.sig'}
        for entry in manifest['files']:
            data = archive.read(entry['path'])
            assert len(data) == entry['size'] and hashlib.sha256(data).hexdigest() == entry['sha256']
        for name in ['import.mjs', 'query.mjs', 'history.mjs']:
            original = pathlib.Path('web/qqq-gex/runtime-dist', name).read_bytes()
            assert archive.read('engine/' + name) == original
        if manifest['ui'] is not None:
            assert archive.read(manifest['ui']) == pathlib.Path('web/qqq-gex/dist/index.html').read_bytes()
        else:
            assert not any(name.startswith('ui/') for name in names)
        operations = json.loads(archive.read('operations.json'))
        op = next(o for o in operations if o['name'] == 'get_qqq_gex_retained_summary')
        script = root / 'summary.mjs'; script.write_bytes(archive.read(op['entryPoint']))
        profile = root / 'profile'
        request = dict(protocol=1, operation=op['name'], arguments={}, context=dict(dataDirectory=str(profile),appVersion=manifest['version']))
        def run_summary():
            completed = subprocess.run(['node', str(script)], input=json.dumps(request), text=True, capture_output=True, check=True, timeout=15)
            return json.loads(completed.stdout)
        assert run_summary()['storageAvailable'] is False and not profile.exists()
        cache = profile / 'cache'; cache.mkdir(parents=True); db = cache / 'qqq-gex.db'
        with sqlite3.connect(db) as connection:
            connection.executescript("CREATE TABLE qqq_gex_local_days(day TEXT); INSERT INTO qqq_gex_local_days VALUES('2026-01-02'),('2026-01-05'); CREATE TABLE qqq_gex_partial_days(day TEXT); INSERT INTO qqq_gex_partial_days VALUES('2026-01-06'); CREATE TABLE qqq_gex_observed_inputs(identity TEXT); INSERT INTO qqq_gex_observed_inputs VALUES('fixture');")
        before = hashlib.sha256(db.read_bytes()).hexdigest()
        result = run_summary()
        assert result['publishedDays'] == 2 and result['partialDays'] == result['observedInputs'] == 1
        assert result['firstPublishedDate'] == '2026-01-02' and result['lastPublishedDate'] == '2026-01-05'
        assert hashlib.sha256(db.read_bytes()).hexdigest() == before

    verify = "import{verify}from'node:crypto';import{readFileSync}from'node:fs';if(!verify('sha256',readFileSync(process.argv[1]),readFileSync(process.argv[2]),readFileSync(process.argv[3])))process.exit(1);"
    subprocess.run(['node', '--input-type=module', '-e', verify, str(root / 'app.json'), str(args.public_key), str(root / 'app.sig')], check=True)
print('PASS: independently signed GEX UI/engine artifact, exact original bundles, model/source identity and complete file hashes')
