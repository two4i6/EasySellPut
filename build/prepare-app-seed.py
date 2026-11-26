#!/usr/bin/env python3
"""Explicitly prepare bundled compatibility assets. Ordinary .NET compilation never invokes npm."""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'web/qqq-gex'


def prepare(if_current=False):
    tracked = subprocess.check_output(['git', 'ls-files', '-z', 'web/qqq-gex', 'web/app-sdk'], cwd=ROOT).split(b'\0')
    digest = hashlib.sha256()
    for entry in sorted(filter(None, tracked)):
        path = ROOT / entry.decode('utf-8')
        if path.is_file():
            digest.update(entry); digest.update(hashlib.sha256(path.read_bytes()).digest())
    fingerprint = digest.hexdigest()
    stamp = APP / 'runtime-dist/seed-inputs.json'
    if if_current and stamp.exists():
        try:
            previous = json.loads(stamp.read_text())
            required = {'runtime-dist/import.mjs', 'runtime-dist/query.mjs', 'runtime-dist/history.mjs', 'runtime-dist/retained-summary.mjs', 'dist/index.html'}
            ui_files = {str(p.relative_to(APP)).replace('\\', '/') for p in (APP / 'dist').glob('*') if p.is_file()}
            if previous['source'] == fingerprint and required.issubset(previous['files']) and ui_files == {
                name for name in previous['files'] if name.startswith('dist/')} and all(
                (APP / name).is_file() and hashlib.sha256((APP / name).read_bytes()).hexdigest() == sha
                for name, sha in previous['files'].items()):
                print('App compatibility seed is current'); return
        except (ValueError, KeyError, OSError):
            pass
    npm = shutil.which('npm')
    if not npm:
        raise RuntimeError('Building the app seed requires npm; ordinary host/CLI builds do not.')
    if not (APP / 'node_modules/esbuild/package.json').is_file():
        subprocess.run([npm, 'ci', '--no-audit', '--no-fund'], cwd=APP, check=True, shell=os.name == 'nt')
    for script in ['build', 'build:runtime']:
        subprocess.run([npm, 'run', script], cwd=APP, check=True, shell=os.name == 'nt')
    files = [*sorted((APP / 'dist').glob('*')),
             *(APP / 'runtime-dist' / name for name in ['import.mjs', 'query.mjs', 'history.mjs'])]
    stamp.write_text(json.dumps(dict(source=fingerprint, files={str(p.relative_to(APP)).replace('\\', '/'):
        hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}), indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--if-current', action='store_true')
    prepare(parser.parse_args().if_current)
