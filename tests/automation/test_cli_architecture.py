import pathlib
import struct
import tempfile
import unittest
from check_cli_package import binary_architecture


class CliArchitectureTests(unittest.TestCase):
    def test_windows_distribution_requires_x64_machine_and_supported_rid(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'test-only.exe'
            header=bytearray(64);header[:2]=b'MZ';struct.pack_into('<I',header,60,64)
            path.write_bytes(header+b'PE\0\0'+struct.pack('<H',0x8664))
            binary_architecture(path,'win-x64')
            path.write_bytes(header+b'PE\0\0'+struct.pack('<H',0xAA64))
            for rid in ['win-x64','win-arm64']:
                with self.assertRaises(AssertionError):binary_architecture(path,rid)
