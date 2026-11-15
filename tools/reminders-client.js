// Practice reminders (Web Push) — the section in the "Aa" settings panel.
// Injected by tools/build.py after account-client.js; uses its __ngSb(),
// __ngAcct(), __ngSession, plus the bundle's Hu, o (jsx) and X (React).
//
// * Off by default. Permission is requested only when the user switches
//   reminders on.
// * Preferences (on/off, time, weekdays, IANA timezone) live in Supabase
//   (reminder_settings, one row per user). Each device has its own push
//   subscription (push_subscriptions).
// * Nothing here touches counting or counter sync.

const __NG_VAPID = "BJz2poZBJgyY5fwpJhmihNGy08WcTuqVuDH1D4-oYIA1maMQHzIDANMRCvd9IXLGroBelYA-9-4sHRrBDo0k2lw";
const __NG_DAYS = [[1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [7, "Нд"]];

function __ngTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}
// Same zone, old and new IANA spellings.
const __NG_TZ_ALIASES = {
  "Europe/Kiev": "Europe/Kyiv", "Europe/Kyiv": "Europe/Kiev",
  "Europe/Uzhgorod": "Europe/Kyiv", "Europe/Zaporozhye": "Europe/Kyiv",
  "Asia/Calcutta": "Asia/Kolkata", "Asia/Kolkata": "Asia/Calcutta",
  "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Ho_Chi_Minh": "Asia/Saigon",
  "Asia/Katmandu": "Asia/Kathmandu", "Asia/Kathmandu": "Asia/Katmandu",
  "Asia/Rangoon": "Asia/Yangon", "Asia/Yangon": "Asia/Rangoon",
};
function __ngTzAlias(tz) { return __NG_TZ_ALIASES[tz] || null; }
function __ngIsIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function __ngStandalone() {
  return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
}
function __ngPushSupport() {
  if (__ngIsIOS() && !__ngStandalone()) return "ios-home";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}
function __ngKeyBytes(b64) {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function __ngSwReg() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, r) => setTimeout(() => r(new Error("service worker not ready")), 10000)),
  ]);
}
function __ngPushFlag(v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem(Hu + "push") || "null");
    v ? localStorage.setItem(Hu + "push", JSON.stringify(v)) : localStorage.removeItem(Hu + "push");
  } catch { return null; }
}

// Subscribe this device and register it for the signed-in user.
async function __ngPushSubscribe() {
  const sb = __ngSb();
  const reg = await __ngSwReg();
  let sub = await reg.pushManager.getSubscription();
  const opts = { userVisibleOnly: true, applicationServerKey: __ngKeyBytes(__NG_VAPID) };
  if (!sub) {
    try { sub = await reg.pushManager.subscribe(opts); }
    catch (e) {
      // A subscription made with another key: replace it.
      const old = await reg.pushManager.getSubscription();
      if (!old) throw e;
      await old.unsubscribe();
      sub = await reg.pushManager.subscribe(opts);
    }
  }
  const j = sub.toJSON();
  const { error } = await sb.rpc("register_push_subscription", {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
  __ngPushFlag({ endpoint: j.endpoint, uid: __ngAcct().owner });
}

// Stop notifications on this device (and forget it on the server).
async function __ngPushUnsubscribe() {
  if (!__ngPushFlag() || !("serviceWorker" in navigator)) { __ngPushFlag(null); return; } // never subscribed here
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && reg.pushManager && (await reg.pushManager.getSubscription());
    if (sub) {
      const sb = __ngSb();
      if (sb && __ngSession) await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (e) { console.warn("unsubscribe", e); }
  __ngPushFlag(null);
}

// On app start: if this device was subscribed, keep the subscription valid
// (browsers can expire or rotate it) and keep the stored timezone current.
async function __ngPushMaintain() {
  const flag = __ngPushFlag();
  const uid = __ngAcct().owner;
  if (!flag || !uid || !__ngSession || !navigator.onLine || __ngPushSupport() !== "ok") return;
  if (flag.uid !== uid) { await __ngPushUnsubscribe(); return; }
  if (Notification.permission !== "granted") { __ngPushFlag(null); return; }
  try {
    const reg = await __ngSwReg();
    const sub = await reg.pushManager.getSubscription();
    if (!sub || sub.endpoint !== flag.endpoint) {
      // The browser dropped or rotated the subscription: forget the old one, register the new one.
      await __ngSb().from("push_subscriptions").delete().eq("endpoint", flag.endpoint);
      await __ngPushSubscribe();
    }
    const sb = __ngSb();
    const { data } = await sb.from("reminder_settings").select("enabled,timezone").maybeSingle();
    const tz = __ngTz();
    if (data && data.enabled && data.timezone !== tz && data.timezone !== __ngTzAlias(tz)) {
      const { error } = await sb.from("reminder_settings").update({ timezone: tz }).eq("user_id", uid);
      if (error && error.code === "22023" && __ngTzAlias(tz))
        await sb.from("reminder_settings").update({ timezone: __ngTzAlias(tz) }).eq("user_id", uid);
    }
  } catch (e) { console.warn("push maintain", e); }
}

function __NgReminders() {
  const [, rerender] = X.useState(0);
  const [st, setSt] = X.useState({ loading: true });
  const [msg, setMsg] = X.useState(null);
  const [busy, setBusy] = X.useState(false);
  const saveTimer = X.useRef(0);
  const uid = __ngAcct().owner;
  const signedIn = !!(uid && __ngSession);
  const support = __ngPushSupport();

  const load = X.useCallback(async () => {
    if (!signedIn || !navigator.onLine) { setSt({ loading: false }); return; }
    try {
      const sb = __ngSb();
      const { data, error } = await sb.from("reminder_settings").select("enabled,remind_at,weekdays,timezone").maybeSingle();
      if (error) throw error;
      let device = false;
      if (support === "ok") {
        try {
          const sub = await (await __ngSwReg()).pushManager.getSubscription();
          const flag = __ngPushFlag();
          device = !!(sub && flag && flag.endpoint === sub.endpoint && flag.uid === uid && Notification.permission === "granted");
        } catch {}
      }
      setSt({
        loading: false, loaded: true, device,
        enabled: !!(data && data.enabled),
        time: data ? String(data.remind_at).slice(0, 5) : "07:00",
        days: data ? data.weekdays : [1, 2, 3, 4, 5, 6, 7],
      });
    } catch (e) { console.warn(e); setSt({ loading: false, failed: true }); }
  }, [signedIn, uid, support]);

  X.useEffect(() => { load(); }, [load]);
  X.useEffect(() => {
    const h = () => rerender((n) => n + 1);
    window.addEventListener("ngsync", h);
    window.addEventListener("online", load);
    return () => { window.removeEventListener("ngsync", h); window.removeEventListener("online", load); };
  }, [load]);

  async function save(next) {
    const sb = __ngSb();
    const put = (timezone) => sb.from("reminder_settings").upsert(
      { enabled: next.enabled, remind_at: next.time, weekdays: next.days, timezone },
      { onConflict: "user_id" });
    let { error } = await put(__ngTz());
    // Browsers and databases may know a zone under different names (Kiev/Kyiv).
    if (error && error.code === "22023" && __ngTzAlias(__ngTz())) ({ error } = await put(__ngTzAlias(__ngTz())));
    if (error) throw error;
  }
  function saveSoon(next) {
    setSt(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(next).then(() => setMsg(null)).catch(() => setMsg("Не вдалося зберегти. Перевірте з’єднання.")), 600);
  }

  async function enableHere(alsoTurnOn) {
    setMsg(null);
    if (support === "ios-home") { setMsg("ios"); return; }
    if (support !== "ok") { setMsg("Цей браузер не підтримує сповіщення."); return; }
    if (Notification.permission === "denied") { setMsg("Сповіщення для цього сайту заблоковані. Дозвольте їх у налаштуваннях браузера."); return; }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission(); // asked only now, after the user's choice
      if (perm !== "granted") { setMsg("Без дозволу на сповіщення нагадування не працюватимуть."); return; }
      await __ngPushSubscribe();
      const next = { ...st, enabled: true, device: true };
      if (alsoTurnOn || !st.enabled) await save(next);
      setSt(next);
      setMsg("Нагадування увімкнено на цьому пристрої.");
    } catch (e) {
      console.warn(e);
      setMsg("Не вдалося увімкнути нагадування. Спробуйте ще раз.");
    } finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true); setMsg(null);
    try {
      const next = { ...st, enabled: false, device: false };
      await save(next);
      await __ngPushUnsubscribe();
      setSt(next);
    } catch { setMsg("Не вдалося зберегти. Перевірте з’єднання."); }
    finally { setBusy(false); }
  }
  async function sendTest() {
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await __ngSb().functions.invoke("reminders", { body: { action: "test" } });
      if (error) {
        let m = "";
        try { m = (await error.context.json()).error; } catch {}
        setMsg(m === "too many tests, wait a moment" ? "Зачекайте кілька секунд перед наступним тестом." : "Не вдалося надіслати тестове сповіщення.");
      } else if (!data.devices) setMsg("Немає пристроїв, підписаних на нагадування.");
      else setMsg(data.sent ? `Тестове сповіщення надіслано (пристроїв: ${data.sent}).` : "Не вдалося доставити сповіщення. Увімкніть нагадування на цьому пристрої ще раз.");
    } catch { setMsg("Не вдалося надіслати тестове сповіщення."); }
    finally { setBusy(false); }
  }

  const iosHelp = o.jsxs("div", {
    className: "rem-note",
    children: [
      "На iPhone та iPad нагадування працюють лише із застосунку на початковому екрані (iOS 16.4 або новіша): ",
      "у Safari натисніть «Поділитися» → «На початковий екран», відкрийте Ньондро з цієї іконки й увімкніть нагадування тут.",
    ],
  });

  let body;
  if (!signedIn) body = o.jsx("div", { className: "rem-note", children: "Щоб отримувати нагадування, увійдіть через Google (кнопка під лічильником на головному екрані)." });
  else if (!navigator.onLine) body = o.jsx("div", { className: "rem-note", children: "Немає з’єднання. Налаштування нагадувань доступні онлайн." });
  else if (st.loading) body = o.jsx("div", { className: "rem-note", children: "Завантаження…" });
  else if (st.failed) body = o.jsx("div", { className: "rem-note", children: "Не вдалося завантажити налаштування." });
  else body = o.jsxs(o.Fragment, {
    children: [
      st.enabled && o.jsxs(o.Fragment, {
        children: [
          o.jsxs("label", {
            className: "rem-row",
            children: [o.jsx("span", { children: "Час" }), o.jsx("input", {
              type: "time", step: 300, value: st.time, disabled: busy,
              onChange: (e) => e.target.value && saveSoon({ ...st, time: e.target.value }),
            })],
          }),
          o.jsx("div", {
            className: "seg rem-days", role: "group", "aria-label": "Дні тижня",
            children: __NG_DAYS.map(([d, l]) => o.jsx("button", {
              type: "button", "aria-pressed": st.days.includes(d), disabled: busy,
              onClick: () => {
                const days = st.days.includes(d) ? st.days.filter((x) => x !== d) : [...st.days, d].sort();
                if (days.length) saveSoon({ ...st, days });
              },
              children: l,
            }, d)),
          }),
          o.jsx("div", { className: "rem-note", children: `Часовий пояс: ${__ngTz()} (визначено автоматично)` }),
          !st.device && support === "ios-home" && iosHelp,
          !st.device && support !== "ios-home" && o.jsxs("div", {
            className: "rem-row",
            children: [o.jsx("span", { className: "rem-note", children: "Цей пристрій не отримує нагадувань." }),
              o.jsx("button", { type: "button", className: "linklike", disabled: busy, onClick: () => enableHere(false), children: "Отримувати і тут" })],
          }),
          o.jsx("button", { type: "button", className: "linklike rem-test", disabled: busy, onClick: sendTest, children: "Надіслати тестове сповіщення" }),
        ],
      }),
      support === "ios-home" && !st.enabled && iosHelp,
    ],
  });

  return o.jsxs("div", {
    className: "field rem",
    children: [
      o.jsxs("label", {
        className: "toggle",
        children: [
          o.jsxs("span", { children: ["Нагадування про практику", o.jsx("small", { children: "Сповіщення у вибраний час і дні" })] }),
          o.jsx("input", {
            type: "checkbox", checked: !!st.enabled, disabled: !signedIn || !st.loaded || busy,
            onChange: (e) => (e.target.checked ? enableHere(true) : turnOff()),
          }),
        ],
      }),
      body,
      msg === "ios" ? iosHelp : msg && o.jsx("div", { className: "rem-note", role: "status", children: msg }),
    ],
  });
}

// Keep this device's subscription healthy once the session is known.
window.addEventListener("ngsync", () => {
  if (__ngSession && !window.__ngPushChecked) { window.__ngPushChecked = true; setTimeout(__ngPushMaintain, 3000); }
});
