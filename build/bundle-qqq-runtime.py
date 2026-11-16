#!/usr/bin/env python3
"""Bundle one pinned official Node executable. Build-time only; no app-side downloads."""
import argparse,hashlib,json,pathlib,tarfile,urllib.request,zipfile,io,os
ROOT=pathlib.Path(__file__).resolve().parents[1]
LOCK=ROOT/'web/qqq-gex/node-runtime-lock.json'
def sha(data):return hashlib.sha256(data).hexdigest()
def bundle(rid,destination,cache):
 lock=json.loads(LOCK.read_text());entry=lock['platforms'][rid];name=entry['archive'];cache.mkdir(parents=True,exist_ok=True);archive=cache/name
 if not archive.exists():
  request=urllib.request.Request('https://nodejs.org/dist/v'+lock['version']+'/'+name,headers={'User-Agent':'EasySellPut-build'})
  with urllib.request.urlopen(request,timeout=60) as response:
   if response.geturl()!='https://nodejs.org/dist/v'+lock['version']+'/'+name:raise ValueError('Unexpected download redirect')
   data=response.read(150*1024*1024+1)
  if len(data)>150*1024*1024 or sha(data)!=entry['archiveSha256']:raise ValueError('Node archive checksum mismatch')
  archive.write_bytes(data)
 data=archive.read_bytes()
 if sha(data)!=entry['archiveSha256']:raise ValueError('Cached Node checksum mismatch')
 prefix=name.removesuffix('.tar.gz').removesuffix('.zip');binary='node.exe' if rid.startswith('win-') else 'bin/node'
 def read(member):
  full=prefix+'/'+member
  if name.endswith('.zip'):
   with zipfile.ZipFile(io.BytesIO(data)) as z:return z.read(full)
  with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as t:
   info=t.getmember(full)
   if not info.isfile():raise ValueError('Node member must be a regular file')
   return t.extractfile(info).read()
 executable=read(binary);license=read('LICENSE')
 if sha(executable)!=entry['executableSha256']:raise ValueError('Node executable checksum mismatch')
 destination=destination/'runtime';destination.mkdir(parents=True,exist_ok=True);target=destination/name
 if target.exists() and sha(target.read_bytes())!=entry['archiveSha256']:raise FileExistsError('Refusing to replace different runtime archive')
 target.write_bytes(data);(destination/'NODE-LICENSE').write_bytes(license)
 (destination/'node-provenance.json').write_text(json.dumps({'version':lock['version'],'rid':rid,'archiveSha256':entry['archiveSha256'],'executableSha256':sha(executable)},indent=2)+'\n')
 return sha(executable)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('rid');p.add_argument('destination',type=pathlib.Path);p.add_argument('--cache',type=pathlib.Path,default=ROOT/'tools/_downloads/node');a=p.parse_args();print(bundle(a.rid,a.destination,a.cache))
