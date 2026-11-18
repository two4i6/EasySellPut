#!/usr/bin/env python3
"""Validate release workflow boundaries in CI; requires pinned PyYAML."""
import pathlib
import yaml
from policy import GATE_NAME, RID_LABELS

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
    select = prepare['jobs']['source']
    require("github.ref == 'refs/heads/main'" in select['if'] and "github.event.workflow_run.head_branch == 'main'" in select['if'], 'Source selection must reject non-main runs')
    require(prepare['jobs']['packages']['needs'] == 'source', 'Signing must depend on trusted source validation')
    require(set(prepare['jobs']['draft']['needs']) == {'source', 'packages'}, 'Draft must wait for all signed native packages')
    require(set(publish['on']) == {'workflow_dispatch'}, 'Publication must be explicitly dispatched')
    require(set(publish['jobs']) == {'publish'}, 'Unexpected publication jobs')
    host_publish = prepare['jobs']['publish']
    require(set(host_publish['needs']) == {'source', 'draft'}, 'Host publication must wait for signed draft')
    require("needs.source.outputs.skip != 'true'" in host_publish['if'] and "github.event_name == 'workflow_run'" in host_publish['if'], 'Automatic host publication requires version gating')
    require("vars.HOST_AUTO_RELEASE == 'true'" in select['if'], 'Automatic host release requires configuration')
    require(any('host-version.py' in step.get('run', '') for step in select['steps']), 'Host version must be checked before signing')
    require(any('publish.py' in step.get('run', '') and '--publish' in step['run'] for step in host_publish['steps']), 'Reuse verified host publication')
    require("needs.source.outputs.skip != 'true'" in prepare['jobs']['packages']['if'], 'Unchanged host version must skip signing')
    matrix = prepare['jobs']['packages']['strategy']['matrix']['include']
    require({m['rid'] for m in matrix} == {'linux-x64', 'win-x64', 'osx-x64', 'osx-arm64'}, 'Release platform coverage changed')
    apps = workflows['app-release.yml']
    require(set(apps['on']) == {'workflow_dispatch','workflow_run'}, 'Apps may prepare after main CI; publication requires verified promotion')
    require(apps['on']['workflow_run']['branches'] == ['main'] and apps['on']['workflow_run']['workflows'] == [ci['name']], 'Automatic app drafts require main CI')
    require(set(apps['jobs']) == {'release'}, 'Unexpected app release job')
    app_job = apps['jobs']['release']
    require("github.ref == 'refs/heads/main'" in app_job.get('if','') and app_job.get('environment') == 'release', 'App signing/publication must be main-only and protected')
    app_commands = '\n'.join(step.get('run','') for step in app_job['steps'])
    require('app-source.py' in app_commands and 'app-release.py prepare' in app_commands and 'app-release.py publish' in app_commands, 'Apps must validate provenance and separate preparation/publication')
    require(apps['on']['workflow_dispatch']['inputs']['app']['options'] == ['qqq-gex','market-liquidity','news-fundamentals','options-strategy','charts'], 'Manual recovery must select one known app')
    liquidity_steps=[step for step in app_job['steps'] if '--app market-liquidity' in step.get('run','')]
    require(len(liquidity_steps)==3 and any('app-source.py' in step.get('run','') for step in liquidity_steps), 'Liquidity must reuse source validation, preparation and publication')
    liquidity_publish=next(step for step in liquidity_steps if 'app-release.py publish' in step.get('run',''))
    require("steps.liquidity.outputs.skip != 'true'" in liquidity_publish.get('if','') and "steps.liquidity.outputs.action == 'auto'" in liquidity_publish['if'], 'Liquidity publication requires version gating')
    require('strategy' not in app_job, 'Catalog promotions must execute sequentially in one protected job')
    require(any(step.get('with',{}).get('name')=='LIQUIDITY-test-package' for step in ci['jobs']['qqq-gex']['steps']), 'The required CI must retain the tested liquidity artifact')
    news_steps=[step for step in app_job['steps'] if '--app news-fundamentals' in step.get('run','')]
    require(len(news_steps)==3, 'News must reuse all release validation stages')
    news_publish=next(step for step in news_steps if 'app-release.py publish' in step.get('run',''))
    require("steps.news.outputs.skip != 'true'" in news_publish.get('if',''), 'News publication needs version gating')
    require(any(step.get('with',{}).get('name')=='NEWS-test-package' for step in ci['jobs']['qqq-gex']['steps']), 'Required CI must retain the news artifact')
    options_steps=[step for step in app_job['steps'] if '--app options-strategy' in step.get('run','')]
    require(len(options_steps)==3, 'Options must reuse all release validation stages')
    options_publish=next(step for step in options_steps if 'app-release.py publish' in step.get('run',''))
    require("steps.options.outputs.skip != 'true'" in options_publish.get('if',''), 'Options publication needs version gating')
    require(any(step.get('with',{}).get('name')=='OPTIONS-test-package' for step in ci['jobs']['qqq-gex']['steps']), 'Required CI must retain the options artifact')
    chart_steps=[step for step in app_job['steps'] if '--app charts' in step.get('run','')]
    require(len(chart_steps)==3, 'Charts must reuse all release validation stages')
    chart_publish=next(step for step in chart_steps if 'app-release.py publish' in step.get('run',''))
    require("steps.charts.outputs.skip != 'true'" in chart_publish.get('if','') and "steps.charts.outputs.action == 'auto'" in chart_publish['if'], 'Chart publication needs version gating')
    require(any(step.get('with',{}).get('name')=='CHARTS-test-package' for step in ci['jobs']['qqq-gex']['steps']), 'Required CI must retain the chart artifact')
    publish_step = next(step for step in app_job['steps'] if 'app-release.py publish' in step.get('run',''))
    require("steps.source.outputs.skip != 'true'" in publish_step.get('if','') and "steps.source.outputs.action == 'auto'" in publish_step['if'], 'App publication requires validated version gating')
    require("vars.APPS_AUTO_RELEASE == 'true'" in app_job['if'], 'Automatic drafts require explicit configuration')
    renew = workflows['app-catalog.yml']
    require(set(renew['on']) == {'workflow_dispatch','schedule'}, 'Catalog renewal must not react to arbitrary branch pushes')
    renew_job = renew['jobs']['renew']
    require("github.ref == 'refs/heads/main'" in renew_job.get('if','') and renew_job.get('environment') == 'release', 'Catalog signing must be main-only and protected')
    require(renew['concurrency']['group'] == apps['concurrency']['group'] and renew['concurrency']['cancel-in-progress'] == 'false', 'App catalog writes must be serialized')
    require(any('app-release.py refresh' in step.get('run','') for step in renew_job['steps']), 'Use the shared authenticated catalog renewal')
    require('dotnet publish' not in app_commands and 'npm ' not in app_commands and 'pack-app.py' not in app_commands, 'App releases must promote tested artifacts without rebuilding')
    app_ci = workflows['app-ci.yml']
    require({row['rid'] for row in app_ci['jobs']['core']['strategy']['matrix']['include']} == set(RID_LABELS), 'Independent app core must retain four-platform coverage')
    for name, workflow in workflows.items():
        require(workflow.get('permissions', {}).get('contents') != 'write', 'Use job-scoped release write permissions: ' + name)
        for job_name, job in workflow.get('jobs', {}).items():
            if job.get('permissions', {}).get('contents') == 'write':
                require("github.ref == 'refs/heads/main'" in job.get('if', ''), 'Write job needs explicit main restriction')
                require(job.get('environment') == 'release', 'Write job needs release environment')
    require(prepare['jobs']['packages']['environment'] == 'release', 'Signing secrets need release environment')
    require("github.ref == 'refs/heads/main'" in prepare['jobs']['packages'].get('if', ''), 'Signing must explicitly require main')
    commands = '\n'.join(step.get('run', '') for step in prepare['jobs']['packages']['steps'])
    require('dotnet publish' not in commands and 'pack-desktop.py' not in commands and 'pack-cli.' not in commands, 'Release cannot rebuild application packages')
    require('--platform-signing none' in commands and prepare['jobs']['packages']['env'].get('PLATFORM_SIGNING') == 'none', 'Publisher signing is explicitly deferred, never inferred from missing secrets')
    require(any('assemble.py' in step.get('run', '') and '--platform-signing none' in step['run'] for step in prepare['jobs']['draft']['steps']), 'Release provenance must disclose the selected publisher-signing policy')
    require('check_desktop_package.py' in commands and 'cli_mcp_smoke.py' in commands and 'stapler validate' in commands, 'Final signed packages need native execution and notarization checks')
    require(set(ci['jobs']['required']['needs']) == {'cli', 'ui', 'desktop', 'release-policy', 'qqq-gex'}, 'All job families must remain required')
    require(ci['jobs']['required']['name'] == GATE_NAME, 'Aggregate check name differs from release policy')
    require(ci['jobs']['ui']['name'] == 'UI · Layout & Charts' and ci['jobs']['release-policy']['name'] == 'Release · main guard', 'Required job labels differ')
    require(ci['jobs']['cli']['name'] == '${{ matrix.label }} · CLI/MCP' and ci['jobs']['desktop']['name'] == '${{ matrix.label }} · Desktop', 'Use short platform-first job labels')
    for group in ('cli', 'desktop'):
        rows = ci['jobs'][group]['strategy']['matrix']['include']
        expected = RID_LABELS if group == 'cli' else {r: label for r, label in RID_LABELS.items() if r != 'linux-x64'}
        require({r['rid']: r['label'] for r in rows} == expected, 'Platform labels differ from release job validation')


if __name__ == '__main__':
    workflows = {p.name: yaml.load(p.read_text(encoding='utf-8-sig'), Loader=yaml.BaseLoader) for p in (ROOT / '.github/workflows').glob('*.yml')}
    check(workflows)
    print('PASS: main-only release, native package reuse, version-gated publication and required policy gate')
