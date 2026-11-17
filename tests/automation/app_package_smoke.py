#!/usr/bin/env python3
"""Verify the independently built GEX artifact; fixture keys are never product trust overrides."""
import argparse
import hashlib
import json
import pathlib
import subprocess
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
        assert archive.read(manifest['ui']) == pathlib.Path('web/qqq-gex/dist/index.html').read_bytes()
    subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(args.public_key), '-signature', str(root / 'app.sig'), str(root / 'app.json')], check=True)
print('PASS: independently signed GEX UI/engine artifact, exact original bundles, model/source identity and complete file hashes')
