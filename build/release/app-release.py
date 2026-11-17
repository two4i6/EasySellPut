#!/usr/bin/env python3
"""Promote a tested app artifact; main-only draft/publication, no host build or local trust override."""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile
import zipfile
from policy import require, select, current_main

ROOT=pathlib.Path(__file__).resolve().parents[2]
PUBLIC=ROOT/'src/Meili.Application/Updates/update-public-key.pem'
CATALOG='EasySellPut-apps.json'


def gh(*args):
    return subprocess.check_output(['gh',*map(str,args)],text=True)


def verify(body,signature):
    subprocess.run(['openssl','dgst','-sha256','-verify',str(PUBLIC),'-signature',str(signature),str(body)],check=True,capture_output=True)


def validate_package(path,repository,version):
    require(path.stat().st_size<=512*1024*1024,'App archive exceeds bound')
    with zipfile.ZipFile(path) as archive:
        names=archive.namelist()
        require(len(names)==len(set(n.lower() for n in names)) and 3<=len(names)<=8192,'Duplicate app archive entries')
        require(sum(i.file_size for i in archive.infolist())<=512*1024*1024,'Expanded app exceeds bound')
        for name in names:
            require(len(name)<=240 and not name.startswith('/') and '\\' not in name and ':' not in name and all(p not in ('','.','..') for p in name.split('/')),'Unsafe app archive path')
        body=archive.read('app.json');require(len(body)<=262144,'Oversized app manifest');manifest=json.loads(body)
        require(manifest['schemaVersion']==manifest['hostApi']==manifest['engineProtocol']==1,'Unsupported app protocol')
        require(manifest['repository']==repository and manifest['id']=='easysellput.qqq-gex' and manifest['version']==version,'App source/version mismatch')
        expected=json.loads((ROOT/'web/qqq-gex/source-manifest.json').read_text())['commit']
        require(manifest['modelVersion']==expected,'Original model revision mismatch')
        files=manifest['files'];require({f['path'] for f in files}|{'app.json','app.sig'}==set(names) and len(files)==len(names)-2,'Incomplete app file table')
        for item in files:
            data=archive.read(item['path'])
            require(len(data)==item['size'] and hashlib.sha256(data).hexdigest().lower()==item['sha256'].lower(),'App payload differs from tested artifact')
        payload={name:archive.read(name) for name in names if name!='app.sig'}
    return manifest,payload


def merge_catalog(previous,entry,repository,sequence,now):
    require(previous is None or previous['repository']==repository,'Foreign app catalog')
    require(previous is None or previous['sequence']<sequence,'Stale app catalog generation')
    apps=[] if previous is None else previous['apps']
    current=next((a for a in apps if a['id']==entry['id']),None)
    if current:
        require(tuple(map(int,entry['version'].split('.')))>=tuple(map(int,current['version'].split('.'))),'App downgrade refused')
        require(entry['dataFormat']==current['dataFormat'],'App data migration requires separate verification')
    apps=[a for a in apps if a['id']!=entry['id']]+[entry]
    require(len(apps)<=64 and len({a['id'] for a in apps})==len(apps),'Invalid app catalog identities')
    return dict(schemaVersion=1,repository=repository,sequence=sequence,issuedAt=now.isoformat(),expiresAt=(now+dt.timedelta(days=30)).isoformat(),apps=sorted(apps,key=lambda a:a['id']))


def previous_catalog(repository,folder):
    result=subprocess.run(['gh','api',f'repos/{repository}/releases/tags/apps'],capture_output=True,text=True)
    if result.returncode:
        require('HTTP 404' in result.stderr,'Could not authenticate current app catalog release');return None
    release=json.loads(result.stdout);require(not release['draft'] and release['tag_name']=='apps','Invalid app catalog release')
    for name in (CATALOG,CATALOG+'.sig'):
        require(sum(a['name']==name for a in release['assets'])==1,'Missing/duplicate app catalog asset')
        gh('release','download','apps','--repo',repository,'--pattern',name,'--dir',folder)
    verify(folder/CATALOG,folder/(CATALOG+'.sig'))
    body=(folder/CATALOG).read_bytes();require(len(body)<=262144,'Oversized previous app catalog')
    return json.loads(body)


def sign(path,key):
    output=path.with_name(path.name+'.sig')
    subprocess.run(['openssl','dgst','-sha256','-sign',str(key),'-out',str(output),str(path)],check=True)
    verify(path,output)


def prepare(args,plan,folder):
    repository=plan['repository'];source=pathlib.Path(args.artifact)
    manifest,payload=validate_package(source,repository,args.version)
    raw=os.environ.get('UPDATE_SIGNING_KEY','');require(bool(raw),'Configure UPDATE_SIGNING_KEY matching pinned host trust')
    key=folder/'private.pem';key.write_text(raw);key.chmod(0o600)
    try:
        signature=subprocess.check_output(['openssl','dgst','-sha256','-sign',str(key)],input=payload['app.json'])
        app_id=manifest['id'];name=f'{app_id}-{args.version}.espapp';package=folder/name
        with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED) as archive:
            for name_in,data in sorted({**payload,'app.sig':signature}.items()):
                info=zipfile.ZipInfo(name_in,(2026,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED
                archive.writestr(info,data)
        manifest_file=folder/'candidate-manifest.json';manifest_file.write_bytes(payload['app.json']);signature_file=folder/'candidate-manifest.sig';signature_file.write_bytes(signature)
        verify(manifest_file,signature_file)
        old=folder/'previous';old.mkdir();previous=previous_catalog(repository,old)
        entry=dict(id=app_id,version=args.version,hostApi=manifest['hostApi'],engineProtocol=manifest['engineProtocol'],dataFormat=manifest['dataFormat'],platforms=manifest['platforms'],size=package.stat().st_size,sha256=hashlib.sha256(package.read_bytes()).hexdigest(),hasUi=manifest.get('ui') is not None,withdrawn=False)
        catalog=merge_catalog(previous,entry,repository,int(os.environ['GITHUB_RUN_ID']),dt.datetime.now(dt.timezone.utc))
        catalog_file=folder/CATALOG;catalog_file.write_text(json.dumps(catalog,separators=(',',':')));sign(catalog_file,key)
        provenance=dict(schemaVersion=1,repository=repository,sourceCommit=plan['sourceCommit'],ciRunId=plan['ciRunId'],appId=app_id,version=args.version,sequence=catalog['sequence'],package=name,sha256=entry['sha256'],size=entry['size'],catalogSha256=hashlib.sha256(catalog_file.read_bytes()).hexdigest())
        index=folder/'app-release.json';index.write_text(json.dumps(provenance,separators=(',',':')));sign(index,key)
        tag=f'{app_id}-v{args.version}'
        require(select(repository,args.run_id)['sourceCommit']==plan['sourceCommit'],'Main advanced before draft preparation')
        existing=subprocess.run(['gh','api',f'repos/{repository}/releases/tags/{tag}'],capture_output=True,text=True)
        assets=[package,catalog_file,str(catalog_file)+'.sig',index,str(index)+'.sig']
        if existing.returncode==0:
            draft=json.loads(existing.stdout)
            require(draft['draft'] and draft['target_commitish']==plan['sourceCommit'],'Published or foreign app version is immutable')
            gh('release','upload',tag,*assets,'--repo',repository,'--clobber')
        else:
            require('HTTP 404' in existing.stderr,'Could not inspect existing app draft')
            gh('release','create',tag,*assets,'--repo',repository,'--target',plan['sourceCommit'],'--title',f'QQQ GEX {args.version}','--notes','Independent app package. Host binaries are unchanged. Publication requires the explicit Apps release workflow.','--draft','--prerelease')
    finally:
        key.unlink(missing_ok=True)


def publish(args,plan,folder):
    repository=plan['repository'];app_id='easysellput.qqq-gex';tag=f'{app_id}-v{args.version}';name=f'{app_id}-{args.version}.espapp'
    release=json.loads(gh('release','view',tag,'--repo',repository,'--json','isDraft,isPrerelease,targetCommitish,assets'))
    expected={name,CATALOG,CATALOG+'.sig','app-release.json','app-release.json.sig'}
    require(release['isDraft'] and release['isPrerelease'] and release['targetCommitish']==plan['sourceCommit'],'Expected the current tested main app draft')
    require({a['name'] for a in release['assets']}==expected and len(release['assets'])==len(expected),'Unexpected draft assets')
    for asset in expected:gh('release','download',tag,'--repo',repository,'--pattern',asset,'--dir',folder)
    verify(folder/'app-release.json',folder/'app-release.json.sig');verify(folder/CATALOG,folder/(CATALOG+'.sig'))
    index=json.loads((folder/'app-release.json').read_text());catalog=json.loads((folder/CATALOG).read_text());package=folder/name
    require(index['repository']==repository and index['sourceCommit']==plan['sourceCommit'] and index['ciRunId']==plan['ciRunId'] and index['appId']==app_id and index['version']==args.version,'Draft provenance mismatch')
    require(index['package']==name and index['size']==package.stat().st_size and index['sha256']==hashlib.sha256(package.read_bytes()).hexdigest(),'Draft package mismatch')
    require(index['catalogSha256']==hashlib.sha256((folder/CATALOG).read_bytes()).hexdigest() and catalog['repository']==repository and catalog['sequence']==index['sequence'],'Draft catalog mismatch')
    require(dt.datetime.fromisoformat(catalog['expiresAt'])>dt.datetime.now(dt.timezone.utc),'Draft catalog expired; prepare a new draft')
    _,payload=validate_package(package,repository,args.version)
    (folder/'manifest.json').write_bytes(payload['app.json'])
    with zipfile.ZipFile(package) as archive:(folder/'manifest.sig').write_bytes(archive.read('app.sig'))
    verify(folder/'manifest.json',folder/'manifest.sig')
    old=folder/'previous';old.mkdir();previous=previous_catalog(repository,old)
    require(previous is None or previous['sequence']<catalog['sequence'],'A newer app catalog is already published')
    entry=next((a for a in catalog['apps'] if a['id']==app_id),None)
    require(entry is not None and entry['version']==args.version and entry['sha256']==index['sha256'] and entry['size']==index['size'] and not entry.get('withdrawn',False),'Draft catalog does not bind the candidate package')
    if previous is not None:
        next_apps={a['id']:a for a in catalog['apps']}
        require(all(a['id'] in next_apps and next_apps[a['id']]==a for a in previous['apps'] if a['id']!=app_id),'Other applications changed after draft preparation; prepare a fresh draft')
        old_app=next((a for a in previous['apps'] if a['id']==app_id),None)
        if old_app:
            require(tuple(map(int,old_app['version'].split('.'))) <= tuple(map(int,args.version.split('.'))) and old_app['dataFormat']==entry['dataFormat'],'Published app state advanced after draft preparation')
    require(select(repository,args.run_id)['sourceCommit']==plan['sourceCommit'],'Main advanced before publication')
    gh('release','edit',tag,'--repo',repository,'--draft=false','--prerelease','--latest=false')
    if previous is None:gh('release','create','apps','--repo',repository,'--target',plan['sourceCommit'],'--title','Application update catalog','--notes','Signed app catalog; separate from host updates.','--prerelease','--latest=false')
    gh('release','upload','apps',folder/CATALOG,folder/(CATALOG+'.sig'),'--repo',repository,'--clobber')



def renew_catalog(previous, repository, sequence, now):
    require(previous.get('schemaVersion') == 1 and previous.get('repository') == repository, 'Invalid catalog source')
    require(type(previous.get('sequence')) is int and 0 < previous['sequence'] < sequence, 'Stale catalog renewal')
    issued = dt.datetime.fromisoformat(previous['issuedAt'])
    expires = dt.datetime.fromisoformat(previous['expiresAt'])
    require(issued.tzinfo is not None and expires.tzinfo is not None and dt.timedelta(0) < expires-issued <= dt.timedelta(days=30) and issued <= now+dt.timedelta(minutes=5), 'Invalid original catalog clocks')
    apps = previous.get('apps')
    require(isinstance(apps, list) and len(apps) <= 64 and all(isinstance(a, dict) and isinstance(a.get('id'), str) for a in apps), 'Invalid catalog entries')
    require(len({a['id'] for a in apps}) == len(apps), 'Duplicate app identity')
    return dict(schemaVersion=1, repository=repository, sequence=sequence, issuedAt=now.isoformat(), expiresAt=(now+dt.timedelta(days=30)).isoformat(), apps=apps)


def refresh(repository, folder):
    # Renew authenticated metadata only. Never create a release or modify app packages.
    require(current_main(repository) == os.environ['GITHUB_SHA'], 'Main advanced before renewal')
    old = folder/'previous'; old.mkdir()
    previous = previous_catalog(repository, old)
    if previous is None:
        print('No published app catalog yet; nothing to renew.')
        return
    catalog = renew_catalog(previous, repository, int(os.environ['GITHUB_RUN_ID']), dt.datetime.now(dt.timezone.utc))
    raw = os.environ.get('UPDATE_SIGNING_KEY', '')
    require(bool(raw), 'Configure UPDATE_SIGNING_KEY matching pinned host trust')
    key = folder/'private.pem'; key.write_text(raw); key.chmod(0o600)
    try:
        body = folder/CATALOG; body.write_text(json.dumps(catalog, separators=(',', ':')))
        sign(body, key)
        check = folder/'current'; check.mkdir()
        require(previous_catalog(repository, check) == previous, 'Catalog changed before renewal')
        require(current_main(repository) == os.environ['GITHUB_SHA'], 'Main advanced before renewal upload')
        gh('release', 'upload', 'apps', body, str(body)+'.sig', '--repo', repository, '--clobber')
    finally:
        key.unlink(missing_ok=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['prepare','publish','refresh']);parser.add_argument('--run-id');parser.add_argument('--version');parser.add_argument('--artifact',type=pathlib.Path)
    args=parser.parse_args();require(os.environ.get('GITHUB_REF')=='refs/heads/main','App releases require main');require(args.action=='refresh' or args.version is not None and re.fullmatch(r'\d+\.\d+\.\d+',args.version),'Stable app version required')
    if args.action=='refresh':
        with tempfile.TemporaryDirectory(prefix='app-catalog-renew-') as scratch:refresh(os.environ['GITHUB_REPOSITORY'],pathlib.Path(scratch))
        raise SystemExit(0)
    require(args.run_id is not None,'Tested main CI run required')
    plan=select(os.environ['GITHUB_REPOSITORY'],args.run_id)
    with tempfile.TemporaryDirectory(prefix='app-release-') as scratch:
        if args.action=='prepare':require(args.artifact is not None,'Tested app artifact required');prepare(args,plan,pathlib.Path(scratch))
        else:publish(args,plan,pathlib.Path(scratch))
