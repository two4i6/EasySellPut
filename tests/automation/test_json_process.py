import shutil
import subprocess
import unittest
from unittest.mock import patch
from json_process import run_node_json


class NodeJsonTests(unittest.TestCase):
    def test_real_node_string_output_is_utf8(self):
        node = shutil.which('node')
        if not node:
            self.skipTest('Node runtime unavailable')
        command = [node, '-e', 'console.log(JSON.stringify({text:"中文行情"}))']
        raw = subprocess.run(command, capture_output=True, check=True).stdout
        self.assertIn('中文行情'.encode('utf-8'), raw)
        self.assertEqual(run_node_json(command), {'text': '中文行情'})

    def test_invalid_json_encoding_is_rejected(self):
        with patch('json_process.subprocess.run', return_value=subprocess.CompletedProcess([], 0, b'{"text":"\xff"}', b'\xff')):
            with self.assertRaises(UnicodeDecodeError):
                run_node_json(['fixture'])

    def test_native_stderr_is_preserved_in_failure_diagnostics(self):
        with patch('json_process.subprocess.run', return_value=subprocess.CompletedProcess([], 1, b'', b'native error: \xff')):
            with self.assertRaisesRegex(AssertionError, 'native error:') as raised:
                run_node_json(['fixture'])
            self.assertIn('\\xff', str(raised.exception))
