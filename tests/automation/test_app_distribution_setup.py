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
setup = load('distribution_setup', 'build/configure-app-distribution.py')


class AppDistributionSetupTests(unittest.TestCase):
    def test_auto_source_selects_exact_current_main_ci_and_only_prepares(self):
        sha = 'a'*40
        plan = dict(sourceCommit=sha, ciRunId=12)
        missing = mock.Mock(returncode=1, stderr='HTTP 404', stdout='')
        with mock.patch.object(source, 'current_main', return_value=sha), mock.patch.object(source, 'gh_json', return_value={'workflow_runs':[{'id':11,'head_sha':'b'*40},{'id':12,'head_sha':sha}]}), mock.patch.object(source, 'select', return_value=plan) as select, mock.patch.object(source.subprocess, 'run', return_value=missing):
            actual, outputs = source.resolve('owner/repo', 'prepare', '1.0.1', automatic=True)
            self.assertEqual(actual, plan)
            self.assertEqual(outputs['skip'], 'false')
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
