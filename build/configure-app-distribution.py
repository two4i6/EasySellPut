#!/usr/bin/env python3
"""Review/apply first-party GitHub app distribution settings. Never merge main or publish."""
import argparse
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def api(endpoint, method='GET', body=None, missing=False):
    command = ['gh', 'api', endpoint, '--method', method]
    if body is not None:
        command += ['--input', '-']
    result = subprocess.run(command, input=None if body is None else json.dumps(body), capture_output=True, text=True)
    if missing and result.returncode and 'HTTP 404' in result.stderr:
        return None
    if result.returncode:
        raise RuntimeError('GitHub administration access required: ' + result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else None


def environment_settings(environment):
    # Preserve existing reviewers/timers instead of silently weakening protection.
    result = {'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}}
    for rule in (environment or {}).get('protection_rules', []):
        if rule['type'] == 'wait_timer':
            result['wait_timer'] = rule['wait_timer']
        elif rule['type'] == 'required_reviewers':
            result['reviewers'] = [{'type': r['type'], 'id': r['reviewer']['id']} for r in rule['reviewers']]
            result['prevent_self_review'] = rule.get('prevent_self_review', False)
        elif rule['type'] != 'branch_policy':
            raise ValueError('Custom environment protection requires manual review; refusing to overwrite it')
    if 'can_admins_bypass' in (environment or {}):
        result['can_admins_bypass'] = environment['can_admins_bypass']
    return result


def configure(repository, key, initialize=False):
    if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}', repository) is None:
        raise ValueError('Invalid repository')
    key = pathlib.Path(key).expanduser().absolute()
    if key.is_symlink() or key.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError('Keep the private backup outside Git in a regular owner-only file')
    base = f'repos/{repository}'
    repo = api(base)
    if repo.get('default_branch') != 'main' or not repo.get('permissions', {}).get('admin'):
        raise ValueError('Repository administrator access and main default branch required')
    environment = api(base + '/environments/release', missing=True)
    # Metadata only: never read or print secret values. Failure occurs before key generation.
    names = api(base + '/environments/release/secrets')['secrets'] if environment else []
    if initialize and any(s['name'] == 'UPDATE_SIGNING_KEY' for s in names):
        raise ValueError('Signing secret exists; use its matching private backup, never rotate silently')
    if initialize and api(base + '/releases?per_page=100'):
        # Drafts are allowed; published releases establish installed trust.
        if any(not r['draft'] for r in api(base + '/releases?per_page=100')):
            raise ValueError('Published releases exist; signing rotation needs a separate migration')
    api(base + '/environments/release', 'PUT', environment_settings(environment))
    policies = api(base + '/environments/release/deployment-branch-policies')['branch_policies']
    if not any(p['name'] == 'main' and p.get('type', 'branch') == 'branch' for p in policies):
        api(base + '/environments/release/deployment-branch-policies', 'POST', {'name': 'main', 'type': 'branch'})
    for policy in policies:
        if policy['name'] != 'main' or policy.get('type', 'branch') != 'branch':
            api(base + '/environments/release/deployment-branch-policies/' + str(policy['id']), 'DELETE')
    command = [sys.executable, str(ROOT/'build/setup-update-signing.py'), '--key', str(key), '--upload', '--repo', repository]
    if initialize:
        command.append('--initialize')
    subprocess.run(command, check=True)
    for name in ('HOST_AUTO_RELEASE', 'APPS_AUTO_RELEASE'):
        endpoint = base + '/actions/variables/' + name
        if api(endpoint, missing=True) is None:
            api(base + '/actions/variables', 'POST', {'name': name, 'value': 'false'})
    print('Configured main-only release environment and matching signing secret. Automatic release switches are preserved; new switches default to false.')
    print('Private backup remains at your chosen path. Commit only the public key and verified workflow changes.')
    print('No main merge, draft preparation or publication was dispatched.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='two4i6/EasySellPut')
    parser.add_argument('--key', type=pathlib.Path, required=True)
    parser.add_argument('--initialize', action='store_true', help='Only before the first published release and without an existing signing secret')
    args = parser.parse_args()
    try:
        configure(args.repo, args.key, args.initialize)
    except (RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
