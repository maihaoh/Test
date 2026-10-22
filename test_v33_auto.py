"""Offline regression tests for V33 browser observation and privacy guards."""
import base64
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from choice_collector import ChoiceHeadlessCollector
from choice_result_decoder import BAC_FULL_RESULT_LIST
from choice_runtime import ChoiceRuntime


def result_packet(vid='D051', wininfo=1):
    if not 0 < wininfo < 128:
        raise ValueError('fixture only supports one-byte sample outcome')
    proto = b'\x0a\x04' + vid.encode() + b'\x18' + bytes([wininfo])
    return struct.pack('>III', BAC_FULL_RESULT_LIST, 16 + len(proto), 1) + vid.encode() + proto


class FakeCDP:
    def __init__(self):
        self.events = {}

    def send(self, command):
        assert command == 'Network.enable'

    def on(self, name, handler):
        self.events[name] = handler

    def emit(self, name, event):
        self.events[name](event)


class FakeContext:
    def __init__(self):
        self.session = FakeCDP()

    def new_cdp_session(self, _page):
        return self.session


class V33Tests(unittest.TestCase):
    def test_cdp_observes_bac_result_and_keeps_secret_out_of_diagnostics(self):
        snap = []
        collector = ChoiceHeadlessCollector(MagicMock(), lambda s: (snap.append(s), True)[1])
        ctx = FakeContext()
        collector._attach_cdp(ctx, object())
        secret = 'PRIVATE_SESSION_TICKET_DO_NOT_LOG'
        socket_url = f'wss://ng211.mdvuz.com:5000/?ticket={secret}'
        cdp = ctx.session
        cdp.emit('Network.webSocketCreated', {'requestId': '1', 'url': socket_url})
        cdp.emit('Network.webSocketHandshakeResponseReceived',
                 {'requestId': '1', 'response': {'status': 101}})
        cdp.emit('Network.webSocketFrameReceived', {'requestId': '1',
                 'response': {'opcode': 2,
                              'payloadData': base64.b64encode(result_packet()).decode()}})
        self.assertEqual(len(snap), 1)
        self.assertEqual(snap[0]['vid'], 'D051')
        self.assertEqual(snap[0]['results'][0]['result'], 'B')
        diagnostic = collector._diagnostics()
        self.assertEqual(diagnostic['webSocketHandshakes'], 1)
        self.assertEqual(diagnostic['webSocketFrames'], 1)
        self.assertEqual(diagnostic['webSocketPorts'], [5000])
        self.assertNotIn(secret, json.dumps(diagnostic))
        self.assertNotIn('wss://', json.dumps(diagnostic))
        collector._game_page_seen = True
        self.assertEqual(collector._timeout_reason(), 'd51_result_not_seen')

    def test_cdp_does_not_duplicate_playwright_frames(self):
        snap = []
        collector = ChoiceHeadlessCollector(MagicMock(), lambda s: (snap.append(s), True)[1])
        ctx = FakeContext()
        collector._attach_cdp(ctx, object())
        ctx.session.emit('Network.webSocketCreated',
                         {'requestId': 'one', 'url': 'wss://ng211.mdvuz.com:5000/'})
        collector._playwright_ports.add(5000)
        ctx.session.emit('Network.webSocketFrameReceived', {'requestId': 'one',
                         'response': {'opcode': 2,
                                      'payloadData': base64.b64encode(result_packet()).decode()}})
        self.assertFalse(snap)
        collector._handle_frame(('pw', 10), result_packet())
        self.assertEqual(len(snap), 1)

    def test_timeout_categorization_is_grounded(self):
        c = ChoiceHeadlessCollector(MagicMock(), lambda _: True)
        self.assertEqual(c._timeout_reason(), 'choice_game_not_loaded')
        c._game_page_seen = True
        self.assertEqual(c._timeout_reason(), 'choice_websocket_not_seen')
        c._counters['otherWebSockets'] = 1
        self.assertEqual(c._timeout_reason(), 'choice_ws_endpoint_unrecognized')
        c._counters['webSocketHandshakeFailures'] = 1
        self.assertEqual(c._timeout_reason(), 'choice_ws_handshake_failed')
        c._counters['webSocketHandshakeFailures'] = 0
        c.status.websocket_seen = True
        self.assertEqual(c._timeout_reason(), 'choice_ws_handshake_unconfirmed')
        c._counters['webSocketHandshakes'] = 1
        self.assertEqual(c._timeout_reason(), 'd51_result_not_seen')

    def test_public_diagnostics_accept_only_allowlisted_data(self):
        with tempfile.TemporaryDirectory() as d:
            rt = ChoiceRuntime(Path(d) / 'runtime.json', Path(d) / 'status.json')
            rt.update_diagnostics({
                'providerWebSockets': 3,
                'gamePageSeen': True,
                'webSocketPorts': [5000, 7101, 9999],
                'privateSignedURL': 'https://gci.arvideo.video/forwardGame.do?token=SECRET',
                'token': 'SECRET',
                'requestFailures': -42,
            })
            raw = (Path(d) / 'status.json').read_text()
            status = json.loads(raw)
            self.assertEqual(status['release'], 'V33')
            self.assertEqual(status['diagnostics']['providerWebSockets'], 3)
            self.assertEqual(status['diagnostics']['webSocketPorts'], [5000, 7101])
            self.assertNotIn('SECRET', raw)
            self.assertNotIn('privateSignedURL', raw)
            self.assertNotIn('requestFailures', status['diagnostics'])


if __name__ == '__main__':
    unittest.main()
