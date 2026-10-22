import json
import importlib.util
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from choice_collector import ChoiceHeadlessCollector
from choice_result_decoder import BAC_FULL_RESULT_LIST
from choice_runtime import ChoiceRuntime, merge_choice


def packet(vid='D051', code=1, seq=1):
    value = (2 << 8) | code
    payload = b'\x0a\x04' + vid.encode('ascii') + b'\x18' + bytes([value & 0x7f]) + b'\x18\x01'
    # Ensure valid packed numbers: use a low value code + pair mask, no upper point bytes.
    payload = b'\x0a\x04' + vid.encode('ascii') + b'\x18' + bytes([code])
    return struct.pack('>III', BAC_FULL_RESULT_LIST, 16 + len(payload), seq) + vid.encode('ascii') + payload


class ChoiceAutoTests(unittest.TestCase):
    def test_websocket_allowlist(self):
        self.assertTrue(ChoiceHeadlessCollector._allow_ws('wss://ng211.mdvuz.com:5000/'))
        self.assertFalse(ChoiceHeadlessCollector._allow_ws('wss://fake-mdvuz.com:5000/'))
        self.assertFalse(ChoiceHeadlessCollector._allow_ws('wss://example.com:5000/'))
        self.assertFalse(ChoiceHeadlessCollector._allow_ws(''))

    def test_decoded_d51_sent_not_other_rooms(self):
        pushed = []
        collector = ChoiceHeadlessCollector(MagicMock(), lambda snap: (pushed.append(snap), True)[1])
        collector._handle_frame(10, packet('D052'))
        self.assertEqual(pushed, [])
        collector._handle_frame(10, packet('D051'))
        self.assertEqual(len(pushed), 1)
        self.assertEqual(pushed[0]['vid'], 'D051')
        self.assertEqual(pushed[0]['results'][0]['result'], 'B')

    def test_snapshot_write_and_change_detection(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            rt = ChoiceRuntime(root/'choice_runtime.json', root/'choice_status.json')
            c = ChoiceHeadlessCollector(MagicMock(), rt.accept_snapshot, rt.set_stage)
            c._handle_frame(10, packet('D051', 1))
            first = json.loads((root/'choice_runtime.json').read_text())
            self.assertEqual(first['lastNewResultAt'], 0)
            self.assertEqual(first['rows'][0]['result'], '庄')
            c._handle_frame(10, packet('D051', 1))
            same = json.loads((root/'choice_runtime.json').read_text())
            self.assertEqual(same['lastNewResultAt'], 0)
            # A one-row overwrite could be a correction. Never mark it new.
            c._handle_frame(10, packet('D051', 2))
            corrected = json.loads((root/'choice_runtime.json').read_text())
            self.assertEqual(corrected['lastNewResultAt'], 0)
            # A longer list with prior tail at the front demonstrates append.
            self.assertTrue(rt.accept_snapshot({'vid':'D051','has_invalid_rows':False,
                'results':[{'result':'P','raw_wininfo':2,'issues':[]},
                           {'result':'T','raw_wininfo':4,'issues':[]}]}))
            changed = json.loads((root/'choice_runtime.json').read_text())
            self.assertGreater(changed['lastNewResultAt'], 0)
            self.assertEqual(changed['rows'][0]['result'], '和')
            self.assertEqual(json.loads((root/'choice_status.json').read_text())['stage'], 'd51_snapshot_received')
            for secret in ('Bearer', 'token', 'refreshToken', 'gci.arvideo'):
                self.assertNotIn(secret, (root/'choice_status.json').read_text())

    def test_invalid_room_rows_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            rt = ChoiceRuntime(Path(d)/'runtime.json', Path(d)/'status.json')
            self.assertFalse(rt.accept_snapshot({'vid':'D052','results':[{'result':'B','raw_wininfo':1}]}))
            self.assertFalse(rt.accept_snapshot({'vid':'D051','results':[{'result':None,'raw_wininfo':5}]}))
            self.assertFalse((Path(d)/'runtime.json').exists())

    def test_merge_preserves_other_games(self):
        import time
        now = int(time.time())
        base = {'wingo': {'draws':[1]}, 'k3':{'draws':[2]}, 'baccarat':{'rooms':{'D52':[{'result':'闲'}]}}}
        runtime = {'room':'D51','lastSnapshotAt':now,'rows':[{'room':'D51','result':'庄','game':1}], 'lastNewResultAt':0}
        result = merge_choice(base, runtime)
        self.assertEqual(result['k3'], base['k3'])
        self.assertEqual(result['baccarat']['rooms']['D52'], base['baccarat']['rooms']['D52'])
        self.assertEqual(result['baccarat']['rooms']['D51'][0]['result'], '庄')
        self.assertEqual(base['baccarat']['rooms'].keys(), {'D52'})
        self.assertNotIn('D51', merge_choice(base, {**runtime, 'lastSnapshotAt':now+600})['baccarat']['rooms'])

    @unittest.skipUnless(importlib.util.find_spec('flask'), 'Flask not available in offline test environment')
    def test_api_surfaces_clean_choice_snapshot_and_status(self):
        from unittest.mock import patch
        import realtime_api as api
        import time
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root/'data.json').write_text(json.dumps({
                'updated_at': int(time.time()),
                'wingo': {'draws': [{'number': 2}]},
                'baccarat': {'rooms': {}}
            }))
            rt = ChoiceRuntime(root/'choice_runtime.json', root/'choice_status.json')
            rt.accept_snapshot({'vid':'D051','has_invalid_rows':False,
                                'results':[{'result':'B','raw_wininfo':1,'issues':[]}]})
            rt.set_stage('d51_snapshot_received')
            with patch.object(api, 'BASE_DIR', root), patch.object(api, 'DATA_FILE', root/'data.json'), \
                 patch.object(api, 'MULTI_RUNTIME_FILE', root/'multi_runtime.json'):
                with api.app.test_client() as web:
                    data = web.get('/api/data').json
                    status = web.get('/api/choice-status').json
                    connection = web.get('/api/connection-status').json
            self.assertEqual(data['wingo']['draws'][0]['number'], 2)
            self.assertEqual(data['baccarat']['rooms']['D51'][0]['result'], '庄')
            self.assertEqual(status['stage'], 'd51_snapshot_received')
            self.assertEqual(connection['choiceRoom']['room'], 'D51')
            self.assertNotIn('token', json.dumps(status).lower())

    def test_no_credentials_or_bets_in_collector(self):
        source = Path(__file__).with_name('choice_collector.py').read_text()
        self.assertIn('get_choice_launch_url()', source)
        self.assertNotIn('build_subscribe_packet(', source)
        self.assertNotIn('place_bet(', source)
        self.assertNotIn('localStorage.setItem', source)


if __name__ == '__main__':
    unittest.main()
