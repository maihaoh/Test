"""V37 tests: server-only orchestration, safe persistence and truthful status."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from choice_archive import ChoiceSnapshotArchive
from choice_collector import ChoiceHeadlessCollector
from choice_runtime import ChoiceRuntime


def snapshot(values):
    names = {1: 'B', 2: 'P', 4: 'T'}
    return {
        'vid': 'D051', 'has_invalid_rows': False,
        'results': [{'raw_wininfo': v, 'result': names[v], 'issues': [],
                     'bankerPair': False, 'playerPair': False} for v in values]
    }


class V37Tests(unittest.TestCase):
    def test_archive_dedup_and_latest(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = ChoiceSnapshotArchive(Path(folder)/'archive.sqlite3')
            rows = [{'room': 'D51', 'result': '庄', 'raw_wininfo': 1}]
            self.assertTrue(archive.record('digest1', 100, rows))
            self.assertFalse(archive.record('digest1', 101, rows))
            self.assertEqual(archive.count(), 1)
            self.assertTrue(archive.record('digest2', 102, rows))
            self.assertEqual(archive.latest()['digest'], 'digest2')
            self.assertEqual(archive.count(), 2)

    def test_archive_limits_unique_snapshots(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = ChoiceSnapshotArchive(Path(folder)/'archive.sqlite3', limit=100)
            for i in range(115):
                archive.record(f'd{i}', 100+i, [{'room': 'D51', 'result': '闲'}])
            self.assertEqual(archive.count(), 100)
            self.assertEqual(archive.latest()['digest'], 'd114')

    def test_runtime_archives_distinct_not_repeats(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            runtime = ChoiceRuntime(root/'choice_runtime.json', root/'choice_status.json')
            self.assertTrue(runtime.accept_snapshot(snapshot([1, 2, 1, 4])))
            self.assertTrue(runtime.accept_snapshot(snapshot([1, 2, 1, 4])))
            status = json.loads((root/'choice_status.json').read_text())
            self.assertEqual(status['snapshotCount'], 2)
            self.assertEqual(status['archiveSnapshots'], 1)
            self.assertEqual(status['lastNewResultAt'], 0)
            self.assertEqual(status['storageMode'], 'instance_local_ephemeral')
            self.assertTrue(runtime.accept_snapshot(snapshot([1, 2, 1, 4, 2])))
            status = json.loads((root/'choice_status.json').read_text())
            self.assertEqual(status['archiveSnapshots'], 2)
            self.assertGreater(status['lastNewResultAt'], 0)
            self.assertEqual(json.loads((root/'choice_runtime.json').read_text())['rows'][0]['result'], '闲')

    def test_unrelated_long_roadmap_does_not_fabricate_new_round(self):
        # Long snapshots with only a one-symbol overlap are NOT evidence of append.
        a = [1,2,1,4]*10
        b = [4] + [2]*42
        self.assertFalse(ChoiceRuntime._observed_append(a, b))
        self.assertTrue(ChoiceRuntime._observed_append(a, a[1:] + [2]))

    def test_restart_recovers_existing_local_archive_without_freshness_claim(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            rt = ChoiceRuntime(root/'choice_runtime.json', root/'choice_status.json')
            rt.accept_snapshot(snapshot([1, 2, 4]))
            (root/'choice_runtime.json').unlink()
            restored = ChoiceRuntime(root/'choice_runtime.json', root/'choice_status.json')
            self.assertEqual(restored._records, 3)
            data = json.loads((root/'choice_runtime.json').read_text())
            self.assertEqual(data['rows'][0]['result'], '和')
            self.assertEqual(data['lastNewResultAt'], 0)

    def test_access_denial_backs_off_without_token_probing(self):
        collector = ChoiceHeadlessCollector(MagicMock(), lambda _: True)
        waits = [collector._retry_wait(0, 'provider_access_blocked') for _ in range(5)]
        self.assertEqual(waits, [300, 600, 1200, 2400, 3600])
        self.assertEqual(collector._retry_wait(60, 'choice_websocket_not_seen'), 60)
        self.assertEqual(collector._consecutive_access_blocks, 0)

    def test_retry_status_is_categorical_and_has_no_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            rt=ChoiceRuntime(root/'data.json',root/'status.json')
            rt.set_stage('provider_access_blocked')
            rt.set_retry(300, 1)
            raw=(root/'status.json').read_text()
            status=json.loads(raw)
            self.assertEqual(status['release'], 'V37')
            self.assertEqual(status['consecutiveAccessBlocks'], 1)
            self.assertGreater(status['nextRetryAt'], status['updatedAt'])
            for forbidden in ['Authorization', 'Bearer', 'refreshToken', 'forwardGame.do?', 'Cookie:']:
                self.assertNotIn(forbidden, raw)

    def test_ui_server_first_not_console_flow(self):
        html=Path(__file__).with_name('index.html').read_text()
        self.assertIn('UI V37', html)
        self.assertIn('id="choice-room-server-detail"', html)
        self.assertNotIn('复制 Console 代码', html)
        self.assertNotIn('F12 → Console → Ctrl+V', html)
        js=Path(__file__).with_name('choice_live.js').read_text()
        self.assertIn('/api/choice-status', js)
        self.assertIn('provider_access_blocked', js)

    def test_no_trading_commands_on_server_choice_path(self):
        code=Path(__file__).with_name('choice_collector.py').read_text()
        self.assertNotIn('place_bet(', code)
        self.assertNotIn('build_subscribe_packet(', code)
        self.assertIn('get_choice_launch_url()', code)

if __name__ == '__main__':
    unittest.main()
