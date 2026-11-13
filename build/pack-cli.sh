#!/usr/bin/env bash
# Publish one self-contained CLI/MCP distribution. No trimming; preserve SDK reflection metadata.
# Usage: build/pack-cli.sh [linux-x64|linux-arm64|win-x64|win-arm64|osx-x64|osx-arm64] [output-parent]
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
source "$root/tools/env.sh"
cd "$root"
rid=${1:-linux-x64}
case "$rid" in linux-x64|linux-arm64|win-x64|win-arm64|osx-x64|osx-arm64) ;; *) echo 'Unsupported runtime identifier' >&2; exit 2 ;; esac
version=$(python3 -c 'import xml.etree.ElementTree as E; print(E.parse("Directory.Build.props").find(".//Version").text)')
parent=${2:-$root/build/out/cli}
mkdir -p "$parent"
parent=$(cd "$parent" && pwd)
name="EasySellPut-CLI-$version-$rid"
work=$(mktemp -d "$parent/.publish-XXXXXXXX")
trap 'rm -rf "$work"' EXIT
payload="$work/$name"
dotnet publish src/Meili.Cli/Meili.Cli.csproj -c Release -r "$rid" --self-contained true -m:3 \
  -p:PublishTrimmed=false -p:PublishSingleFile=false -p:PackAsTool=false -o "$payload" -v minimal
cp LICENSE "$payload/LICENSE"
cp docs/08-CLI与MCP使用说明.md "$payload/CLI-MCP.md"
cp docs/mcp-config.example.json "$payload/mcp-config.example.json"
# Never delete or overwrite an existing distribution silently.
if [[ -e "$parent/$name" || -e "$parent/$name.tar.gz" || -e "$parent/$name.zip" ]]; then
  echo "Distribution already exists: $parent/$name; choose another output-parent." >&2
  exit 2
fi
mv "$payload" "$parent/$name"
python3 - "$parent" "$name" "$rid" <<'PY'
import hashlib,pathlib,sys,tarfile,zipfile
base=pathlib.Path(sys.argv[1]); name=sys.argv[2]; rid=sys.argv[3]
if rid.startswith('win-'):
    archive=base/(name+'.zip')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted((base/name).rglob('*')):
            if p.is_file(): z.write(p,p.relative_to(base))
else:
    archive=base/(name+'.tar.gz')
    with tarfile.open(archive,'w:gz') as t: t.add(base/name,arcname=name)
checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(archive.suffix+'.sha256').write_text(checksum+'  '+archive.name+'\n')
print(archive)
PY
