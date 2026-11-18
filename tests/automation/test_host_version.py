import importlib.util
import pathlib
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]/'build/release'))

spec = importlib.util.spec_from_file_location('host_version', pathlib.Path(__file__).resolve().parents[2]/'build/release/host-version.py')
version = importlib.util.module_from_spec(spec)
spec.loader.exec_module(version)


class HostVersionTests(unittest.TestCase):
    def test_new_version_and_published_version(self):
        with mock.patch.object(version.subprocess, 'run', return_value=mock.Mock(returncode=1, stderr='HTTP 404')):
            self.assertFalse(version.inspect_version('owner/repo', '1.2.3'))
        with mock.patch.object(version.subprocess, 'run', return_value=mock.Mock(returncode=0, stdout='{"draft":false}')):
            self.assertTrue(version.inspect_version('owner/repo', '1.2.3'))

    def test_existing_draft_and_api_failure_stop_release(self):
        for result in [mock.Mock(returncode=0, stdout='{"draft":true}'), mock.Mock(returncode=1, stderr='HTTP 403')]:
            with mock.patch.object(version.subprocess, 'run', return_value=result), self.assertRaises(ValueError):
                version.inspect_version('owner/repo', '1.2.3')
        with self.assertRaises(ValueError):
            version.inspect_version('owner/repo', '../unsafe')
