// Counter sync client. Injected into the built bundle by tools/patch-sync.py,
// right before the counter component, so it can use the bundle's module scope:
//   Hu  = localStorage key prefix ("ngondro:v1:")
//   Nf  = notify a stored key changed (re-renders components using it)
//   Nr  = practice map (id -> { short, ... })
//   o   = jsx runtime,  X = React
//
// Model: every device keeps its own contribution ("mine") on the server; the
// local total = mine + sum of the other devices' totals. `seen[id]` remembers
// the other devices' sum we last folded in, so mine = local - seen and new
// remote progress is applied as a delta. Local taps made while a request is in
// flight are never lost.

function __ngSyncState() {
  try { return JSON.parse(localStorage.getItem(Hu + "sync") || "null"); } catch { return null; }
}
function __ngSyncSave(s) {
  try { s ? localStorage.setItem(Hu + "sync", JSON.stringify(s)) : localStorage.removeItem(Hu + "sync"); } catch {}
  window.dispatchEvent(new Event("ngsync"));
}
function __ngCounters() {
  try { return JSON.parse(localStorage.getItem(Hu + "counters") || "{}") || {}; } catch { return {}; }
}
function __ngRandom(n, abc) {
  const r = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (let i = 0; i < n; i++) s += abc[r[i] % abc.length];
  return s;
}
function __ngNewKey() {
  return __ngRandom(16, "abcdefghjkmnpqrstuvwxyz23456789").match(/.{4}/g).join("-");
}
function __ngNormKey(s) {
  const k = String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return k.length === 16 ? k.match(/.{4}/g).join("-") : null;
}
async function __ngPost(body) {
  const r = await fetch("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!r.ok) throw new Error("sync " + r.status);
  return r.json();
}
function __ngOthers(devices, me) {
  const sum = {}, tgt = {};
  for (const d in devices) {
    const ps = (devices[d] && devices[d].practices) || {};
    for (const id in ps) {
      const p = ps[id];
      if (d !== me) sum[id] = (sum[id] || 0) + (p.total || 0);
      if (!tgt[id] || (p.targetAt || 0) > tgt[id].targetAt) tgt[id] = { target: p.target, targetAt: p.targetAt || 0 };
    }
  }
  return { sum, tgt };
}

let __ngBusy = null, __ngAgain = false, __ngTimer = 0;

async function __ngSyncNow() {
  if (__ngBusy) { __ngAgain = true; return __ngBusy; }
  __ngBusy = (async () => {
    let s = __ngSyncState();
    if (!s || !s.key) return;
    try {
      const local = __ngCounters();
      const seen = s.seen || {}, tAt = s.targetAt || {}, tSeen = s.targetSeen || {};
      const practices = {};
      for (const id in local) {
        const c = local[id] || {};
        // First time we see a practice, only claim a custom (non-default) goal;
        // afterwards any change the user makes wins over older ones.
        if (tSeen[id] === undefined) { if (!tAt[id] && c.target && c.target !== 111111) tAt[id] = 1; }
        else if (c.target !== tSeen[id]) tAt[id] = Date.now();
        practices[id] = {
          total: Math.max(0, (c.total || 0) - (seen[id] || 0)),
          target: c.target || 0,
          targetAt: tAt[id] || 0,
        };
      }
      const sig = JSON.stringify(practices);
      const changed = sig !== s.sentSig;
      const rev = changed ? (s.rev || 0) + 1 : s.rev || 0;
      const res = await __ngPost(
        changed || !rev
          ? { key: s.key, device: s.device, rev: Math.max(rev, 1), practices }
          : { key: s.key, device: s.device },
      );
      const { sum, tgt } = __ngOthers(res.devices || {}, s.device);

      // Re-read: the user may have tapped while the request was in flight.
      const cur = __ngCounters();
      const ids = new Set([...Object.keys(cur), ...Object.keys(sum)]);
      for (const id of ids) {
        const c = cur[id] || { total: 0, target: 111111, log: [] };
        c.total = Math.max(0, (c.total || 0) - (seen[id] || 0) + (sum[id] || 0));
        if (tgt[id] && tgt[id].targetAt > (tAt[id] || 0) && tgt[id].target > 0) {
          c.target = tgt[id].target;
          tAt[id] = tgt[id].targetAt;
        }
        cur[id] = c;
      }
      const tNow = {};
      for (const id in cur) tNow[id] = cur[id].target;
      try { localStorage.setItem(Hu + "counters", JSON.stringify(cur)); } catch {}
      Nf("counters");
      s = __ngSyncState();
      if (!s || !s.key) return;
      __ngSyncSave({
        ...s,
        rev: Math.max(rev, 1),
        sentSig: changed || !s.rev ? sig : s.sentSig,
        seen: sum,
        targetAt: tAt,
        targetSeen: tNow,
        devices: Object.keys(res.devices || {}).length,
        okAt: Date.now(),
        err: 0,
      });
    } catch (e) {
      const cur = __ngSyncState();
      if (cur) __ngSyncSave({ ...cur, err: Date.now() });
    }
  })();
  try { await __ngBusy; } finally {
    __ngBusy = null;
    if (__ngAgain) { __ngAgain = false; __ngSyncSoon(); }
  }
}
function __ngSyncSoon(ms) {
  clearTimeout(__ngTimer);
  __ngTimer = setTimeout(__ngSyncNow, ms == null ? 1200 : ms);
}

async function __ngSyncSetup() {
  const s = __ngSyncState();
  if (s && s.key) {
    const v = window.prompt(
      "Ключ синхронізації цього пристрою — введіть його на іншому пристрої.\n\nЩоб вимкнути синхронізацію тут, зітріть ключ і натисніть OK.",
      s.key,
    );
    if (v === null) return;
    if (!v.trim()) {
      if (confirm("Вимкнути синхронізацію на цьому пристрої? Числа на ньому залишаться.")) __ngSyncSave(null);
      return;
    }
    if (__ngNormKey(v) === s.key) return;
    alert("Щоб змінити ключ, спершу вимкніть синхронізацію (зітріть ключ).");
    return;
  }
  const input = window.prompt(
    "Синхронізація лічильника між пристроями.\n\n• Перший пристрій: залиште поле порожнім і натисніть OK — з’явиться новий ключ.\n• Інший пристрій: вставте ключ з першого.",
    "",
  );
  if (input === null) return;
  let key;
  const isNew = !input.trim();
  if (isNew) key = __ngNewKey();
  else {
    key = __ngNormKey(input);
    if (!key) { alert("Ключ має 16 символів, наприклад: abcd-efgh-jkmn-pqrs"); return; }
  }
  const device = __ngRandom(16, "abcdefghijklmnopqrstuvwxyz0123456789");
  let seen = {};
  if (!isNew) {
    let res;
    try { res = await __ngPost({ key, device }); }
    catch { alert("Немає з’єднання. Перевірте інтернет і спробуйте ще раз."); return; }
    const { sum } = __ngOthers(res.devices || {}, device);
    if (!Object.keys(res.devices || {}).length) {
      if (!confirm("З цим ключем ще немає жодного пристрою. Усе одно підключити?")) return;
    }
    const local = __ngCounters();
    const fmt = (n) => Number(n || 0).toLocaleString("uk");
    const both = Object.keys(sum).filter((id) => (local[id] && local[id].total > 0) && sum[id] > 0);
    if (both.length) {
      const lines = both.map((id) => (Nr.get(id)?.short || id) + ": інші пристрої " + fmt(sum[id]) + ", цей " + fmt(local[id].total));
      const replace = confirm(
        lines.join("\n") +
          "\n\nOK — взяти число з інших пристроїв (якщо ви вже переносили його сюди).\nСкасувати — додати обидва числа разом.",
      );
      if (replace) {
        // Treat what's on this device as already counted elsewhere.
        for (const id of both) seen[id] = local[id].total;
      }
    }
  }
  __ngSyncSave({ key, device, rev: 0, seen, targetAt: {}, targetSeen: {} });
  await __ngSyncNow();
  if (isNew) {
    window.prompt(
      "Синхронізацію увімкнено. Ваш ключ — скопіюйте його і введіть на іншому пристрої (Лічильник → Синхронізація):",
      key,
    );
  }
}

function __NgSyncRow() {
  const [, f] = X.useState(0);
  X.useEffect(() => {
    const h = () => f((n) => n + 1);
    window.addEventListener("ngsync", h);
    const t = setInterval(h, 30000);
    return () => { window.removeEventListener("ngsync", h); clearInterval(t); };
  }, []);
  const s = __ngSyncState();
  let text, cls = "";
  if (!s || !s.key) text = "Синхронізація вимкнена";
  else if (s.err && (!s.okAt || s.err > s.okAt)) { text = "Немає з’єднання — синхронізується пізніше"; cls = "warn"; }
  else if (s.okAt) {
    const d = new Date(s.okAt);
    const today = new Date().toDateString() === d.toDateString();
    text = "Синхронізовано " + (today ? d.toLocaleTimeString("uk", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("uk")) +
      (s.devices > 1 ? " · пристроїв: " + s.devices : "");
  } else text = "Синхронізація…";
  return o.jsxs("div", {
    className: "counter-sync",
    children: [
      o.jsx("span", { className: cls, children: text }),
      o.jsx("button", {
        type: "button",
        className: "linklike",
        onClick: __ngSyncSetup,
        children: s && s.key ? "Ключ" : "Увімкнути",
      }),
    ],
  });
}

// Background triggers.
(() => {
  const go = () => { if (document.visibilityState === "visible") __ngSyncSoon(300); };
  window.addEventListener("load", go);
  window.addEventListener("online", go);
  window.addEventListener("focus", go);
  document.addEventListener("visibilitychange", go);
  setInterval(go, 60000);
})();
