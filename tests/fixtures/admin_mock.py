"""Serve dist/ plus a stand-in for Supabase auth, PostgREST and the RPCs.

Enough of PostgREST to exercise the admin app: eq./in. filters, select, order,
Prefer: return=representation, and the two RPCs. Data lives in memory.
"""
import json, re, sys, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[2] / 'dist'
TYPES = {'.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
         '.webmanifest': 'application/manifest+json'}

DB = {'events': [], 'guests': [], 'kiosk_instances': [], 'csv_uploads': [], 'admin_users': []}
STATE = {'authorised': True}

ADMIN = {'id': '11111111-1111-1111-1111-111111111111', 'email': 'admin@mediavaccine.test'}


def reset():
    DB['events'] = [{
        'id': 'evt-1', 'slug': 'demo-gala-2026', 'name': 'Demo Gala 2026', 'status': 'active',
        'table_count': 8, 'assignment_strategy': 'provided-in-csv',
        'branding': {'header_text': 'Demo Gala 2026', 'primary_color': '#1f6feb',
                     'accent_color': '#f0b429', 'background_color': '#0b0d12', 'font': 'inter',
                     'subtitle_text': 'Find your table'},
        'extra_field_schema': {'fields': [{'key': 'meal', 'label': 'Meal choice', 'visible': True},
                                          {'key': 'phone', 'label': 'Phone', 'visible': False}]},
        'created_at': '2026-09-01T10:00:00Z', 'updated_at': '2026-09-01T10:00:00Z',
    }]
    DB['guests'] = [
        {'id': 'g1', 'event_id': 'evt-1', 'full_name': 'Adaeze Okonkwo', 'table_number': 'Table 1',
         'extra': {'meal': 'Vegetarian'}, 'source': 'csv'},
        {'id': 'g2', 'event_id': 'evt-1', 'full_name': 'Bukki Solanke', 'table_number': 'Head Table',
         'extra': {}, 'source': 'csv'},
        {'id': 'g3', 'event_id': 'evt-1', 'full_name': 'Chidi Nwosu', 'table_number': None,
         'extra': {}, 'source': 'manual'},
    ]
    DB['kiosk_instances'] = [{'id': 'k1', 'event_id': 'evt-1', 'label': 'Main Entrance', 'url_param': 'main'}]
    DB['csv_uploads'] = []
    DB['admin_users'] = [ADMIN]


reset()


def match(row, filters):
    for key, spec in filters.items():
        if key in ('select', 'order', 'limit'):
            continue
        value = spec[0] if isinstance(spec, list) else spec
        if value.startswith('eq.'):
            if str(row.get(key)) != value[3:]:
                return False
        elif value.startswith('in.'):
            wanted = {v.strip('"') for v in value[4:-1].split(',')}
            if str(row.get(key)) not in wanted:
                return False
    return True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
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

    def _body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length) or b'null')

    def _table(self):
        path = urlparse(self.path).path
        m = re.match(r'/rest/v1/([a-z_]+)$', path)
        return m.group(1) if m else None

    def do_OPTIONS(self):
        self._send(204, b'')

    def do_POST(self):
        path = urlparse(self.path).path

        if path == '/auth/v1/token':
            body = self._body()
            if body.get('password') != 'correct-horse':
                self._send(400, json.dumps({'error_description': 'Invalid login credentials'}))
                return
            self._send(200, json.dumps({'access_token': 'test-token', 'user': {'id': ADMIN['id'], 'email': body.get('email')}}))
            return

        if path == '/rest/v1/rpc/event_analytics':
            self._send(200, json.dumps({
                'totals': {'searches': 42, 'reveals': 30, 'no_matches': 8, 'total': 80},
                'no_match_terms': [{'query': 'zzz', 'count': 5, 'last_seen': '2026-09-02T20:00:00Z'},
                                   {'query': 'jon smyth', 'count': 3, 'last_seen': '2026-09-02T19:00:00Z'}],
                'by_hour': [{'hour': '2026-09-02T19:00:00Z', 'count': 30},
                            {'hour': '2026-09-02T20:00:00Z', 'count': 50}],
                'by_kiosk': [{'label': 'Main Entrance', 'count': 60}, {'label': 'Untagged', 'count': 20}],
                'busiest_guests': [{'name': 'Adaeze Okonkwo', 'count': 4}],
            }))
            return

        table = self._table()
        if table:
            rows = self._body()
            rows = rows if isinstance(rows, list) else [rows]
            created = []
            for row in rows:
                row = dict(row)
                row.setdefault('id', str(uuid.uuid4()))
                row.setdefault('extra', {})
                row.setdefault('status', 'active')
                row.setdefault('updated_at', '2026-09-02T22:00:00Z')
                row.setdefault('created_at', '2026-09-02T22:00:00Z')
                if table == 'events' and any(e['slug'] == row.get('slug') for e in DB['events']):
                    self._send(409, json.dumps({'message': 'duplicate key value violates unique constraint'}))
                    return
                DB[table].append(row)
                created.append(row)
            self._send(201, json.dumps(created))
            return

        self._send(404, json.dumps({'message': 'no route'}))

    def do_PATCH(self):
        table = self._table()
        filters = parse_qs(urlparse(self.path).query)
        patch = self._body()
        updated = []
        for row in DB.get(table, []):
            if match(row, filters):
                row.update(patch)
                updated.append(row)
        self._send(200, json.dumps(updated))

    def do_DELETE(self):
        table = self._table()
        filters = parse_qs(urlparse(self.path).query)
        DB[table] = [r for r in DB.get(table, []) if not match(r, filters)]
        self._send(204, b'')

    def do_GET(self):
        parsed = urlparse(self.path)
        path, filters = parsed.path, parse_qs(parsed.query)

        if path == '/__reset':
            reset(); STATE['authorised'] = True
            self._send(200, json.dumps({'ok': True})); return
        if path == '/__db':
            self._send(200, json.dumps(DB)); return
        if path.startswith('/__unauthorised/'):
            STATE['authorised'] = path.endswith('/0')
            self._send(200, json.dumps({'authorised': STATE['authorised']})); return

        table = self._table()
        if table:
            if table == 'admin_users' and not STATE['authorised']:
                self._send(200, json.dumps([])); return
            rows = [r for r in DB.get(table, []) if match(r, filters)]
            order = filters.get('order', [''])[0]
            if order:
                key, _, direction = order.partition('.')
                rows = sorted(rows, key=lambda r: (r.get(key) is None, r.get(key)),
                              reverse=direction.startswith('desc'))
            self._send(200, json.dumps(rows)); return

        name = path.lstrip('/') or 'index.html'
        if path.startswith('/admin'):
            candidate = ROOT / path.lstrip('/')
            name = path.lstrip('/') if candidate.is_file() else 'admin/index.html'
        elif path.startswith('/e/'):
            name = 'index.html'

        target = ROOT / name
        if not target.is_file():
            self._send(404, b'not found', 'text/plain'); return
        self._send(200, target.read_bytes(), TYPES.get(target.suffix, 'text/plain'))


ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()
