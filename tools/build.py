"""Build public/ from the original app files plus our changes.

    python3 tools/build.py

The React source isn't in this repo, only the compiled app. The untouched
compiled files live in tools/original/; this script applies every change on
top of them (so patches never stack on already-patched output):

  * home screen scrolls on small phones (CSS)
  * Google sign-in + cross-device sync + migration (tools/account-client.js)
  * counter card with preview, correction, undo and optional weekly goals (tools/counter-client.js)
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
css = replace_once(
    css,
    '.themes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
    '.themes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
    'two themes')
css += (
    '.counter-sync{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;'
    'column-gap:12px;font-size:13px;color:var(--muted);border-top:1px solid var(--line);margin-top:2px}'
    '.counter-sync span{min-width:0;overflow-wrap:anywhere}'
    '.counter-sync .warn{color:var(--accent-ink);font-weight:500}'
    '.counter-sync .linklike{font-size:13px;margin-left:auto}'
    '.counter-preview{font-size:14px;color:var(--muted);margin-top:-4px;font-variant-numeric:tabular-nums}'
    '.counter-head-r{display:flex;align-items:center;gap:6px}'
    '.counter-today{font-size:13px;color:var(--muted)}'
    '.counter-more{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;margin:-10px -10px -10px 0;'
    'border:0;border-radius:20px;background:none;color:var(--muted)}'
    '.counter-more:active{background:var(--paper-3)}'
    '.counter-btns-big{gap:10px}.counter-btns-big button{min-height:64px;font-size:19px;border-radius:14px}'
    '.counter-undo{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;column-gap:16px;'
    'margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);font-size:14px;color:var(--muted);min-height:44px}'
    '.counter-undo.counter-confirm{color:var(--ink);font-size:15px}'
    '.hist{gap:16px;max-height:85svh}'
    '.hist-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}'
    '.hist-name{font-family:var(--serif);font-size:20px;margin-top:4px}'
    '.hist-total{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:14px;background:var(--paper-2)}'
    '.hist-row{display:flex;align-items:center;justify-content:space-between;gap:12px}'
    '.hist-row>span:first-child{display:flex;flex-direction:column;min-width:0}'
    '.hist-label{font-size:13px;color:var(--muted)}'
    '.hist-big{font-family:var(--serif);font-size:28px;line-height:1.2;font-variant-numeric:tabular-nums}'
    '.hist-confirm{display:flex;flex-direction:column;gap:2px;font-size:15px}'
    '.hist-confirm p{margin:0}.hist-confirm .counter-links{margin-left:0;justify-content:flex-start}'
    '.hist-list{list-style:none;margin:-8px 0 0;padding:0}'
    '.hist-list li{border-bottom:1px solid var(--rule);padding:6px 0}'
    '.hist-what{font-size:16px;font-variant-numeric:tabular-nums}.hist-what.adj{color:var(--accent-ink)}'
    '.hist-when{font-size:12px;color:var(--muted)}'
    '.hist-note{margin:0;font-size:13px;line-height:1.45;color:var(--muted)}'
    '.counter-week{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted);margin-top:-4px}'
    '.bar.bar-week{height:2px;background:var(--paper-3)}.bar.bar-week>div{height:2px;background:var(--muted);opacity:.6}'
    '.hist-goal{padding:2px 0}.hist-goal>span:first-child{gap:2px;font-size:15px}'
    '.goal-seg button{font-variant-numeric:tabular-nums}'
    '.goal-off{align-self:flex-start}'
    '.counter-preview b,.counter-confirm b{color:var(--ink);font-weight:600}'
    '.counter-confirm{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;column-gap:16px;font-size:15px;min-height:46px}'
    '.counter-foot2{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;column-gap:12px;font-size:13px;color:var(--muted);min-height:24px}'
    '.counter-links{display:flex;gap:18px;margin-left:auto}'
    '.counter-links .linklike{font-size:13px}'
    '.counter-form button:disabled{opacity:.45}')


# --- JS --------------------------------------------------------------------
clients = read(os.path.join(ROOT, 'tools/account-client.js')) + '\n' + read(os.path.join(ROOT, 'tools/counter-client.js'))

# Replace the compiled counter card (Kf) with tools/counter-client.js, which
# records each action (add / correction / undo / goal) explicitly.
kf_start = js.index('function Kf({id:p}){')
kf_end = js.index('const Yf=', kf_start)
assert js.count('function Kf({id:p}){') == 1
js = js[:kf_start] + clients + '\nfunction Kf({id:p}){return o.jsx(__NgCounter,{id:p})}' + js[kf_end:]

# Reading settings: only two line spacings (Щільний, Просторий) and two themes
# (Світла, Темна). Saved "Звичайний"/"Тепла" choices move to the nearest
# remaining option once, before the first render.
js = replace_once(
    js,
    'Vf=[{id:"compact",label:"Щільний"},{id:"normal",label:"Звичайний"},{id:"relaxed",label:"Просторий"}]',
    'Vf=[{id:"compact",label:"Щільний"},{id:"relaxed",label:"Просторий"}]',
    'line spacing options')
js = replace_once(
    js,
    '{id:"warm",label:"Тепла",bg:"#eadbc0",ink:"#3a2e22"},',
    '',
    'warm theme option')
js = replace_once(js, 'Cf={fontSize:19,lineHeight:"normal"', 'Cf={fontSize:19,lineHeight:"compact"', 'default line spacing')
settings_boot = 'try{const p=JSON.parse(localStorage.getItem("ngondro:v1:settings")||"{}");p.theme&&(document.documentElement.dataset.theme=p.theme)}catch{}'
js = replace_once(
    js,
    settings_boot,
    'try{const k="ngondro:v1:settings",s=JSON.parse(localStorage.getItem(k)||"{}");let ch=0;'
    'if(!s.lineHeight||s.lineHeight==="normal"){s.lineHeight="compact";ch=1}'
    'if(s.theme==="warm"){s.theme="light";ch=1}'
    'ch&&localStorage.setItem(k,JSON.stringify(s))}catch{}' + settings_boot,
    'settings migration')

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
