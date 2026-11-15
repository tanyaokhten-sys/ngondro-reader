"""Build public/ from the original app files plus our changes.

    python3 tools/build.py

The React source isn't in this repo, only the compiled app. The untouched
compiled files live in tools/original/; this script applies every change on
top of them (so patches never stack on already-patched output):

  * home screen scrolls on small phones (CSS)
  * Google sign-in + cross-device sync + migration (tools/account-client.js)
  * Supabase client loaded from /vendor (works offline via the service worker)

Patched JS/CSS get content-hashed names, and index.html plus the service
worker's precache list are updated so installed copies pick up the change.
"""
import glob
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIG = os.path.join(ROOT, 'tools', 'original')
PUB = os.path.join(ROOT, 'public')
VENDOR = 'vendor/supabase-js-2.119.0.js'


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def replace_once(s, old, new, what):
    n = s.count(old)
    assert n == 1, f'{what}: expected 1 match, found {n}'
    return s.replace(old, new)


js = read(os.path.join(ORIG, 'assets/index-rJMPRxuM.js'))
css = read(os.path.join(ORIG, 'assets/index-BkesdbSv.css'))
idx = read(os.path.join(ORIG, 'index.html'))
sw = read(os.path.join(ORIG, 'sw.js'))

# --- CSS -------------------------------------------------------------------
css = replace_once(
    css,
    '.home-main{flex:1;min-height:0;display:flex;flex-direction:column;gap:22px;overflow:hidden}',
    '.home-main{flex:1;min-height:0;display:flex;flex-direction:column;gap:22px;overflow-x:hidden;'
    'overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.home-main>*{flex-shrink:0}',
    'home scroll')
css += (
    '.counter-sync{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;'
    'column-gap:12px;font-size:13px;color:var(--muted);border-top:1px solid var(--line);margin-top:2px}'
    '.counter-sync span{min-width:0;overflow-wrap:anywhere}'
    '.counter-sync .warn{color:var(--accent-ink);font-weight:500}'
    '.counter-sync .linklike{font-size:13px;margin-left:auto}')


# --- JS --------------------------------------------------------------------
clients = read(os.path.join(ROOT, 'tools/account-client.js'))
anchor = 'function Kf({id:p}){'
js = replace_once(js, anchor, clients + '\n' + anchor, 'counter component')

js = replace_once(
    js,
    ':o.jsx("span",{children:z==="target"?"Нова ціль для цієї практики":"Додайте кількість після сесії"})})]})}',
    ':o.jsx("span",{children:z==="target"?"Нова ціль для цієї практики":"Додайте кількість після сесії"})}),'
    'o.jsx(__NgAccountRow,{})]})}',
    'counter rows')

# Every change the counter card saves goes through this setter: turn it into events.
js = replace_once(
    js,
    'function Ef(p,y){try{localStorage.setItem(Hu+p,JSON.stringify(y))}catch{}}',
    'function Ef(p,y){let __prev;if(p==="counters")try{__prev=JSON.parse(localStorage.getItem(Hu+p)||"{}")}catch{}'
    'try{localStorage.setItem(Hu+p,JSON.stringify(y))}catch{}'
    'if(p==="counters")try{__ngOnCountersChange(__prev,y)}catch(e){console.warn(e)}}',
    'storage setter')

boot = 'hf.createRoot(document.getElementById("root"))'
js = replace_once(js, boot, 'try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist().catch(()=>{})}catch{}' + boot, 'boot')


# --- write hashed assets ---------------------------------------------------
def hashed(content, ext):
    return f'assets/index-{hashlib.sha256(content.encode()).hexdigest()[:8]}.{ext}'


for old in glob.glob(os.path.join(PUB, 'assets/index-*.js')) + glob.glob(os.path.join(PUB, 'assets/index-*.css')):
    os.remove(old)
js_name, css_name = hashed(js, 'js'), hashed(css, 'css')
write(os.path.join(PUB, js_name), js)
write(os.path.join(PUB, css_name), css)

# --- index.html ------------------------------------------------------------
idx = replace_once(idx, 'assets/index-rJMPRxuM.js', js_name, 'index js')
idx = replace_once(idx, 'assets/index-BkesdbSv.css', css_name, 'index css')
idx = replace_once(
    idx,
    '<script type="module" crossorigin src=',
    f'<script defer src="/{VENDOR}"></script>\n    <script type="module" crossorigin src=',
    'vendor script')
write(os.path.join(PUB, 'index.html'), idx)

# --- service worker precache ----------------------------------------------
vendor_rev = hashlib.md5(open(os.path.join(PUB, VENDOR), 'rb').read()).hexdigest()
sw = replace_once(sw, 'assets/index-rJMPRxuM.js', js_name, 'sw js')
sw = replace_once(sw, 'assets/index-BkesdbSv.css', css_name, 'sw css')
old_rev = re.search(r'\{url:"index\.html",revision:"([0-9a-f]+)"\}', sw).group(1)
sw = replace_once(sw, old_rev, hashlib.md5(idx.encode()).hexdigest(), 'sw index revision')
sw = replace_once(sw, '{url:"registerSW.js",', f'{{url:"{VENDOR}",revision:"{vendor_rev}"}},{{url:"registerSW.js",', 'sw vendor')
write(os.path.join(PUB, 'sw.js'), sw)

print(js_name, css_name)
