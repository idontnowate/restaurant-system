"""server.py — خادم محلي للمطعم: يربط الكاشير وشاشة المطبخ وموبايلات الويترية على نفس شبكة الواي فاي.

التشغيل:  py server.py      (أو انقر مرتين على «تشغيل-الخادم.bat»)
ثم افتح على أي جهاز بنفس الشبكة:
    لوحة الإدارة:    http://<عنوان-الجهاز>:8080/
    تطبيق الويتر:    http://<عنوان-الجهاز>:8080/waiter.html

لا يحتاج أي مكتبات إضافية. البيانات تُحفظ في data/state.json
"""
import json
import os
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('PORT', 8080))
ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'prototype')
DATA = os.path.join(ROOT, 'data', 'state.json')
RANK = {'new': 0, 'preparing': 1, 'ready': 2, 'done': 3}

lock = threading.Lock()
state = None
version = 0
# آخر العمليات المتزامنة (طلب جديد، حالة طلب، حالة طاولة): تُعاد على أي حفظ مبني على نسخة أقدم حتى لا تضيع
ops = []


def load():
    global state, version
    if os.path.exists(DATA):
        with open(DATA, encoding='utf-8') as f:
            saved = json.load(f)
        state, version = saved['state'], saved['version']


def persist():
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    tmp = DATA + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'version': version, 'state': state}, f, ensure_ascii=False)
    os.replace(tmp, DATA)


def apply_op(s, op):
    """نفس applyOp في core.js. كل عملية آمنة إذا تكررت."""
    kind = op.get('type')
    if kind == 'order':
        o = dict(op['order'])
        if any(x.get('uid') == o['uid'] for x in s['orders']):
            return
        o['id'] = max([s['nextId']] + [x['id'] + 1 for x in s['orders']])
        s['nextId'] = o['id'] + 1
        s['orders'].append(o)
        if s['settings'].get('autoDeduct', True):
            for line in o['items']:
                dish = next((m for m in s['menu'] if m['id'] == line['id']), None)
                for key, amount in (dish or {}).get('recipe', {}).items():
                    for inv in s['inventory']:
                        if inv['id'] == key:
                            inv['qty'] = max(0, inv['qty'] - amount * line['qty'])
        if o.get('table'):
            for t in s['tables']:
                if t['id'] == o['table'] and t['status'] == 'free':
                    t['status'] = 'busy'
    elif kind == 'status':
        for o in s['orders']:
            if o.get('uid') == op['uid'] and RANK.get(op['status'], 0) > RANK.get(o['status'], 0):
                o['status'] = op['status']
    elif kind == 'table':
        for t in s['tables']:
            if t['id'] == op['id']:
                t['status'] = op['status']


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length) or b'{}')

    def do_GET(self):
        if self.path == '/':
            self.path = '/admin.html'
        if self.path.startswith('/api/info'):
            return self.send_json({'ips': lan_ips(), 'port': PORT})
        if self.path.startswith('/api/version'):
            return self.send_json({'version': version})
        if self.path.startswith('/api/state'):
            with lock:
                return self.send_json({'version': version, 'state': state})
        return super().do_GET()

    def do_PUT(self):
        global state, version
        if not self.path.startswith('/api/state'):
            return self.send_error(404)
        body = self.read_json()
        incoming, base = body['state'], body.get('base', 0)
        with lock:
            merged = base != version and state is not None
            if merged:
                for v, op in ops:
                    if v > base:
                        apply_op(incoming, op)
            state = incoming
            version += 1
            persist()
            self.send_json({'version': version, 'merged': merged, 'state': state if merged else None})

    def do_POST(self):
        global version
        if not self.path.startswith('/api/action'):
            return self.send_error(404)
        op = self.read_json()['op']
        with lock:
            if state is None:
                return self.send_json({'error': 'no state'}, 409)
            apply_op(state, op)
            version += 1
            ops.append((version, op))
            del ops[:-500]
            persist()
            self.send_json({'version': version, 'state': state})


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        ips.update(ip for ip in socket.gethostbyname_ex(socket.gethostname())[2] if not ip.startswith('127.'))
    except OSError:
        pass
    return sorted(ips)


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
    except (AttributeError, OSError):
        pass
    load()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print('خادم المطعم يعمل ✓')
    print(f'  على هذا الجهاز:  http://localhost:{PORT}/')
    for ip in lan_ips():
        print(f'  لوحة الإدارة:     http://{ip}:{PORT}/')
        print(f'  تطبيق الويتر:     http://{ip}:{PORT}/waiter.html')
    print('اترك هذه النافذة مفتوحة. للإيقاف: Ctrl+C')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
