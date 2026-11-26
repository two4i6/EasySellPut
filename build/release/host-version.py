#!/usr/bin/env python3
"""Skip published host versions before platform signing; never treat API errors as absence."""
import json
import os
import pathlib
import re
import subprocess
import xml.etree.ElementTree as ET
from policy import require


def inspect_version(repository, version):
    require(re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version), 'Canonical host version required')
    result = subprocess.run(['gh', 'api', f'repos/{repository}/releases/tags/v{version}'], capture_output=True, text=True)
    if result.returncode:
        require('HTTP 404' in result.stderr, 'Could not inspect host version')
        return False
    release = json.loads(result.stdout)
    require(not release['draft'], 'Existing host draft requires manual verification/publication; no automatic overwrite')
    return True


def main():
    require(os.environ.get('GITHUB_REF') == 'refs/heads/main', 'Host releases require main')
    version = ET.parse('Directory.Build.props').findtext('./PropertyGroup/Version')
    skip = inspect_version(os.environ['GITHUB_REPOSITORY'], version)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write(f'version={version}\nskip={str(skip).lower()}\n')
    print('Host version already published; skipping.' if skip else 'New host version; signed package validation required.')


if __name__ == '__main__':
    main()
