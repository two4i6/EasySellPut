import copy
import datetime as dt
import importlib.util
import pathlib
import sys
import unittest
import yaml
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'build/release'))
import policy
spec=importlib.util.spec_from_file_location('app_release',ROOT/'build/release/app-release.py')
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
spec2=importlib.util.spec_from_file_location('workflow_guard',ROOT/'build/release/check-workflows.py')
guard=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(guard)

class AppReleasePolicyTests(unittest.TestCase):
    def test_catalog_merge_preserves_other_apps_and_refuses_rollback_and_data_rewind(self):
        now=dt.datetime.now(dt.timezone.utc)
        entry=dict(id='easysellput.qqq-gex',version='1.0.1',dataFormat=1)
        previous=dict(repository='owner/repo',sequence=10,apps=[dict(id='easysellput.other',version='1.0.0',dataFormat=1),dict(id=entry['id'],version='1.0.0',dataFormat=1)])
        result=release.merge_catalog(previous,entry,'owner/repo',11,now)
        self.assertEqual({a['id'] for a in result['apps']},{'easysellput.other',entry['id']})
        self.assertEqual(dt.datetime.fromisoformat(result['expiresAt'])-now,dt.timedelta(days=30))
        for change in [dict(sequence=12),dict(repository='foreign/repo'),dict(apps=[dict(id=entry['id'],version='2.0.0',dataFormat=1)]),dict(apps=[dict(id=entry['id'],version='1.0.0',dataFormat=2)])]:
            with self.assertRaises(ValueError):release.merge_catalog(previous|change,entry,'owner/repo',11,now)
    def test_workflow_guard_rejects_app_branch_bypass_or_missing_native_app_platform(self):
        workflows={p.name:yaml.load(p.read_text(encoding='utf-8-sig'),Loader=yaml.BaseLoader)for p in (ROOT/'.github/workflows').glob('*.yml')}
        guard.check(workflows)
        changed=copy.deepcopy(workflows);changed['app-release.yml']['jobs']['release']['if']='true'
        with self.assertRaises(ValueError):guard.check(changed)
        changed=copy.deepcopy(workflows);changed['app-ci.yml']['jobs']['core']['strategy']['matrix']['include'].pop()
        with self.assertRaises(ValueError):guard.check(changed)

    def test_workflow_guard_refuses_ungated_publication_and_unsigned_renewal_path(self):
        workflows={p.name:yaml.load(p.read_text(encoding='utf-8-sig'),Loader=yaml.BaseLoader)for p in (ROOT/'.github/workflows').glob('*.yml')}
        changed=copy.deepcopy(workflows)
        step=next(s for s in changed['app-release.yml']['jobs']['release']['steps']if 'app-release.py publish' in s.get('run',''))
        step['if']='true'
        with self.assertRaises(ValueError):guard.check(changed)
        changed=copy.deepcopy(workflows);changed['app-catalog.yml']['jobs']['renew']['if']='true'
        with self.assertRaises(ValueError):guard.check(changed)

    def test_host_publication_cannot_bypass_signing_or_version_gate(self):
        workflows={p.name:yaml.load(p.read_text(encoding='utf-8-sig'),Loader=yaml.BaseLoader)for p in (ROOT/'.github/workflows').glob('*.yml')}
        for field, value in [('needs', ['source']), ('if', "github.ref == 'refs/heads/main'")]:
            changed=copy.deepcopy(workflows)
            changed['update-release.yml']['jobs']['publish'][field]=value
            with self.assertRaises(ValueError):guard.check(changed)

    def test_liquidity_cannot_bypass_source_validation_or_serialize_catalog_in_parallel(self):
        workflows={p.name:yaml.load(p.read_text(encoding='utf-8-sig'),Loader=yaml.BaseLoader)for p in (ROOT/'.github/workflows').glob('*.yml')}
        changed=copy.deepcopy(workflows)
        changed['app-release.yml']['jobs']['release']['strategy']={'matrix':{'app':['qqq-gex','market-liquidity']}}
        with self.assertRaises(ValueError):guard.check(changed)
        changed=copy.deepcopy(workflows)
        step=next(s for s in changed['app-release.yml']['jobs']['release']['steps'] if 'app-release.py publish --app market-liquidity' in s.get('run',''))
        step['if']='true'
        with self.assertRaises(ValueError):guard.check(changed)
