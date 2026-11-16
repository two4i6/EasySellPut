#!/usr/bin/env python3
"""Check that maintained migration sources match their pinned provenance."""
import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parents[2]/'web/qqq-gex'
manifest=json.loads((root/'source-manifest.json').read_text())
for item in manifest['files']:
 path=root/'upstream'/item['path']
 if hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:raise SystemExit('Source changed: '+item['path'])
print(f"PASS: {len(manifest['files'])} source hashes at {manifest['commit']}")
