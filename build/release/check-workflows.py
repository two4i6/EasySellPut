#!/usr/bin/env python3
"""Validate release workflow boundaries in CI; requires pinned PyYAML."""
import pathlib
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]


def require(value, message):
    if not value:
        raise ValueError(message)


def check(workflows):
    prepare = workflows['update-release.yml']
    publish = workflows['publish-release.yml']
    ci = workflows['ci.yml']
    require(prepare['on']['workflow_run']['branches'] == ['main'], 'Automatic release must only follow main CI')
    require(prepare['on']['workflow_run']['workflows'] == [ci['name']], 'Release must follow the required CI workflow')
    select = prepare['jobs']['select']
    require("github.ref == 'refs/heads/main'" in select['if'] and "github.event.workflow_run.head_branch == 'main'" in select['if'], 'Source selection must reject non-main runs')
    require(prepare['jobs']['platform']['needs'] == 'select', 'Signing must depend on trusted source validation')
    require(set(prepare['jobs']['draft']['needs']) == {'select', 'platform'}, 'Draft must wait for all signed native packages')
    require(set(publish['on']) == {'workflow_dispatch'}, 'Publication must be explicitly dispatched')
    require(set(publish['jobs']) == {'publish'}, 'Unexpected publication jobs')
    matrix = prepare['jobs']['platform']['strategy']['matrix']['include']
    require({m['rid'] for m in matrix} == {'linux-x64', 'win-x64', 'win-arm64', 'osx-x64', 'osx-arm64'}, 'Release platform coverage changed')
    for name, workflow in workflows.items():
        require(workflow.get('permissions', {}).get('contents') != 'write', 'Use job-scoped release write permissions: ' + name)
        for job_name, job in workflow.get('jobs', {}).items():
            if job.get('permissions', {}).get('contents') == 'write':
                require("github.ref == 'refs/heads/main'" in job.get('if', ''), 'Write job needs explicit main restriction')
                require(job.get('environment') == 'release', 'Write job needs release environment')
    require(prepare['jobs']['platform']['environment'] == 'release', 'Signing secrets need release environment')
    require("github.ref == 'refs/heads/main'" in prepare['jobs']['platform'].get('if', ''), 'Signing must explicitly require main')
    commands = '\n'.join(step.get('run', '') for step in prepare['jobs']['platform']['steps'])
    require('dotnet publish' not in commands and 'pack-desktop.py' not in commands and 'pack-cli.' not in commands, 'Release cannot rebuild application packages')
    require('check_desktop_package.py' in commands and 'cli_mcp_smoke.py' in commands and 'stapler validate' in commands, 'Final signed packages need native execution and notarization checks')
    require('release-policy' in ci['jobs']['required']['needs'], 'Release policy must be part of the required CI gate')


if __name__ == '__main__':
    workflows = {p.name: yaml.load(p.read_text(encoding='utf-8-sig'), Loader=yaml.BaseLoader) for p in (ROOT / '.github/workflows').glob('*.yml')}
    check(workflows)
    print('PASS: main-only release, native package reuse, explicit publication and required policy gate')
