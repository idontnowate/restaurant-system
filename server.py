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
RANK = {'new': 0, 'preparing': 1, 'ready': 2, 'done': 3, 'void': 9}

lock = threading.Lock()
state = None
version = 0
# آخر العمليات المتزامنة (طلب جديد، حالة طلب، دفع، إلغاء، طاولة): تُعاد على أي حفظ مبني على نسخة أقدم حتى لا تضيع
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


def deduct(s, o, sign):
    """خصم (أو إرجاع عند الإلغاء) مواد الوصفة من المخزون."""
    if not s['settings'].get('autoDeduct', True):
        return
    for line in o['items']:
        dish = next((m for m in s['menu'] if m['id'] == line['id']), None)
        for key, amount in (dish or {}).get('recipe', {}).items():
            for inv in s['inventory']:
                if inv['id'] == key:
                    inv['qty'] = max(0, round(inv['qty'] - sign * amount * line['qty'], 3))


def apply_op(s, op):
    """نفس applyOp في core.js. كل عملية آمنة إذا تكررت."""
    kind = op.get('type')
    by_uid = lambda u: next((x for x in s['orders'] if x.get('uid') == u), None)
    if kind == 'order':
        o = json.loads(json.dumps(op['order']))
        if by_uid(o['uid']):
            return
        # الترقيم: يمكن أن يرجع للبداية كل يوم (نفس منطق core.js)
        if s['settings'].get('numReset') == 'daily':
            import datetime
            day = datetime.datetime.fromtimestamp(o.get('createdAt', 0) / 1000).strftime('%a %b %d %Y')
            if s.get('numDay') != day:
                s['numDay'] = day
                s['nextId'] = int(s['settings'].get('numStart') or 1)
        o['id'] = s.get('nextId', 1)
        s['nextId'] = o['id'] + 1
        s['orders'].append(o)
        deduct(s, o, 1)
        if o.get('table'):
            for t in s['tables']:
                if t['id'] == o['table'] and t['status'] in ('free', 'res'):
                    t['status'] = 'busy'
    elif kind == 'status':
        o = by_uid(op['uid'])
        if o and o['status'] != 'void' and RANK.get(op['status'], 0) > RANK.get(o['status'], 0):
            o['status'] = op['status']
    elif kind == 'table':
        for t in s['tables']:
            if t['id'] == op['id']:
                t['status'] = op['status']
    elif kind == 'pay':
        for u in op.get('uids', []):
            o = by_uid(u)
            if o and not o.get('pay') and o['status'] != 'void':
                o['pay'], o['paidAt'], o['paidBy'] = op.get('pay'), op.get('at'), op.get('by')
                if op.get('discount') is not None:
                    o['discount'] = op['discount']
                if op.get('customer'):
                    o['customer'] = op['customer']
        if op.get('table'):
            for t in s['tables']:
                if t['id'] == op['table']:
                    t['status'] = 'free'
    elif kind == 'void':
        o = by_uid(op['uid'])
        if o and o['status'] != 'void':
            o['status'], o['voidReason'], o['voidBy'], o['voidAt'] = 'void', op.get('reason'), op.get('by'), op.get('at')
            deduct(s, o, -1)
    elif kind == 'move':
        to = next((t for t in s['tables'] if t['id'] == op['to']), None)
        frm = next((t for t in s['tables'] if t['id'] == op['from']), None)
        if not to or not frm:
            return
        for o in s['orders']:
            if o.get('table') == op['from'] and not o.get('pay') and o['status'] != 'void':
                o['table'] = op['to']
        to['status'], frm['status'] = 'busy', 'free'


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
