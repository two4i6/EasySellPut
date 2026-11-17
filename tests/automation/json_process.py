"""Read Node JSON stdout strictly as UTF-8, independently of the host locale."""
import json
import subprocess


def run_node_json(command, timeout=120):
    result = subprocess.run(command, capture_output=True, timeout=timeout)
    # Diagnostics may contain native/runtime bytes; never apply lossy decoding to JSON.
    diagnostics = result.stderr.decode('utf-8', errors='backslashreplace')
    assert result.returncode == 0, (command, result.returncode, diagnostics)
    return json.loads(result.stdout.decode('utf-8'))
