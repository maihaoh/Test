"""Offline regressions for real-result freshness and snapshot precedence."""
import time
import unittest
from unittest import mock

import mzplay_multi as m
from multi_snapshot import merge_snapshots


class FakeClient:
    def post(self, path, payload):
        return {}


class MultiFreshnessTests(unittest.TestCase):
    def test_repeated_poll_does_not_refresh_time_of_last_new_draw(self):
        collector = m.MultiGameCollector(lambda state: None, client=FakeClient())
        draws = [{'issueNumber': '202610210001', 'dice': [1, 2, 3]}]
        with mock.patch.object(m, 'extract_list', return_value=[]), \
             mock.patch.object(m, 'extract_issue', return_value={'issueNumber':'202610210002'}), \
             mock.patch.object(collector, '_normalize', side_effect=lambda g, _: list(draws)), \
             mock.patch.object(collector, '_predict', return_value={'dice':[1,2,3]}):
            with mock.patch.object(m.time, 'time', return_value=1000):
                first = collector.poll_game('k3')
            self.assertEqual(first['last_new_draw_at'], 0)
            with mock.patch.object(m.time, 'time', return_value=1050):
                second = collector.poll_game('k3')
            self.assertEqual(second['last_new_draw_at'], 0)
            self.assertEqual(second['last_success_at'], 1050)
            self.assertIn('等待下一期',second['status'])
            draws[0] = {'issueNumber': '202610210002', 'dice':[3,4,5]}
            with mock.patch.object(m.time, 'time', return_value=1065):
                third = collector.poll_game('k3')
            self.assertEqual(third['last_new_draw_at'],1065)
            self.assertIn('新的有效',third['status'])
            draws.clear()
            with mock.patch.object(m.time, 'time', return_value=1100):
                empty = collector.poll_game('k3')
            self.assertEqual(empty['last_new_draw_at'],1065)
            self.assertEqual(empty['last_success_at'],1065)

    def test_newer_runtime_success_wins_and_future_timestamp_is_ignored(self):
        now=int(time.time())
        base={'k3': {'last_success_at':now-50, 'draws':[{'issueNumber':'old'}]},'wingo': {'prediction':{}}}
        good={'k3': {'last_success_at':now-25, 'last_new_draw_at':now-40,
                     'draws':[{'issueNumber':'new'}]}}
        merged=merge_snapshots(base,good)
        self.assertEqual(merged['k3']['draws'][0]['issueNumber'],'new')
        self.assertEqual(merged['wingo'], base['wingo'])
        corrupted={'k3': {'last_success_at':now+86400, 'draws':[{'issueNumber':'future'}]}}
        self.assertEqual(merge_snapshots(base,corrupted)['k3']['draws'][0]['issueNumber'],'old')

    def test_stale_failed_attempt_cannot_refresh_last_success(self):
        now=int(time.time())
        base={'trx':{'last_success_at':now-500, 'draws':[{'issueNumber':'old'}]}}
        runtime={'trx': {'last_attempt_at':now-5,'status':'网络暂时不可用', 'draws':[]}}
        merged=merge_snapshots(base,runtime)
        self.assertEqual(merged['trx']['last_success_at'],now-500)
        self.assertEqual(merged['trx']['status'],'网络暂时不可用')


if __name__ == '__main__':
    unittest.main()
