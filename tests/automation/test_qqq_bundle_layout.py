"""Bundle placement test only; Apple codesign validation still runs on native CI."""
import importlib.util
import pathlib
import tempfile
import unittest

class QqqBundleLayoutTests(unittest.TestCase):
    def test_runtime_archives_are_resources_and_keep_original_bytes(self):
        root = pathlib.Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location('qqq_bundle', root / 'build/mac/bundle.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            publish = base / 'publish'
            (publish / 'runtime').mkdir(parents=True)
            (publish / 'MeiliMac').write_bytes(b'test apphost')
            (publish / 'runtime/node.tar.gz').write_bytes(b'original archive bytes')
            icon = base / 'icon.icns'
            icon.write_bytes(b'test icon')
            app = base / 'EasySellPut.app'
            module.make_app(str(publish), str(app), 'test', str(icon))
            self.assertFalse((app / 'Contents/MacOS/runtime').exists())
            self.assertEqual((app / 'Contents/Resources/runtime/node.tar.gz').read_bytes(), b'original archive bytes')
