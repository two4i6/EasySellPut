#!/usr/bin/env python3
"""Resolve a current-main app release without trusting input provenance or rebuilding payloads."""
import argparse
import json
import os
import pathlib
import re
import subprocess
from policy import current_main, gh_json, require, select

ROOT = pathlib.Path(__file__).resolve().parents[2]


def resolve(repository, action, version='', run_id='', automatic=False):
    require(action in ('prepare', 'publish'), 'Unknown app release action')
    require(not automatic or action == 'prepare', 'Automatic publication is forbidden')
    version = version or json.loads((ROOT / 'web/qqq-gex/app.json').read_text())['version']
    require(re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version), 'Canonical app version required')
    sha = current_main(repository)
    if not run_id:
        runs = gh_json(f'repos/{repository}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=30')['workflow_runs']
        candidates = [r for r in runs if r.get('head_sha') == sha]
        require(candidates, 'Wait for successful CI on the current main commit')
        run_id = str(candidates[0]['id'])
    plan = select(repository, run_id)
    require(plan['sourceCommit'] == sha, 'Main advanced during source selection')
    skip = False
    if automatic:
        result = subprocess.run(['gh', 'api', f'repos/{repository}/releases/tags/easysellput.qqq-gex-v{version}'], capture_output=True, text=True)
        if result.returncode == 0:
            release = json.loads(result.stdout)
            skip = not release['draft'] or release['target_commitish'] != sha
        else:
            require('HTTP 404' in result.stderr, 'Could not inspect existing app version')
    return plan, dict(action=action, version=version, run_id=str(plan['ciRunId']), skip=str(skip).lower())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    require(os.environ.get('GITHUB_REF') == 'refs/heads/main', 'App releases require main')
    automatic = os.environ.get('GITHUB_EVENT_NAME') == 'workflow_run'
    action = 'prepare' if automatic else os.environ.get('APP_ACTION', 'prepare')
    plan, outputs = resolve(os.environ['GITHUB_REPOSITORY'], action, os.environ.get('APP_VERSION_INPUT', ''), os.environ.get('CI_RUN_INPUT', ''), automatic)
    require(plan['sourceCommit'] == os.environ['GITHUB_SHA'], 'Main advanced since workflow dispatch; run again')
    args.output.write_text(json.dumps(plan, indent=2) + '\n')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        for name, value in outputs.items():
            stream.write(f'{name}={value}\n')
    with open(os.environ['GITHUB_ENV'], 'a') as stream:
        stream.write('RUN_ID=' + outputs['run_id'] + '\nAPP_VERSION=' + outputs['version'] + '\n')
    print('App version already published or an older draft exists; no automatic replacement.' if outputs['skip'] == 'true' else 'Current main CI verified; promote tested app bytes only.')


if __name__ == '__main__':
    main()
