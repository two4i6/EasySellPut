import copy
import datetime as dt
import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'build/release'))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT/path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


source = load('app_source', 'build/release/app-source.py')
release = load('catalog_release', 'build/release/app-release.py')
from app_definitions import catalog_sequence
setup = load('distribution_setup', 'build/configure-app-distribution.py')


class AppDistributionSetupTests(unittest.TestCase):
    def test_auto_source_selects_exact_current_main_ci_before_auto_promotion(self):
        sha = 'a'*40
        plan = dict(sourceCommit=sha, ciRunId=12)
        missing = mock.Mock(returncode=1, stderr='HTTP 404', stdout='')
        with mock.patch.object(source, 'current_main', return_value=sha), mock.patch.object(source, 'gh_json', return_value={'workflow_runs':[{'id':11,'head_sha':'b'*40},{'id':12,'head_sha':sha}]}), mock.patch.object(source, 'select', return_value=plan) as select, mock.patch.object(source.subprocess, 'run', return_value=missing):
            actual, outputs = source.resolve('owner/repo', 'auto', '1.0.1', automatic=True)
            self.assertEqual(actual, plan)
            self.assertEqual(outputs['skip'], 'false')
            self.assertEqual(outputs['action'], 'auto')
            select.assert_called_once_with('owner/repo', '12')
        with self.assertRaisesRegex(ValueError, 'Automatic publication'):
            source.resolve('owner/repo', 'publish', automatic=True)

    def test_auto_source_never_replaces_published_or_other_commit_draft(self):
        sha = 'a'*40
        for existing in [{'draft':False,'target_commitish':sha},{'draft':True,'target_commitish':'b'*40}]:
            import json
            result = mock.Mock(returncode=0, stdout=json.dumps(existing))
            with mock.patch.object(source, 'current_main', return_value=sha), mock.patch.object(source, 'select', return_value=dict(sourceCommit=sha, ciRunId=12)), mock.patch.object(source.subprocess, 'run', return_value=result):
                self.assertEqual(source.resolve('owner/repo','prepare','1.0.1','12',True)[1]['skip'],'true')
        with mock.patch.object(source, 'current_main', return_value=sha), mock.patch.object(source, 'gh_json', return_value={'workflow_runs':[]}):
            with self.assertRaisesRegex(ValueError,'Wait for successful CI'):
                source.resolve('owner/repo','prepare','1.0.1')

    def test_two_apps_can_advance_one_catalog_in_the_same_run_without_replacing_other_entries(self):
        now=dt.datetime.now(dt.timezone.utc)
        first=release.merge_catalog(None,dict(id='easysellput.qqq-gex',version='1.0.0',dataFormat=1),'owner/repo',catalog_sequence(None,'1000'),now)
        second=release.merge_catalog(first,dict(id='easysellput.market-liquidity',version='1.0.0',dataFormat=1),'owner/repo',catalog_sequence(first,'1000'),now)
        self.assertEqual(first['sequence'],1000);self.assertEqual(second['sequence'],1001)
        self.assertIn(first['apps'][0],second['apps'])
        self.assertEqual(catalog_sequence(second,'1002'),1002)
        self.assertEqual(catalog_sequence(second,'999'),1002)
        for previous in ({}, {'sequence':True}, {'sequence':0}, {'sequence':2**53}, {'sequence':'1000'}):
            with self.assertRaises(ValueError):catalog_sequence(previous,'1000')
        for run in ('0','-1','unsafe',str(2**53)):
            with self.assertRaises(ValueError):catalog_sequence(second,run)

    def test_liquidity_source_resolves_its_own_version_and_tag(self):
        sha='a'*40
        with mock.patch.object(source,'current_main',return_value=sha), mock.patch.object(source,'select',return_value=dict(sourceCommit=sha,ciRunId=12)), mock.patch.object(source.subprocess,'run',return_value=mock.Mock(returncode=1,stderr='HTTP 404')) as run:
            _,outputs=source.resolve('owner/repo','auto','1.2.3','12',True,app='market-liquidity')
            self.assertEqual(outputs['version'],'1.2.3')
            self.assertIn('easysellput.market-liquidity-v1.2.3',run.call_args.args[0][-1])
        with self.assertRaises(ValueError):source.resolve('owner/repo','auto',app='../foreign')

    def test_news_joins_the_same_signed_catalog_without_mutating_prior_app_entries(self):
        from app_definitions import definition
        self.assertEqual(definition('news-fundamentals')['id'],'easysellput.news-fundamentals')
        self.assertEqual(definition('options-strategy')['id'],'easysellput.options-strategy')
        now=dt.datetime.now(dt.timezone.utc)
        catalog=None
        for app in ('qqq-gex','market-liquidity','news-fundamentals','options-strategy'):
            old=copy.deepcopy(catalog)
            catalog=release.merge_catalog(catalog,dict(id=definition(app)['id'],version='1.0.0',dataFormat=1),'owner/repo',catalog_sequence(catalog,'1000'),now)
            if old:self.assertTrue(all(entry in catalog['apps'] for entry in old['apps']))
        self.assertEqual(catalog['sequence'],1002)
        self.assertEqual(len(catalog['apps']),3)

    def test_catalog_renewal_retains_all_package_identities_even_after_expiry(self):
        now = dt.datetime.now(dt.timezone.utc)
        previous = dict(schemaVersion=1,repository='owner/repo',sequence=10,issuedAt=(now-dt.timedelta(days=50)).isoformat(),expiresAt=(now-dt.timedelta(days=20)).isoformat(),apps=[dict(id='one',version='1.0.0',sha256='a'*64,withdrawn=False),dict(id='two',version='2.0.0',withdrawn=True)])
        original = copy.deepcopy(previous)
        renewed = release.renew_catalog(previous,'owner/repo',11,now)
        self.assertEqual(release.renew_catalog(previous|{'apps':[]},'owner/repo',11,now)['apps'],[])
        self.assertEqual(previous,original)
        self.assertEqual(renewed['apps'],previous['apps'])
        self.assertEqual(dt.datetime.fromisoformat(renewed['expiresAt'])-now,dt.timedelta(days=30))
        for bad in [dict(repository='foreign/repo'),dict(sequence=11),dict(apps=previous['apps']*2),dict(expiresAt=(now+dt.timedelta(days=31)).isoformat())]:
            with self.assertRaises(ValueError):release.renew_catalog(previous|bad,'owner/repo',11,now)

    def test_setup_preserves_reviewers_and_timer_and_refuses_unknown_protection(self):
        current=dict(can_admins_bypass=False,protection_rules=[dict(type='wait_timer',wait_timer=5),dict(type='required_reviewers',prevent_self_review=True,reviewers=[dict(type='User',reviewer={'id':42})])])
        result=setup.environment_settings(current)
        self.assertEqual(result['reviewers'],[dict(type='User',id=42)])
        self.assertTrue(result['prevent_self_review'])
        self.assertEqual(result['wait_timer'],5)
        self.assertFalse(result['can_admins_bypass'])
        self.assertEqual(result['deployment_branch_policy'],dict(protected_branches=False,custom_branch_policies=True))
        with self.assertRaises(ValueError):setup.environment_settings(dict(protection_rules=[dict(type='custom')]))

    def test_setup_does_not_generate_or_replace_keys_without_administration_access(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(setup,'api',side_effect=[dict(default_branch='main',permissions={'admin':True}),dict(protection_rules=[]),RuntimeError('HTTP 403')]) as api, mock.patch.object(setup.subprocess,'run') as run:
                with self.assertRaisesRegex(RuntimeError,'403'):setup.configure('owner/repo',pathlib.Path(directory)/'key.pem',True)
                run.assert_not_called()
                self.assertEqual(api.call_count,3)
            self.assertEqual(list(pathlib.Path(directory).iterdir()),[])
        with mock.patch.object(setup,'api',side_effect=[dict(default_branch='main',permissions={'admin':True}),dict(protection_rules=[]),{'secrets':[{'name':'UPDATE_SIGNING_KEY'}]}]), mock.patch.object(setup.subprocess,'run') as run:
            with self.assertRaisesRegex(ValueError,'Signing secret exists'):setup.configure('owner/repo','/tmp/unused-backup.pem',True)
            run.assert_not_called()

    def test_setup_preserves_existing_switches_and_defaults_new_switches_off(self):
        for existing in (None, {'name':'APPS_AUTO_RELEASE', 'value':'true'}):
            calls=[]
            def api(endpoint, method='GET', body=None, missing=False):
                calls.append((endpoint,method,body))
                if endpoint == 'repos/owner/repo':return dict(default_branch='main',permissions={'admin':True})
                if endpoint.endswith('/secrets'):return {'secrets':[]}
                if endpoint.endswith('/deployment-branch-policies'):return {'branch_policies':[{'name':'main','type':'branch'}]}
                if '/actions/variables/' in endpoint:return existing
                return {}
            with tempfile.TemporaryDirectory() as directory, mock.patch.object(setup,'api',side_effect=api), mock.patch.object(setup.subprocess,'run'):
                setup.configure('owner/repo',pathlib.Path(directory)/'key.pem')
            variable_writes=[c for c in calls if '/actions/variables' in c[0] and c[1] != 'GET']
            self.assertEqual(len(variable_writes),2 if existing is None else 0)
            self.assertTrue(all(c[2]['value']=='false' for c in variable_writes))

    def test_refresh_uses_real_signatures_preserves_packages_and_detects_publication_race(self):
        import json
        import os
        import shutil
        import subprocess
        now=dt.datetime.now(dt.timezone.utc)
        previous=dict(schemaVersion=1,repository='owner/repo',sequence=10,issuedAt=(now-dt.timedelta(days=50)).isoformat(),expiresAt=(now-dt.timedelta(days=20)).isoformat(),apps=[dict(id='one',version='1.0.0',sha256='a'*64,withdrawn=False)])
        real_run=subprocess.run
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);key=root/'test-only-private.pem';public=root/'public.pem'
            real_run(['openssl','ecparam','-name','prime256v1','-genkey','-noout','-out',str(key)],check=True,capture_output=True)
            real_run(['openssl','pkey','-in',str(key),'-pubout','-out',str(public)],check=True,capture_output=True)
            for race in (False,True):
                work=root/str(race);work.mkdir();reads=0;uploads=[]
                def command(arguments,**kwargs):
                    if arguments[0]=='gh':
                        body=dict(draft=False,tag_name='apps',assets=[{'name':release.CATALOG},{'name':release.CATALOG+'.sig'}])
                        return subprocess.CompletedProcess(arguments,0,json.dumps(body),'')
                    return real_run(arguments,**kwargs)
                def gh(*arguments):
                    nonlocal reads
                    if arguments[:2]==('release','download'):
                        folder=pathlib.Path(arguments[arguments.index('--dir')+1]);name=arguments[arguments.index('--pattern')+1]
                        if name==release.CATALOG:
                            reads+=1
                            value=previous|({'sequence':11}if race and reads==2 else{})
                            (folder/name).write_text(json.dumps(value))
                            real_run(['openssl','dgst','-sha256','-sign',str(key),'-out',str(folder/(name+'.sig')),str(folder/name)],check=True,capture_output=True)
                    elif arguments[:2]==('release','upload'):
                        self.assertEqual(arguments[2],'apps')
                        body=pathlib.Path(arguments[3]);signature=pathlib.Path(arguments[4])
                        real_run(['openssl','dgst','-sha256','-verify',str(public),'-signature',str(signature),str(body)],check=True,capture_output=True)
                        uploads.append(json.loads(body.read_text()))
                    else:self.fail('Renewal must never create/publish releases or upload app packages')
                    return ''
                with mock.patch.object(release,'PUBLIC',public),mock.patch.object(release,'current_main',return_value='a'*40),mock.patch.object(release,'gh',side_effect=gh),mock.patch.object(release.subprocess,'run',side_effect=command),mock.patch.dict(os.environ,{'GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'12','UPDATE_SIGNING_KEY':key.read_text()}):
                    if race:
                        with self.assertRaisesRegex(ValueError,'Catalog changed'):release.refresh('owner/repo',work)
                        self.assertEqual(uploads,[])
                    else:
                        release.refresh('owner/repo',work)
                        self.assertEqual(len(uploads),1)
                        self.assertEqual(uploads[0]['apps'],previous['apps'])
                self.assertFalse((work/'private.pem').exists())
