#!/usr/bin/env python3
"""Exercise production cache maintenance and CLI/MCP shared SQLite without network access."""
from contextlib import closing
import argparse
import json
import pathlib
import sqlite3
import tempfile
from cli_mcp_smoke import Mcp, run


def check_cache(command):
    with tempfile.TemporaryDirectory(prefix='EasySellPut cache safety ') as data:
        root = pathlib.Path(data)
        status = run(command, data, 'cache', 'status')['data']
        assert [c['id'] for c in status['caches']] == ['responses', 'bars', 'qqq_gex_wire']
        assert 'iv_samples' in status['protectedData']
        assert {'qqq_gex_live_signals','qqq_gex_pcs_lifecycle','qqq_gex_view_preferences'} <= set(status['protectedData'])
        protected = {'settings.json': b'{"language":"en-US"}', 'strategies.json': b'[]', 'qqq-gex-view.json': b'{"qqq-local:mode":"history"}', 'drawings.json': b'{"fixture":"unchanged"}'}
        for name, body in protected.items():
            (root / name).write_bytes(body)
        with closing(sqlite3.connect(root / 'cache/market.db')) as db, db:
            for symbol in ('AAPL', 'MSFT'):
                db.execute('INSERT INTO bars VALUES (?,?,?,?,?,?,?,?,?,?)', (symbol, 'Day1', '', 1, 1, 2, .5, 1.5, 10, 0))
                db.execute('INSERT INTO bar_meta (symbol,interval,adjust,source,fetched_at,realtime,basis) VALUES (?,?,?,?,?,?,?)', (symbol, 'Day1', '', 'fixture', 1, 0, 'Split'))
            db.execute('INSERT INTO iv_samples VALUES (?,?,?,?,?)', ('AAPL', 1, 'ATM', .25, 'fixture'))
            db.execute('INSERT INTO oi_daily VALUES (?,?,?,?)', ('AAPL', 20261101, 'contract', 100))
        with closing(sqlite3.connect(root / 'cache/qqq-gex.db')) as db, db:
            db.execute('CREATE TABLE qqq_gex_observed_inputs(identity TEXT PRIMARY KEY, body TEXT)')
            db.execute('INSERT INTO qqq_gex_observed_inputs VALUES (?,?)', ('retained', 'original observation'))
            for table in ('qqq_gex_live_signals','qqq_gex_pcs_lifecycle'):
                db.execute(f'CREATE TABLE {table}(body TEXT)')
                db.execute(f'INSERT INTO {table} VALUES (?)', ('retained source observation',))
            db.execute('INSERT INTO qqq_gex_wire VALUES (?,?,?,?,?,?,?,?)', ('local','fixture','application/json','{}','r1',1,2,'fixture'))
        run(command, data, 'cache', 'clear', '--category', 'all', '--mode', 'expired')
        with closing(sqlite3.connect(root / 'cache/qqq-gex.db')) as db:
            assert db.execute('SELECT body FROM qqq_gex_observed_inputs').fetchone()[0] == 'original observation'
            assert db.execute('SELECT COUNT(*) FROM qqq_gex_wire').fetchone()[0] == 0
            for table in ('qqq_gex_live_signals','qqq_gex_pcs_lifecycle'):
                assert db.execute(f'SELECT body FROM {table}').fetchone()[0] == 'retained source observation'
            assert db.execute('SELECT generation FROM qqq_gex_cache_meta').fetchone()[0] == 1
        assert run(command, data, 'cache', 'status')['data']['caches'][1]['entries'] == 2
        reader = Mcp(command, data)
        try:
            tools = reader.request('tools/list', {})['result']['tools']
            assert 'clear_cache' not in {t['name'] for t in tools}
            assert reader.call('clear_cache', {'category': 'bars'}).get('isError')
            assert reader.call('get_cache_status', {})['structuredContent']['data']['caches'][1]['entries'] == 2
            run(command, data, 'cache', 'clear', '--category', 'bars', '--symbol', 'aapl')
            assert reader.call('get_cache_status', {})['structuredContent']['data']['caches'][1]['entries'] == 1
        finally:
            reader.close()
        writer = Mcp(command, data, writes=True)
        try:
            result = writer.call('clear_cache', {'category': 'bars'})
            assert result['structuredContent']['data'][0]['removed'] == 1, result
        finally:
            writer.close()
        with closing(sqlite3.connect(root / 'cache/market.db')) as db, db:
            assert db.execute('SELECT COUNT(*) FROM bars').fetchone()[0] == 0
            assert db.execute('SELECT COUNT(*) FROM bar_meta').fetchone()[0] == 0
            assert db.execute('SELECT iv FROM iv_samples').fetchone()[0] == .25
            assert db.execute('SELECT oi FROM oi_daily').fetchone()[0] == 100
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        for name, body in protected.items():
            assert (root / name).read_bytes() == body
    print('PASS: production cache CLI aliases, read-only MCP, long-lived MCP reload, shared SQLite, expired/symbol/all clearing and IV/OI/user-data preservation')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dll', default='src/Meili.Cli/bin/Release/net10.0/easysellput.dll')
    parser.add_argument('--executable')
    args = parser.parse_args()
    check_cache([args.executable] if args.executable else ['dotnet', args.dll])
