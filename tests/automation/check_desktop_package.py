#!/usr/bin/env python3
"""Validate a native desktop bundle, then run its real GUI self-check and bundled CLI/MCP."""
import argparse
import hashlib
import json
import pathlib
import plistlib
import stat
import subprocess
import sys
import tempfile
import zipfile
from check_cli_package import binary_architecture


def check(archive,rid,destination):
    expected,name=archive.with_suffix('.zip.sha256').read_text(encoding='ascii').strip().split('  ',1)
    with archive.open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==expected
    assert name==archive.name and not destination.exists()
    destination.mkdir(parents=True)
    # macOS ditto preserves code signatures and executable modes; Windows has no Unix mode requirement.
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            parts=pathlib.PurePosixPath(entry.filename).parts
            assert not entry.filename.startswith('/') and '..' not in parts
        if rid.startswith('osx-'):
            subprocess.run(['ditto','-x','-k',str(archive),str(destination)],check=True)
        else:bundle.extractall(destination)
    root=next(destination.iterdir());assert len(list(destination.iterdir()))==1
    if rid.startswith('win-'):
        gui=root/'EasySellPut.exe';base=root
        assert (root/'portable.flag').is_file()
        assert (root/'coreclr.dll').is_file()
        assert list(root.rglob('WebView2Loader.dll'))
    else:
        app=root/'EasySellPut.app';base=app/'Contents/MacOS';gui=base/'MeiliMac'
        info=plistlib.loads((app/'Contents/Info.plist').read_bytes());assert info['CFBundleExecutable']=='MeiliMac'
        assert (app/'Contents/Resources/AppIcon.icns').is_file()
        assert list(base.glob('*coreclr*.dylib'))
        subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    cli=base/'automation'/('easysellput.exe' if rid.startswith('win-') else 'easysellput')
    for executable in (gui,cli):binary_architecture(executable,rid)
    report=destination.parent/'desktop-smoke.json'
    with tempfile.TemporaryDirectory(prefix='meili desktop data ') as data:
        result=subprocess.run([str(gui),'--smoke-offline','--no-alerts','--data-dir',data,'--smoke-report',str(report.resolve())],timeout=180)
        assert result.returncode==0, report.read_text(encoding='utf-8') if report.exists() else 'GUI exited without report'
        evidence=json.loads(report.read_text(encoding='utf-8'));assert evidence['Failures']==0,evidence
    # Exercise the CLI taken from the extracted GUI bundle, not a developer build.
    subprocess.run([sys.executable,str(pathlib.Path(__file__).with_name('cli_mcp_smoke.py')),'--executable',str(cli)],check=True,timeout=180)
    print('PASS: desktop checksum, resources, architecture, real GUI startup/clipboard and bundled CLI/MCP')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--archive',type=pathlib.Path,required=True);p.add_argument('--rid',required=True);p.add_argument('--extract-to',type=pathlib.Path,required=True)
    a=p.parse_args();check(a.archive.resolve(),a.rid,a.extract_to.resolve())
