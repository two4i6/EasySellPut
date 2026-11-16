#!/usr/bin/env python3
"""Exercise production cache maintenance and CLI/MCP shared SQLite without network access."""
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
        assert [c['id'] for c in status['caches']] == ['responses', 'bars']
        assert 'iv_samples' in status['protectedData']
        protected = {'settings.json': b'{"language":"en-US"}', 'strategies.json': b'[]', 'drawings.json': b'{"fixture":"unchanged"}'}
        for name, body in protected.items():
            (root / name).write_bytes(body)
        with sqlite3.connect(root / 'cache/market.db') as db:
            for symbol in ('AAPL', 'MSFT'):
                db.execute('INSERT INTO bars VALUES (?,?,?,?,?,?,?,?,?,?)', (symbol, 'Day1', '', 1, 1, 2, .5, 1.5, 10, 0))
                db.execute('INSERT INTO bar_meta (symbol,interval,adjust,source,fetched_at,realtime,basis) VALUES (?,?,?,?,?,?,?)', (symbol, 'Day1', '', 'fixture', 1, 0, 'Split'))
            db.execute('INSERT INTO iv_samples VALUES (?,?,?,?,?)', ('AAPL', 1, 'ATM', .25, 'fixture'))
            db.execute('INSERT INTO oi_daily VALUES (?,?,?,?)', ('AAPL', 20261101, 'contract', 100))
        run(command, data, 'cache', 'clear', '--category', 'all', '--mode', 'expired')
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
        with sqlite3.connect(root / 'cache/market.db') as db:
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
