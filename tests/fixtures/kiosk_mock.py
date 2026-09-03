"""Serve apps/kiosk plus a stand-in for the two Supabase RPC endpoints.

The payload is the exact output of public.event_public_payload() taken from a
real Postgres running the migrations, so the browser sees production-shaped data.
"""
import json, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'dist'
PAYLOAD = json.loads(Path(sys.argv[2]).read_text())
TRACKED = []
STATE = {'offline': False}

TYPES = {'.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype='application/json'):
        raw = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self._send(204, b'')

    def do_POST(self):
        if STATE['offline']:
            self._send(503, json.dumps({'error': 'simulated outage'}))
            return

        # PostgREST reads query parameters on an RPC call as filters and rejects
        # anything it does not recognise. Mimic that: accepting a stray
        # parameter here once hid a bug that broke every request in production.
        if '?' in self.path:
            self._send(400, json.dumps({
                'code': 'PGRST100',
                'message': 'unexpected query parameter on rpc call: ' + self.path.split('?', 1)[1],
            }))
            return
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length) or b'{}')

        if self.path.endswith('/event_public_payload'):
            match = PAYLOAD if body.get('p_slug') == PAYLOAD['event']['slug'] else None
            self._send(200, json.dumps(match))
        elif self.path.endswith('/track_usage_event'):
            TRACKED.append(body)
            self._send(200, 'null')
        else:
            self._send(404, json.dumps({'error': 'no such rpc'}))

    def do_GET(self):
        # Test hooks, not part of the app.
        if self.path == '/__tracked':
            self._send(200, json.dumps(TRACKED))
            return
        if self.path == '/__reset':
            TRACKED.clear()
            self._send(200, json.dumps({'tracked': 0}))
            return
        if self.path.startswith('/__offline/'):
            STATE['offline'] = self.path.endswith('/1')
            self._send(200, json.dumps({'offline': STATE['offline']}))
            return

        path = self.path.split('?')[0]
        # Stand in for the netlify.toml rewrite: /e/* serves the app shell.
        name = 'index.html' if path.startswith('/e/') or path == '/' else path.lstrip('/')
        target = ROOT / name
        if not target.is_file():
            self._send(404, b'not found', 'text/plain')
            return
        self._send(200, target.read_bytes(), TYPES.get(target.suffix, 'text/plain'))


ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()
