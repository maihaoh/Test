"""Offline-only safety and protocol sanity checks for reviewed V14."""
import json
import os
import struct
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import direct_choice_render as d
# The test environment may lack Flask. Its route handler can still be unit
# tested with a tiny decorator/jsonify stub; this does not test HTTP serving.
try:
    import realtime_api
    REAL_FLASK = True
except ModuleNotFoundError as exc:
    if exc.name != 'flask':
        raise
    import sys, types
    class StubFlask:
        def __init__(self, name): self.config = {}
        def after_request(self, handler): return handler
        def get(self, *a, **k): return lambda fn: fn
        def post(self, *a, **k): return lambda fn: fn
    fake = types.ModuleType('flask')
    fake.Flask = StubFlask
    fake.jsonify = lambda obj: obj
    fake.request = types.SimpleNamespace(headers={}, get_json=lambda **k: {})
    with mock.patch.dict(sys.modules, {'flask': fake}):
        import realtime_api
    REAL_FLASK = False
from choice_result_decoder import DecodeError, PacketAssembler, DEFAULT_VIDS


class FakeWs:
    keep_running = True
    def __init__(self):
        self.sent = []
        self.closed = False
    def send(self, data, opcode=None):
        self.sent.append(bytes(data))
    def close(self):
        self.closed = True
        self.keep_running = False


class ProtocolReviewTests(unittest.TestCase):
    def test_heartbeat_packet_bytes(self):
        self.assertEqual(d.build_app_heartbeat(0), struct.pack('>III', 1, 12, 0))
        self.assertEqual(d.build_app_heartbeat(17), struct.pack('>III', 1, 12, 17))
        with self.assertRaises(ValueError):
            d.build_app_heartbeat(-1)
        with self.assertRaises(ValueError):
            d.build_app_heartbeat(True)

    def test_subscribe_ack_zero_and_nonzero(self):
        packet = struct.pack('>IIIII', 143365, 28, 0, 0, 2) + b'D051D052'
        self.assertEqual(d.parse_subscribe_ack(packet)['vids'][1]['vid'], 'D052')
        self.assertEqual(d.parse_subscribe_ack(packet)['retCode'], 0)
        reject = struct.pack('>IIIII', 143365, 20, 0, 9, 0)
        self.assertEqual(d.parse_subscribe_ack(reject)['retCode'], 9)

    def test_subscribe_ack_group_and_invalid_count(self):
        packet = struct.pack('>IIIII', 143365, 25, 2, 0, 1) + b'\x02D051'
        ack = d.parse_subscribe_ack(packet)
        self.assertEqual(ack['seqNo'], 2)
        self.assertEqual(ack['vids'], [{'vid':'D051', 'group':2}])
        bad = struct.pack('>IIIII', 143365, 20, 0, 0, 5000)
        with self.assertRaises(DecodeError):
            d.parse_subscribe_ack(bad)

    def test_observer_startup_sends_no_unverified_packets(self):
        ws = FakeWs()
        c = d.DirectChoiceCollector()
        with mock.patch.object(d.threading.Thread, 'start'):
            with mock.patch.object(c, '_write_status') as write_status:
                c.on_open(ws)
        write_status.assert_any_call('awaiting_authorized_game_bootstrap')
        # V15 explicitly removed the fabricated heartbeat, the premature
        # unauthenticated 77829 subscription and the absent 77826 login.
        self.assertEqual(ws.sent, [])
        self.assertFalse(c.subscription_sent)
        self.assertFalse(c.login_ack_seen)
        c.on_close(ws, None, None)

    def test_receives_ack_as_rejection_not_success(self):
        c = d.DirectChoiceCollector()
        ws = FakeWs()
        with mock.patch.object(c, '_write_status'):
            reject = struct.pack('>IIIII', 143365, 20, 0, 4, 0)
            c.on_message(ws, reject)
        self.assertTrue(c.ack_seen)
        self.assertFalse(c.ack_ok)
        self.assertTrue(c.ack_rejected)
        self.assertEqual(c.rx_frames, 1)
        self.assertEqual(c.rx_bytes, len(reject))

    def test_no_raw_content_written_to_diagnostic_status(self):
        c = d.DirectChoiceCollector()
        with tempfile.TemporaryDirectory() as td:
            with mock.patch.object(d, 'STATUS_PATH', Path(td)/'choice_status.json'):
                c._write_status('waiting_for_subscription_ack')
                state = json.loads((Path(td)/'choice_status.json').read_text())
        self.assertFalse(state['game_login_request_sent'])
        self.assertNotIn('frame_hex', state)
        self.assertEqual(state['received_frames'], 0)

    def test_realtime_api_exposes_safe_status(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'choice_status.json';p.write_text(json.dumps({'status':'awaiting_authorized_game_login','received_frames':0}))
            with mock.patch.object(realtime_api, 'BASE_DIR', Path(td)):
                if REAL_FLASK:
                    r = realtime_api.app.test_client().get('/api/choice-status')
                    self.assertEqual(r.status_code, 200)
                    self.assertEqual(r.get_json()['received_frames'], 0)
                else:
                    # In a minimal offline environment validate the handler body.
                    state = realtime_api.choice_status()
                    self.assertEqual(state['received_frames'], 0)

    def test_bounded_unauth_probes_park_and_leave_app_running(self):
        c = d.DirectChoiceCollector()
        attempts = []
        def mocked_run_once():
            attempts.append(1)
            c.ack_seen=False
            c.ack_ok=False
        with mock.patch.object(c, 'run_once', mocked_run_once), mock.patch.object(c, '_write_status'):
            with mock.patch.object(d, 'MAX_UNACKED_ATTEMPTS', 2), mock.patch.object(d.time, 'sleep'):
                with mock.patch.object(d.threading.Event, 'wait', side_effect=RuntimeError('parked')):
                    with self.assertRaisesRegex(RuntimeError, 'parked'):
                        c.run_forever()
        self.assertEqual(len(attempts), 2)

    def test_partial_app_frame_assembler(self):
        payload = struct.pack('>III', 1, 12, 5)
        assembler = PacketAssembler()
        self.assertEqual(assembler.feed(payload[:5]), [])
        self.assertEqual(assembler.feed(payload[5:]), [payload])


    def test_realtime_api_rejects_empty_partial_and_future_snapshots(self):
        now = int(__import__('time').time())
        normal = {'updated_at': now, 'wingo': {'draws': [{'issueNumber': '20261021111'}]},
                  'baccarat': {'rooms': {'D51': [], 'D52': []}}}
        self.assertTrue(realtime_api._valid_snapshot(normal))
        self.assertFalse(realtime_api._valid_snapshot({'updated_at': now, 'wingo': {}}))
        self.assertFalse(realtime_api._valid_snapshot({'updated_at': now, 'wingo': {'draws': []},
            'baccarat': {'rooms': {'D51': []}}}))
        self.assertFalse(realtime_api._valid_snapshot({**normal, 'updated_at': now + 3600}))
        self.assertFalse(realtime_api._valid_snapshot({**normal, '5d': {'draws': 'not a list'}}))

    def test_corrupt_server_json_has_503_health_not_false_success(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'data.json'
            path.write_text('{unparseable', encoding='utf-8')
            with mock.patch.object(realtime_api, 'DATA_FILE', path), \
                 mock.patch.object(realtime_api, 'MULTI_RUNTIME_FILE', Path(td) / 'absent.json'):
                self.assertIn('error', realtime_api.read_data())
                if REAL_FLASK:
                    health = realtime_api.app.test_client().get('/health')
                    self.assertEqual(health.status_code, 503)
                    self.assertFalse(health.get_json()['ok'])
                else:
                    body, code = realtime_api.health()
                    self.assertEqual(code, 503)
                    self.assertFalse(body['ok'])


if __name__=='__main__':
    unittest.main()
