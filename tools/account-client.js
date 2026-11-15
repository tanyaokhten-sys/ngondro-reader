// Google sign-in (Supabase Auth) and cross-device counter sync.
// Injected into the built bundle by tools/build.py, before the counter
// component. Uses the bundle's module scope: Hu (storage prefix "ngondro:v1:"),
// Nf (re-render users of a stored key), Nr (practices), o (jsx), X (React).
// window.supabase comes from /vendor/supabase-js-*.js (loaded before the app).
//
// Model
// -----
// * Signed out ("guest"): the counter works exactly as before, on this device
//   only. A note warns that it can be lost.
// * Signed in: every change the counter card makes (+21, +108, Інше…,
//   Скасувати, Виправити, goal) becomes an event with an id made on this device
//   (tools/counter-client.js). Events
//   wait in an outbox in localStorage and are uploaded with
//   "insert … on conflict (id) do nothing", so retries never double count and
//   devices never overwrite each other. The number shown is
//   server total + events still waiting in the outbox.
// * Offline: counting continues into the outbox; it uploads when back online.
// * First sign-in on a device with guest progress: the guest totals are
//   uploaded as 'import' events (after a copy is saved), asking the user what
//   to do when the account already has a number for that practice.
//
// All account state lives in ONE localStorage key (Hu+"acct") so that a
// migration (owner + import events) is written in a single setItem:
//   { owner: uid|null, device, emails:{uid:email}, outbox:{uid:[ev]},
//     server:{uid:{practice:{total,target,target_at}}}, //     okAt, err, needLogin }

const __NG_SB_URL = "https://himkikciqlogffqflaxc.supabase.co";
const __NG_SB_KEY = "sb_publishable_h9UICSo9TmatMBJJOvX_iw_E894KFUH";
const __NG_SB_STORAGE = "sb-himkikciqlogffqflaxc-auth-token";
const __NG_DEFAULT_TARGET = 111111;

let __ngSbClient = null, __ngSession = null, __ngAuthReady = false;

function __ngSb() {
  if (!__ngSbClient && window.supabase && window.supabase.createClient) {
    __ngSbClient = window.supabase.createClient(__NG_SB_URL, __NG_SB_KEY, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: __NG_SB_STORAGE },
    });
  }
  return __ngSbClient;
}

// ---------- local state ----------
function __ngAcct() {
  try { return JSON.parse(localStorage.getItem(Hu + "acct") || "{}") || {}; } catch { return {}; }
}
function __ngAcctSave(a) {
  try { localStorage.setItem(Hu + "acct", JSON.stringify(a)); } catch {}
  window.dispatchEvent(new Event("ngsync"));
}
function __ngAcctUpdate(fn) { const a = __ngAcct(); fn(a); __ngAcctSave(a); return a; }
function __ngCountersRead() {
  try { return JSON.parse(localStorage.getItem(Hu + "counters") || "{}") || {}; } catch { return {}; }
}
function __ngCountersWrite(c) {
  try { localStorage.setItem(Hu + "counters", JSON.stringify(c)); } catch {}
  Nf("counters");
}
function __ngUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function __ngDevice(a) {
  if (!a.device) a.device = __ngUuid().replace(/-/g, "");
  return a.device;
}
function __ngEvent(a, practice, kind, fields) {
  // Every event has the same keys so a batch upload has uniform columns.
  return {
    id: __ngUuid(), practice_id: practice, kind,
    delta: fields.delta || 0, target: fields.target ?? null, undoes: fields.undoes ?? null,
    client_total_before: fields.before ?? null, client_total_after: fields.after ?? null, note: fields.note ?? null,
    device_id: __ngDevice(a), client_at: new Date().toISOString(),
    ...(fields.local || {}), // local-only details, keys start with "_", never uploaded
  };
}
const __ngPending = (a, uid) => (a.outbox && a.outbox[uid]) || [];

// ---------- display: server total + pending events ----------
function __ngApplyDisplay(a, uid) {
  const server = (a.server && a.server[uid]) || {};
  const pend = __ngPending(a, uid);
  const cur = __ngCountersRead();
  const ids = new Set([...Object.keys(server), ...pend.map((e) => e.practice_id), ...Object.keys(cur)]);
  const next = {};
  for (const id of ids) {
    const s = server[id];
    const mine = pend.filter((e) => e.practice_id === id);
    const total = (s ? s.total : 0) + mine.reduce((n, e) => n + (e.delta || 0), 0);
    const tEv = mine.filter((e) => e.kind === "set_target").pop();
    const c = { total: 0, target: __NG_DEFAULT_TARGET, log: [], ...(cur[id] || {}) };
    c.total = Math.max(0, total);
    c.target = tEv ? tEv.target : s ? s.target : c.target;
    const wEv = mine.filter((e) => e.kind === "set_weekly_goal").pop();
    c.weeklyGoal = wEv ? wEv.target || null : s ? s.weekly_goal : c.weeklyGoal || null;
    next[id] = c;
  }
  __ngCountersWrite(next);
}

// ---------- sync ----------
let __ngBusy = null, __ngAgain = false, __ngTimer = 0;
const __NG_DROP = new Set(["23505", "23514", "23503", "22P02", "22003", "22007", "22008"]);

async function __ngFetchTotals(sb) {
  const { data, error } = await sb.from("counter_totals").select("practice_id,total,target,target_at,weekly_goal,weekly_goal_at");
  if (error) throw error;
  const out = {};
  for (const r of data || []) out[r.practice_id] = {
    total: Number(r.total), target: Number(r.target), target_at: r.target_at,
    weekly_goal: r.weekly_goal == null ? null : Number(r.weekly_goal), weekly_goal_at: r.weekly_goal_at,
  };
  return out;
}

// ---------- weeks (Monday–Sunday, this device's timezone) ----------
function __ngTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } }
const __NG_TZ_ALIASES = { "Europe/Kiev": "Europe/Kyiv", "Europe/Kyiv": "Europe/Kiev", "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh" };
function __ngWeekStart(now = new Date()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return d;
}
const __ngDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// This week's adds per practice, derived on the server from events (undone adds excluded).
async function __ngFetchWeek(sb) {
  const tz = __ngTz();
  let { data, error } = await sb.rpc("weekly_progress", { p_tz: tz });
  if (error && error.code === "22023" && __NG_TZ_ALIASES[tz]) ({ data, error } = await sb.rpc("weekly_progress", { p_tz: __NG_TZ_ALIASES[tz] }));
  if (error) throw error;
  const done = {};
  for (const r of data || []) done[r.practice_id] = Number(r.done);
  return { ws: __ngDateKey(__ngWeekStart()), tz, done };
}

// Weekly progress shown on the card: adds since Monday 00:00 (local), never negative.
// Signed in: server's derived sum + pending adds this week + pending undos of this week's adds.
// Signed out: from this device's log.
function __ngWeekDone(id, c) {
  const ws = __ngWeekStart().getTime();
  const a = __ngAcct();
  const uid = a.owner;
  if (!uid) return (c.log || []).filter((e) => (e.k || "add") === "add" && e.at >= ws).reduce((s, e) => s + e.n, 0);
  const w = a.week && a.week[uid];
  let n = w && w.ws === __ngDateKey(__ngWeekStart()) ? w.done[id] || 0 : 0;
  for (const e of __ngPending(a, uid)) {
    if (e.practice_id !== id) continue;
    if (e.kind === "add" && Date.parse(e.client_at) >= ws) n += e.delta;
    if (e.kind === "undo" && e._orig_k === "add" && e._orig_at >= ws) n += e.delta;
  }
  return Math.max(0, n);
}

async function __ngPush(sb, rows) {
  // Rows keep their order (an undo follows its add). One bad row would fail
  // the whole batch, so on a data error fall back to row-by-row and drop
  // only rows the server can never accept (e.g. a second undo of a tap).
  const sent = [], dropped = [];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await sb.from("counter_events").upsert(chunk, { onConflict: "id", ignoreDuplicates: true });
    if (!error) { sent.push(...chunk.map((r) => r.id)); continue; }
    if (!__NG_DROP.has(error.code)) throw error;
    for (const r of chunk) {
      const res = await sb.from("counter_events").upsert([r], { onConflict: "id", ignoreDuplicates: true });
      if (!res.error) sent.push(r.id);
      else if (__NG_DROP.has(res.error.code)) dropped.push(r.id);
      else throw res.error;
    }
  }
  return { sent, dropped };
}

async function __ngSyncNow() {
  if (__ngBusy) { __ngAgain = true; return __ngBusy; }
  __ngBusy = (async () => {
    const sb = __ngSb();
    let a = __ngAcct();
    const uid = a.owner;
    if (!sb || !uid) return;
    if (!navigator.onLine) { __ngAcctUpdate((x) => { x.err = Date.now(); }); return; }
    try {
      const { data } = await sb.auth.getSession();
      const session = data && data.session;
      if (!session || session.user.id !== uid) { __ngAcctUpdate((x) => { x.needLogin = true; }); return; }
      const rows = __ngPending(a, uid).map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k[0] !== "_")));
      let done = new Set();
      if (rows.length) {
        const r = await __ngPush(sb, rows);
        done = new Set([...r.sent, ...r.dropped]);
      }
      const totals = await __ngFetchTotals(sb);
      let week = null;
      try { week = await __ngFetchWeek(sb); } catch (e) { console.warn("weekly progress", e); }
      // Everything below is synchronous: taps made during the awaits above
      // are already in the outbox and are kept.
      a = __ngAcct();
      if (a.owner !== uid) return;
      a.outbox = a.outbox || {};
      a.outbox[uid] = __ngPending(a, uid).filter((e) => !done.has(e.id));
      a.server = a.server || {};
      a.server[uid] = totals;
      if (week) { a.week = a.week || {}; a.week[uid] = week; }
      a.okAt = Date.now(); a.err = 0; a.needLogin = false;
      __ngAcctSave(a);
      __ngApplyDisplay(a, uid);
    } catch (e) {
      console.warn("sync failed", e);
      __ngAcctUpdate((x) => { x.err = Date.now(); });
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

// ---------- sign-in, migration, sign-out ----------
const __ngFmt = (n) => Number(n || 0).toLocaleString("uk");
// "1 зміна чекає", "2 зміни чекають", "5 змін чекають"
function __ngChanges(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} зміна чекає`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} зміни чекають`;
  return `${n} змін чекають`;
}
const __ngName = (id) => (Nr.get(id) && Nr.get(id).short) || id;

let __ngMigrating = false;
async function __ngOnSignedIn(session) {
  const uid = session.user.id;
  let a = __ngAcct();
  a.emails = a.emails || {};
  if (a.emails[uid] !== session.user.email) __ngAcctUpdate((x) => { x.emails = { ...(x.emails || {}), [uid]: session.user.email }; });
  a = __ngAcct();
  if (a.owner === uid) return __ngSyncNow();
  if (a.owner && a.owner !== uid) {
    // Someone else's numbers are on screen (they signed out offline): don't import them.
    __ngAcctUpdate((x) => { x.owner = uid; });
    __ngCountersWrite({});
    return __ngSyncNow();
  }
  // Guest progress on this device -> move it into the account.
  if (__ngMigrating) return;
  __ngMigrating = true;
  window.dispatchEvent(new Event("ngsync"));
  try {
    const sb = __ngSb();
    const local = __ngCountersRead();
    try {
      if (localStorage.getItem(Hu + "counters.premigration") == null && Object.keys(local).length)
        localStorage.setItem(Hu + "counters.premigration", JSON.stringify({ at: new Date().toISOString(), counters: local }));
    } catch {}
    let server;
    try { server = await __ngFetchTotals(sb); }
    catch { __ngAcctUpdate((x) => { x.err = Date.now(); }); return; } // offline: try again later, stay guest meanwhile
    const cur = __ngCountersRead(); // include taps made while we were fetching
    const withLocal = Object.keys(cur).filter((id) => (cur[id] && cur[id].total) > 0);
    const conflicts = withLocal.filter((id) => server[id] && server[id].total > 0);
    let mode = "larger";
    if (conflicts.length) {
      const lines = conflicts.map((id) => `• ${__ngName(id)}: на цьому пристрої ${__ngFmt(cur[id].total)}, в акаунті ${__ngFmt(server[id].total)}`);
      if (confirm(`В акаунті вже є числа:\n${lines.join("\n")}\n\nOK — залишити більше з двох (рекомендовано).\nСкасувати — інші варіанти.`)) mode = "larger";
      else mode = confirm("Додати числа з цього пристрою до акаунта?\n\nOK — додати разом.\nСкасувати — залишити тільки числа з акаунта.") ? "add" : "account";
    }
    a = __ngAcct();
    if (a.owner) return; // another tab finished first
    const evs = [];
    for (const id of withLocal) {
      const L = cur[id].total, S = (server[id] && server[id].total) || 0;
      const delta = !S ? L : mode === "add" ? L : mode === "larger" ? Math.max(0, L - S) : 0;
      if (delta > 0) evs.push(__ngEvent(a, id, "import", { delta }));
    }
    for (const id of Object.keys(cur)) {
      const t = cur[id] && cur[id].target;
      if (t && t !== __NG_DEFAULT_TARGET && !(server[id] && server[id].target_at)) evs.push(__ngEvent(a, id, "set_target", { target: t }));
      const wg = cur[id] && cur[id].weeklyGoal;
      if (wg && !(server[id] && server[id].weekly_goal_at)) evs.push(__ngEvent(a, id, "set_weekly_goal", { target: wg }));
    }
    // One write: owner + import events (never imported twice).
    a.owner = uid;
    a.outbox = a.outbox || {};
    a.outbox[uid] = [...__ngPending(a, uid), ...evs];
    a.server = a.server || {};
    a.server[uid] = server;
    delete a.needLogin;
    __ngAcctSave(a);
    try { localStorage.removeItem(Hu + "sync"); } catch {} // old key-based sync is replaced by the account
    __ngApplyDisplay(a, uid);
  } finally {
    __ngMigrating = false;
    window.dispatchEvent(new Event("ngsync"));
  }
  return __ngSyncNow();
}

async function __ngSignIn() {
  const sb = __ngSb();
  if (!sb) { alert("Не вдалося завантажити вхід. Перевірте інтернет і спробуйте ще раз."); return; }
  if (!navigator.onLine) { alert("Для входу потрібен інтернет."); return; }
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + "/", queryParams: { prompt: "select_account" } },
  });
  if (error) alert("Не вдалося увійти: " + error.message);
}

async function __ngSignOut() {
  const sb = __ngSb();
  await __ngSyncNow();
  const a = __ngAcct();
  const uid = a.owner;
  const n = __ngPending(a, uid).length;
  const msg = n
    ? `Ще не синхронізовано: ${n} (немає з’єднання). Вони залишаться на цьому пристрої і синхронізуються, коли ви знову увійдете.\n\nВийти?`
    : "Вийти з акаунта на цьому пристрої? Ваші числа збережені в акаунті.";
  if (!confirm(msg)) return;
  try { if (sb) await sb.auth.signOut({ scope: "local" }); } catch {}
  __ngAcctUpdate((x) => { x.owner = null; x.needLogin = false; });
  __ngCountersWrite({}); // the numbers live in the account; this device is a guest again
}

function __ngInitAuth() {
  const sb = __ngSb();
  if (!sb) return;
  sb.auth.onAuthStateChange((event, session) => {
    __ngSession = session;
    __ngAuthReady = true;
    window.dispatchEvent(new Event("ngsync"));
    // Don't call Supabase inside this callback (it can deadlock); defer.
    if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION"))
      setTimeout(() => __ngOnSignedIn(session), 0);
  });
  // Remove the one-time ?code= from the address bar after the OAuth redirect.
  if (/[?&]code=/.test(location.search)) {
    setTimeout(() => {
      try { history.replaceState(null, "", location.pathname + location.hash); } catch {}
    }, 2000);
  }
}

// ---------- the account line under the counter ----------
function __NgAccountRow() {
  const [, f] = X.useState(0);
  X.useEffect(() => {
    const h = () => f((n) => n + 1);
    window.addEventListener("ngsync", h);
    const t = setInterval(h, 30000);
    return () => { window.removeEventListener("ngsync", h); clearInterval(t); };
  }, []);
  const a = __ngAcct();
  const uid = a.owner;
  const pending = uid ? __ngPending(a, uid).length : 0;
  let text, cls = "", btn, onClick;
  if (__ngMigrating) { text = "Переносимо ваші числа в акаунт…"; }
  else if (!uid) {
    text = "Накопичення можуть втратитися, якщо ви не залоговані."; cls = "warn";
    btn = "Увійти через Google"; onClick = __ngSignIn;
  } else if (a.needLogin || (__ngAuthReady && !__ngSession)) {
    text = pending ? `Увійдіть знову, щоб синхронізувати (${pending})` : "Увійдіть знову, щоб синхронізувати";
    cls = "warn"; btn = "Увійти"; onClick = __ngSignIn;
  } else {
    const who = (a.emails && a.emails[uid]) || "";
    let st;
    if (pending && (a.err || !navigator.onLine)) st = `Без з’єднання · ${__ngChanges(pending)}`;
    else if (pending) st = "Синхронізація…";
    else if (a.okAt) {
      const d = new Date(a.okAt);
      st = "Синхронізовано " + (new Date().toDateString() === d.toDateString()
        ? d.toLocaleTimeString("uk", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("uk"));
    } else st = "Синхронізація…";
    text = who ? `${who} · ${st}` : st;
    btn = "Вийти"; onClick = __ngSignOut;
  }
  return o.jsxs("div", {
    className: "counter-sync",
    children: [
      o.jsx("span", { className: cls, children: text }),
      btn ? o.jsx("button", { type: "button", className: "linklike", onClick, children: btn }) : null,
    ],
  });
}

// ---------- background triggers ----------
// Practice reminders were removed: cancel any push subscription left in this browser.
(async () => {
  try {
    if (localStorage.getItem(Hu + "push") == null || !("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && reg.pushManager && (await reg.pushManager.getSubscription());
    if (sub) await sub.unsubscribe();
    localStorage.removeItem(Hu + "push");
  } catch {}
})();
(() => {
  __ngInitAuth();
  const go = () => { if (document.visibilityState === "visible") __ngSyncSoon(300); };
  window.addEventListener("online", go);
  window.addEventListener("focus", go);
  window.addEventListener("offline", () => window.dispatchEvent(new Event("ngsync")));
  document.addEventListener("visibilitychange", go);
  setInterval(go, 60000);
  // Another tab changed the numbers or the account state.
  window.addEventListener("storage", (e) => {
    if (e.key === Hu + "counters") Nf("counters");
    if (e.key === Hu + "acct") window.dispatchEvent(new Event("ngsync"));
  });
})();
