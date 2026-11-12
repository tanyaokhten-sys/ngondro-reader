"""Inject tools/sync-client.js into the built bundle in public/.

Run from the repo root:  python3 tools/patch-sync.py
Renames the patched JS/CSS to new hashed names and updates index.html and the
service worker's precache list so installed copies pick up the change.
"""
import glob, hashlib, os

PUB = 'public/'
JS_OLD = glob.glob(PUB + 'assets/index-*.js')[0]
CSS_OLD = glob.glob(PUB + 'assets/index-*.css')[0]
js = open(JS_OLD).read()
css = open(CSS_OLD).read()
assert '__ngSyncNow' not in js, 'already patched'

client = open('tools/sync-client.js').read()

anchor = 'function Kf({id:p}){'
assert js.count(anchor) == 1
js = js.replace(anchor, client + '\n' + anchor)

row_old = 'o.jsx(__NgBackupRow,{total:C.total})'
assert js.count(row_old) == 1
js = js.replace(row_old, row_old + ',o.jsx(__NgSyncRow,{})')

# sync shortly after any change the user makes to the counters
ef_old = 'function Ef(p,y){try{localStorage.setItem(Hu+p,JSON.stringify(y))}catch{}}'
assert js.count(ef_old) == 1
js = js.replace(ef_old, 'function Ef(p,y){try{localStorage.setItem(Hu+p,JSON.stringify(y))}catch{}p==="counters"&&__ngSyncSoon()}')

css += ('.counter-sync{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;'
        'column-gap:12px;font-size:13px;color:var(--muted);margin-top:-8px}'
        '.counter-sync .warn{color:var(--accent-ink);font-weight:500}'
        '.counter-sync .linklike{font-size:13px;margin-left:auto}')


def write_hashed(old, content, ext):
    new = PUB + f'assets/index-{hashlib.sha256(content.encode()).hexdigest()[:8]}.{ext}'
    open(new, 'w').write(content)
    os.remove(old)
    return new


JS_NEW = write_hashed(JS_OLD, js, 'js')
CSS_NEW = write_hashed(CSS_OLD, css, 'css')

idx = open(PUB + 'index.html').read()
sw = open(PUB + 'sw.js').read()
old_rev = hashlib.md5(idx.encode()).hexdigest()
for a, b in ((JS_OLD, JS_NEW), (CSS_OLD, CSS_NEW)):
    a, b = a[len(PUB):], b[len(PUB):]
    assert idx.count(a) == 1 and sw.count(a) == 1, a
    idx = idx.replace(a, b)
    sw = sw.replace(a, b)
new_rev = hashlib.md5(idx.encode()).hexdigest()
assert sw.count(old_rev) == 1
sw = sw.replace(old_rev, new_rev)
open(PUB + 'index.html', 'w').write(idx)
open(PUB + 'sw.js', 'w').write(sw)
print(JS_NEW, CSS_NEW)
