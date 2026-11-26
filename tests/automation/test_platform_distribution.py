import hashlib
import importlib.util
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('platform_packages', ROOT/'build/release/sign-packages.py')
packages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packages)


class PlatformDistributionTests(unittest.TestCase):
    def test_explicit_no_publisher_signing_preserves_tested_bytes_for_every_target(self):
        for rid in ('win-x64', 'osx-x64', 'osx-arm64', 'linux-x64'):
            with self.subTest(rid=rid), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                names = [f'EasySellPut-CLI-1.0.0-{rid}' + ('.zip' if rid == 'win-x64' else '.tar.gz')]
                if rid != 'linux-x64':names.append(f'EasySellPut-Desktop-1.0.0-{rid}.zip')
                for name in names:
                    payload = ('test fixture '+name).encode()
                    (root/name).write_bytes(payload)
                    (root/(name+'.sha256')).write_text(hashlib.sha256(payload).hexdigest()+'  '+name+'\n')
                output = root/'output'
                argv = ['sign-packages.py','--packages',str(root),'--output',str(output),'--rid',rid,'--version','1.0.0','--platform-signing','none']
                with mock.patch.dict('os.environ', {'GITHUB_REF':'refs/heads/main'}), mock.patch.object(sys,'argv',argv), mock.patch.object(packages,'sign_mac') as mac, mock.patch.object(packages,'sign_windows') as windows:
                    packages.main()
                    mac.assert_not_called();windows.assert_not_called()
                for name in names:
                    self.assertEqual((output/name).read_bytes(),(root/name).read_bytes())
                    self.assertEqual((output/(name+'.sha256')).read_bytes(),(root/(name+'.sha256')).read_bytes())

    def test_no_publisher_mode_still_rejects_corrupt_packages_and_non_main(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            name='EasySellPut-CLI-1.0.0-linux-x64.tar.gz'
            (root/name).write_bytes(b'changed')
            (root/(name+'.sha256')).write_text('0'*64+'  '+name+'\n')
            argv=['sign-packages.py','--packages',str(root),'--output',str(root/'out'),'--rid','linux-x64','--version','1.0.0','--platform-signing','none']
            for branch, error in [('work','restricted to main'),('main','checksum mismatch')]:
                with mock.patch.dict('os.environ',{'GITHUB_REF':'refs/heads/'+branch}), mock.patch.object(sys,'argv',argv), self.assertRaisesRegex(ValueError,error):
                    packages.main()
