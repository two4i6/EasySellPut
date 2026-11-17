#!/usr/bin/env python3
"""Build a signed GEX app artifact from existing outputs; never build or publish the host."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]


def package(args):
    metadata = json.loads((ROOT / 'web/qqq-gex/app.json').read_text(encoding='utf-8'))
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}', args.repository):
        raise ValueError('Invalid repository')
    if args.version:
        metadata['version'] = args.version
    if not re.fullmatch(r'\d+\.\d+\.\d+', metadata['version']):
        raise ValueError('Stable module version required')
    payload = {}
    for name in ['import.mjs', 'query.mjs', 'history.mjs']:
        payload['engine/' + name] = (args.engine_dir / name).read_bytes()
    payload['engine/retained-summary.mjs'] = (args.engine_dir / 'retained-summary.mjs').read_bytes()
    payload['operations.json'] = (ROOT / 'web/qqq-gex/operations.json').read_bytes()
    if args.ui_dir:
        for path in sorted(args.ui_dir.rglob('*')):
            if path.is_symlink():
                raise ValueError('Linked UI asset')
            if path.is_file() and path.name != 'build-manifest.json':
                payload['ui/' + path.relative_to(args.ui_dir).as_posix()] = path.read_bytes()
        if 'ui/index.html' not in payload:
            raise ValueError('Missing UI entrypoint')
    for name in ['source-manifest.json', 'node-runtime-lock.json']:
        payload['notices/' + name] = (ROOT / 'web/qqq-gex' / name).read_bytes()
    # Carry the licenses of dependencies actually used by the existing esbuild output.
    build_manifest = args.ui_dir / 'build-manifest.json' if args.ui_dir else None
    if build_manifest and build_manifest.exists():
        packages = set()
        for item in json.loads(build_manifest.read_text())['inputs']:
            parts = pathlib.PurePosixPath(item.replace('\\', '/')).parts
            if 'node_modules' not in parts:
                continue
            index = len(parts) - 1 - list(reversed(parts)).index('node_modules')
            rest = parts[index + 1:]
            if rest:
                packages.add('/'.join(rest[:2] if rest[0].startswith('@') else rest[:1]))
        for name in sorted(packages):
            folder = ROOT / 'web/qqq-gex/node_modules' / name
            for path in folder.iterdir():
                if path.is_file() and path.name.lower().startswith(('license', 'licence', 'copying')):
                    payload['notices/npm/' + name + '/' + path.name] = path.read_bytes()
    lock = json.loads((ROOT / 'web/qqq-gex/node-runtime-lock.json').read_text())
    manifest = dict(schemaVersion=1, repository=args.repository, **metadata,
                    engine='engine/import.mjs', ui='ui/index.html' if args.ui_dir else None,
                    modelVersion=json.loads((ROOT / 'web/qqq-gex/source-manifest.json').read_text())['commit'],
                    platforms=sorted(lock['platforms']),
                    files=[dict(path=name, size=len(data), sha256=hashlib.sha256(data).hexdigest())
                           for name, data in sorted(payload.items())])
    body = json.dumps(manifest, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if len(body) > 262144 or sum(map(len, payload.values())) > 512 * 1024 * 1024:
        raise ValueError('App package exceeds supported bounds')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='esp-app-sign-') as scratch:
        path = pathlib.Path(scratch) / 'app.json'; path.write_bytes(body)
        signed = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(args.key), str(path)],
                                check=True, capture_output=True).stdout
        with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in [('app.json', body), ('app.sig', signed), *sorted(payload.items())]:
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.create_system = 3; info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data)
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    args.output.with_suffix(args.output.suffix + '.sha256').write_text(digest + '  ' + args.output.name + '\n', encoding='ascii')
    return dict(appId=metadata['id'], version=metadata['version'], files=len(payload), sha256=digest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--version')
    parser.add_argument('--key', type=pathlib.Path, required=True)
    parser.add_argument('--engine-dir', type=pathlib.Path, default=ROOT / 'web/qqq-gex/runtime-dist')
    parser.add_argument('--ui-dir', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    print(json.dumps(package(parser.parse_args())))
