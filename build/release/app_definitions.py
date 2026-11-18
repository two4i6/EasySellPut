"""Explicit first-party delivery identities; user inputs never select arbitrary paths or repositories."""
import json
import pathlib
from policy import require

ROOT = pathlib.Path(__file__).resolve().parents[2]
APPS = ('qqq-gex', 'market-liquidity','news-fundamentals')


def definition(app):
    require(app in APPS, 'Unknown first-party app')
    folder = ROOT/'web'/app
    metadata = json.loads((folder/'app.json').read_text())
    expected_id = {'qqq-gex':'easysellput.qqq-gex','market-liquidity':'easysellput.market-liquidity','news-fundamentals':'easysellput.news-fundamentals'}[app]
    require(metadata['id'] == expected_id, 'App delivery identity changed')
    model = json.loads((folder/'source-manifest.json').read_text())['commit'] if app == 'qqq-gex' else ('shared-liquidity-v1' if app=='market-liquidity' else 'shared-news-v1')
    return dict(id=expected_id, version=metadata['version'], model=model)


def catalog_sequence(previous, run_id):
    require(str(run_id).isdigit() and 0 < int(run_id) < 2**53-1, 'Invalid catalog run identity')
    prior = 0 if previous is None else previous.get('sequence')
    require(type(prior) is int and 0 <= prior < 2**53-1 and (previous is None or prior > 0), 'Invalid prior catalog generation')
    sequence = max(int(run_id), prior+1)
    require(0 < sequence < 2**53, 'Catalog generation exhausted')
    return sequence
