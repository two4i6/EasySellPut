#!/usr/bin/env python3
"""Actual cross-process maintenance locks; registry metadata is an explicit fixture, never trusted code."""
import argparse
import json
import pathlib
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--dll', default='src/Meili.Cli/bin/Release/net10.0/easysellput.dll')
parser.add_argument('--host', default='tests/Meili.Automation.Host/bin/Release/net10.0/Meili.Automation.Host.dll')
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix='app maintenance with spaces ') as directory:
    root = pathlib.Path(directory); apps = root / 'apps'; apps.mkdir()
    app_id = 'easysellput.lease-test'
    registry = apps / 'registry.json'
    registry.write_text(json.dumps(dict(schemaVersion=1, generation=1, apps=[dict(
        id=app_id, version='1.0.0', packageSha256='A'*64, dataFormat=1, enabled=True)])))
    data = apps / 'data' / app_id; data.mkdir(parents=True)
    (data / 'history').write_text('retained user observations')
    command = ['dotnet', str(pathlib.Path(args.dll).resolve())]
    host = subprocess.Popen(['dotnet', str(pathlib.Path(args.host).resolve()), '--module-lease', str(root), app_id],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert json.loads(host.stdout.readline())['ready'] is True
        before = registry.read_bytes()
        blocked = subprocess.run([*command, 'apps', 'uninstall', app_id, '--data-dir', directory, '--json'],
                                 capture_output=True, text=True, timeout=20)
        assert blocked.returncode == 1 and json.loads(blocked.stdout)['error']['code'] == 'io_error', blocked.stdout
        assert registry.read_bytes() == before
    finally:
        host.stdin.close(); assert host.wait(timeout=10) == 0, host.stderr.read()
    removed = subprocess.run([*command, 'apps', 'uninstall', app_id, '--data-dir', directory, '--json'],
                             capture_output=True, text=True, timeout=20)
    assert removed.returncode == 0 and json.loads(removed.stdout)['data']['dataPreserved'] is True, removed.stdout
    assert json.loads(registry.read_text())['apps'] == []
    assert (data / 'history').read_text() == 'retained user observations'
print('PASS: real cross-process execution lease blocks CLI uninstall; release permits unregister and preserves data (metadata fixture, no code trust override)')
