"""Loopback-only, explicitly synthetic browser QA. Never contacts a radio or device."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8794)
    args = parser.parse_args()
    issued = int(time.time())
    expires = issued + 120

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Do not log entered message text or request data.

        def reply(self, status, value):
            body = json.dumps(value).encode('utf-8')
            self.send_response(status)
            origin = self.headers.get('Origin', '')
            if (origin == 'https://theroberttalley.github.io' or
                    re.fullmatch(r'http://(?:127\.0\.0\.1|localhost)(?::\d+)?', origin)):
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'content-type')
                self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.reply(200, {'fixture': True})

        def do_GET(self):
            if self.path.split('?', 1)[0] not in ('/', '/snapshot', '/health', '/status'):
                self.reply(404, {'fixture': True, 'error': 'No fixture route'})
                return
            active = time.time() < expires
            snapshot = {'type': 'snapshot', 'source': 'headset', 'assetLabel': 'TEST FIXTURE · S1',
                        'localHandle': 'TEST FIXTURE', 'radioStatus': 'TEST FIXTURE: no radio',
                        'positionStatus': 'TEST LOCATION' if active else 'GPS waiting',
                        'readOnly': True, 'capabilities': {'commands': False, 'markers': False, 'messages': True},
                        'testLocationActive': active, 'testLocationId': 'local-browser-fixture',
                        'testLocationIssuedUnix': issued, 'testLocationExpiresUnix': expires,
                        'messaging': {'ready': True, 'status': 'TEST FIXTURE: requests are rejected; no radio transmission',
                                      'sessionId': 'local-browser-fixture-' + str(issued),
                                      'maxCharacters': 180, 'maxUtf8Bytes': 220, 'dedupeSeconds': 600,
                                      'channels': [{'index': 1, 'name': 'TEST CHANNEL (no radio)', 'role': 2,
                                                    'isPrivateVerified': True}]},
                        'nodes': [], 'markers': [], 'messages': []}
            if active:
                snapshot['center'] = {'lat': 1.25, 'lon': 2.5, 'zoom': 15}
                snapshot['nodes'] = [{'id': 'test-location:local-browser-fixture', 'label': 'TEST LOCATION',
                                      'source': 'test-location', 'lat': 1.25, 'lon': 2.5,
                                      'isLocal': False, 'positionCurrent': False}]
            self.reply(200, snapshot)

        def do_POST(self):
            if self.path != '/message':
                self.reply(403, {'fixture': True, 'ok': False, 'status': 'TEST FIXTURE: writes disabled'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > 4096:
                    raise ValueError('Invalid length')
                payload = json.loads(self.rfile.read(length))
                request_id = str(payload.get('requestId', ''))
            except (ValueError, TypeError):
                self.reply(400, {'fixture': True, 'ok': False, 'status': 'Invalid fixture request'})
                return
            self.reply(409, {'fixture': True, 'ok': False, 'requestId': request_id,
                             'state': 'rejected', 'submitted': False, 'deliveryConfirmed': False,
                             'status': 'TEST FIXTURE: message was not submitted. No radio is connected.'})

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print('TEST FIXTURE: http://127.0.0.1:' + str(args.port) + '; no RF; test location expires after 120 seconds.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
