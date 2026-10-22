"""Offline regression tests for logically coherent, no-lookahead lotteries."""
import copy
import unittest

from mzplay_multi import (
    normalize_k3, normalize_5d, normalize_trx, predict_k3, predict_5d,
    predict_trx, walk_forward_validation, MultiGameCollector, GAME_DEFS,
    size_0_9, odd_even, k3_size, k3_sum_range, trx_colour,
)


class FakeClient:
    configured=True
    token='dummy_for_local_tests_only'
    refresh_token=None
    def __init__(self, draws, next_issue):
        self.draws=draws
        self.next_issue=next_issue
    def post(self, path, data):
        if path in [v['history'] for v in GAME_DEFS.values()]:
            return {'data': {'list': self.draws}}
        return {'data': {'issueNumber': self.next_issue}}


class AlgorithmTests(unittest.TestCase):
    def test_server_baccarat_matches_core_road_patterns(self):
        from bot import predict_baccarat_next
        examples = {
            'BBBB': '庄',
            'BBBBP': '观察',
            'BPBPB': '闲',
            'BBPPBB': '闲',
            'BBPPBBP': '闲',
            'BBPPBBPPP': '观察',
            'TTT': '观察',
            'BTPBTB': '观察',
        }
        for chronological, expected in examples.items():
            history = [{'result':{'B':'庄','P':'闲','T':'和'}[code]}
                       for code in reversed(chronological)]
            self.assertEqual(predict_baccarat_next(history), expected, chronological)

    def test_no_fabricated_wingo_number_without_history(self):
        from bot import predict_wingo_next
        state = predict_wingo_next([])
        self.assertIsNone(state['num'])
        self.assertEqual(state['size'], 'PASS')
        self.assertEqual(state['signal'], '观望')

    def test_k3_upstream_wrong_sum_cannot_corrupt_actual(self):
        rows=normalize_k3([{'issueNumber':'2026102201020','premium':'123','sumCount':18}])
        self.assertEqual(rows[0]['sum'],6)
        self.assertEqual(rows[0]['size'],'小')
        self.assertEqual(rows[0]['sumRange'],'3-7')

    def test_5d_upstream_wrong_sum_cannot_corrupt_actual(self):
        rows=normalize_5d([{'issueNumber':'2026102201020','premium':'12345','sumCount':999}])
        self.assertEqual(rows[0]['sum'],15)

    def test_k3_every_output_is_self_consistent(self):
        source=[{'issueNumber':f'2026102201{i:04d}', 'premium': ''.join(str(1+(i+j*j)%6) for j in range(3))}
                for i in range(80)]
        source=normalize_k3(source)
        for i in range(45):
            pred=predict_k3(source[i:])
            self.assertEqual(pred['sum'],sum(pred['dice']))
            self.assertEqual(pred['size'],k3_size(pred['sum']))
            self.assertEqual(pred['oddEven'],odd_even(pred['sum']))
            self.assertEqual(pred['sumRange'],k3_sum_range(pred['sum']))
            self.assertEqual(len(pred['dice']),3)
            self.assertTrue(all(1<=x<=6 for x in pred['dice']))

    def test_5d_every_output_is_self_consistent(self):
        source=[{'issueNumber':f'2026102201{i:04d}', 'premium': ''.join(str((i+j*3)%10) for j in range(5))}
                for i in range(80)]
        source=normalize_5d(source)
        for i in range(45):
            pred=predict_5d(source[i:])
            self.assertEqual(pred['sum'],sum(pred['digits']))
            self.assertEqual(pred['sizeByPosition'],[size_0_9(n) for n in pred['digits']])
            self.assertEqual(pred['oddEvenByPosition'],[odd_even(n) for n in pred['digits']])

    def test_trx_every_output_is_self_consistent(self):
        source=normalize_trx([{'issueNumber':f'2026102201{i:04d}', 'number':(i*7)%10}
                              for i in range(80)])
        for i in range(45):
            pred=predict_trx(source[i:])
            self.assertEqual(pred['size'],size_0_9(pred['number']))
            self.assertEqual(pred['colour'],trx_colour(pred['number']))
        self.assertEqual(trx_colour(0),'红+紫')
        self.assertEqual(trx_colour(5),'绿+紫')

    def test_walk_forward_output_has_sane_bounds(self):
        source=normalize_trx([{'issueNumber':f'2026102201{i:04d}', 'number':(i*7)%10}
                              for i in range(100)])
        result=walk_forward_validation('trx',source)
        self.assertEqual(result['evaluated'],25)
        self.assertGreaterEqual(result['primaryHits'],0)
        self.assertLessEqual(result['primaryHits'],25)
        self.assertGreaterEqual(result['exactHits'],0)
        self.assertLessEqual(result['exactHits'],25)
        self.assertEqual(result['kind'],'walk_forward_prefix_only')

    def test_freezes_prediction_until_target_draw(self):
        client=FakeClient([{'issueNumber':'2026102201001','premium':'123'}], '2026102201002')
        collector=MultiGameCollector(lambda _:None,client=client)
        first=collector.poll_game('k3')
        stored=copy.deepcopy(first['prediction'])
        self.assertEqual(stored['issueNumber'],'2026102201002')
        self.assertEqual(stored['generatedFromLatestIssue'],'2026102201001')
        client.draws=[{'issueNumber':'2026102201001','premium':'666'}]
        collector.poll_game('k3')
        self.assertEqual(collector.states['k3']['prediction'],stored,
                         'must not rewrite previous candidate for same target')
        client.draws=[{'issueNumber':'2026102201002','premium':'456'},
                      {'issueNumber':'2026102201001','premium':'123'}]
        client.next_issue='2026102201003'
        collector.poll_game('k3')
        self.assertEqual(len(collector.states['k3']['reviews']),1)
        self.assertEqual(collector.states['k3']['reviews'][0]['issueNumber'],'2026102201002')
        self.assertEqual(collector.states['k3']['prediction']['issueNumber'],'2026102201003')

    def test_cannot_predict_a_target_already_in_history(self):
        client=FakeClient([{'issueNumber':'2026102201002','premium':'123'}], '2026102201002')
        collector=MultiGameCollector(lambda _:None,client=client)
        state=collector.poll_game('k3')
        self.assertEqual(state['prediction'],{})
        self.assertEqual(state['reviews'],[])

    def test_first_fetch_never_claims_observed_new_issue(self):
        client=FakeClient([{'issueNumber':'2026102201001','premium':'123'}], '2026102201002')
        collector=MultiGameCollector(lambda _:None,client=client)
        state=collector.poll_game('k3')
        self.assertEqual(state.get('last_new_draw_at',0),0)


if __name__=='__main__':
    unittest.main()
