#!/usr/bin/env python3
"""A host rebuild must not require npm or prebuilt optional GEX calculation assets."""
import json
import os
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='host-without-app-') as directory:
    temp = pathlib.Path(directory)
    npm = temp / 'npm'; npm.write_text('#!/bin/sh\necho unexpected-npm-in-host-build >&2\nexit 99\n'); npm.chmod(0o755)
    environment = dict(os.environ, PATH=str(temp) + os.pathsep + os.environ['PATH'])
    originals = []
    try:
        for name in ['import.mjs', 'query.mjs', 'history.mjs']:
            source = root / 'web/qqq-gex/runtime-dist' / name
            if source.exists():
                target = temp / name; source.rename(target); originals.append((source, target))
        subprocess.run(['dotnet', 'build', 'src/Meili.Cli/Meili.Cli.csproj', '-t:Rebuild', '-c', 'Release', '--no-restore', '-m:3', '-v', 'minimal'], cwd=root, env=environment, check=True)
        result = subprocess.run(['dotnet', 'src/Meili.Cli/bin/Release/net10.0/easysellput.dll', 'price', '--right', 'call', '--spot', '100', '--strike', '100', '--years', '1', '--rate', '0.05', '--volatility', '0.2', '--data-dir', str(temp / 'profile'), '--json'], cwd=root, env=environment, capture_output=True, text=True, check=True)
        assert abs(json.loads(result.stdout)['data']['greeks']['price'] - 10.45058357) < 1e-6
    finally:
        for source, target in originals:
            target.rename(source)
        subprocess.run(['dotnet', 'build', 'src/Meili.Cli/Meili.Cli.csproj', '-t:Rebuild', '-c', 'Release', '--no-restore', '-m:3', '-v', 'minimal'], cwd=root, check=True)
print('PASS: real host rebuild and pricing without npm or optional app bundles; original generated assets restored')
