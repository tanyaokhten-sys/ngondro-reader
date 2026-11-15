// The counter card on the home screen (replaces the original compiled Kf).
// Injected by tools/build.py after account-client.js. Uses the bundle's
// Lf (stored counters hook), qs (practice counter with defaults), Ul (number
// formatting), Nr (practices), o (jsx), X (React) and account-client's
// __ngAcct/__ngEvent/__ngPending/__ngApplyDisplay/__ngCountersRead/... .
//
// Every action is explicit and recorded once:
//   add     +n (buttons or "Інше…")
//   adjust  correction to a new total; stored as the signed difference, so a
//           concurrent change from another device is never overwritten
//   undo    cancels the last action recorded on this device
//   target  goal change
// Signed in: the action becomes an event with its own id in the outbox
// (uploaded once, retries ignored); the number shown is server total +
// pending events. Signed out: the local total changes, as before.
// The device's log keeps each action (with its event id) for undo and "today".

const __NG_MINUS = "−";
const __ngSigned = (n) => (n < 0 ? __NG_MINUS + Ul(-n) : "+" + Ul(n));

function __ngCounterDo(id, act) {
  const a = __ngAcct();
  const uid = a.owner || null;
  const all = __ngCountersRead();
  const c = { total: 0, target: __NG_DEFAULT_TARGET, log: [], ...(all[id] || {}) };
  c.log = Array.isArray(c.log) ? c.log.slice() : [];
  let ev = null, entry = null;
  const at = Date.now();

  if (act.type === "add") {
    if (!(act.n > 0)) return null;
    ev = __ngEvent(a, id, "add", { delta: act.n });
    entry = { n: act.n, at, id: ev.id, k: "add", u: uid };
    c.total += act.n;
  } else if (act.type === "adjust") {
    const to = act.to, before = c.total, delta = to - before;
    if (!(to >= 0) || delta === 0) return null;
    ev = __ngEvent(a, id, "adjust", { delta, before, after: to, note: "manual correction" });
    entry = { n: delta, at, id: ev.id, k: "adjust", u: uid };
    c.total = to;
  } else if (act.type === "undo") {
    // The last action, or a specific earlier one from this device's history.
    const idx = act.entryId ? c.log.findIndex((e) => e.id === act.entryId) : c.log.length - 1;
    if (idx < 0) return null;
    const last = c.log.splice(idx, 1)[0];
    if (!last) return null;
    const before = c.total;
    c.total = Math.max(0, c.total - last.n);
    if (uid) {
      if (last.id && last.u === uid && (last.k === "add" || last.k === "adjust" || !last.k))
        ev = __ngEvent(a, id, "undo", { delta: -last.n, undoes: last.id, local: { _orig_at: last.at, _orig_k: last.k || "add" } });
      else if (last.n) // recorded before signing in: cancel it with a correction
        ev = __ngEvent(a, id, "adjust", { delta: -last.n, before, after: c.total, note: "undo of an action made before sign-in" });
    }
  } else if (act.type === "weekly") {
    // Optional weekly goal; 0 turns it off. Lifetime target and total are untouched.
    const g = act.goal > 0 ? act.goal : null;
    if ((c.weeklyGoal || null) === g) return null;
    c.weeklyGoal = g;
    if (uid) ev = __ngEvent(a, id, "set_weekly_goal", { target: g || 0 });
  } else if (act.type === "target") {
    if (!(act.target > 0) || act.target === c.target) return null;
    c.target = act.target;
    if (uid) ev = __ngEvent(a, id, "set_target", { target: act.target });
  } else return null;

  if (entry) c.log = [...c.log, entry].slice(-500);
  all[id] = c;
  if (uid && ev) {
    // Outbox first (one write), then the device copy; the total shown is
    // recomputed as server total + pending events.
    a.outbox = a.outbox || {};
    a.outbox[uid] = [...__ngPending(a, uid), ev];
    __ngAcctSave(a);
    try { localStorage.setItem(Hu + "counters", JSON.stringify(all)); } catch {}
    __ngApplyDisplay(a, uid);
    __ngSyncSoon();
  } else {
    __ngCountersWrite(all);
  }
  return { entry, before: act.type === "undo" ? null : undefined };
}

function __ngToday(c) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return (c.log || []).filter((e) => e.at >= d.getTime() && e.k !== "adjust").reduce((s, e) => s + e.n, 0);
}
const __ngNum = (s) => { const n = parseInt(String(s).replace(/\D/g, ""), 10); return Number.isFinite(n) ? n : null; };

const __ngWhen = (t) => {
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString("uk", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `сьогодні, ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `учора, ${time}`;
  return `${d.toLocaleDateString("uk", { day: "numeric", month: "long" })}, ${time}`;
};
const __ngWhat = (e) => (e.k === "adjust" ? `Виправлення ${__ngSigned(e.n)}` : __ngSigned(e.n));

// The counter card: only the counting buttons are prominent. Undo appears
// briefly after an addition; everything else lives in the ⋯ panel.
function __NgCounter({ id }) {
  const [all] = Lf();
  const c = qs(all, id);
  const [mode, setMode] = X.useState("none"); // none | custom | target | undo
  const [val, setVal] = X.useState("");
  const [flash, setFlash] = X.useState(null);  // { text, entryId, undoable }
  const [menu, setMenu] = X.useState(false);
  const name = Nr.get(id).short;
  const log = c.log || [];
  const pct = c.target > 0 ? Math.min(100, (c.total / c.target) * 100) : 0;
  const today = __ngToday(c);
  const n = __ngNum(val);

  // The undo offer fades after 20 s so it is not tapped by accident later.
  X.useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 20000);
    return () => clearTimeout(t);
  }, [flash]);

  const open = (m, v = "") => { setMode(m); setVal(v); setFlash(null); };
  const close = () => { setMode("none"); setVal(""); };
  const add = (k) => {
    const r = __ngCounterDo(id, { type: "add", n: k });
    if (r && r.entry) setFlash({ text: `Додано +${Ul(k)}`, entryId: r.entry.id, n: k });
  };
  const flashEntry = flash && log.find((e) => e.id === flash.entryId);

  let preview = null, valid = false;
  if (mode === "custom" && n > 0) {
    valid = n <= 100000000;
    preview = o.jsxs(o.Fragment, { children: [Ul(c.total), " + ", Ul(n), " = ", o.jsx("b", { children: Ul(c.total + n) })] });
  } else if (mode === "target" && n > 0) {
    valid = n !== c.target && n <= 100000000;
  }
  function submit(e) {
    e.preventDefault();
    if (!valid) return;
    if (mode === "custom") add(n);
    else if (mode === "target") __ngCounterDo(id, { type: "target", target: n });
    close();
  }
  const form = mode === "custom" || mode === "target";
  const labels = { custom: ["Кількість", "Додати"], target: ["Ціль", "Зберегти"] };

  return o.jsxs("section", {
    className: "counter",
    "aria-label": `Лічильник: ${name}`,
    children: [
      o.jsxs("div", {
        className: "counter-head",
        children: [
          o.jsxs("span", { className: "eyebrow", children: ["Лічильник · ", name] }),
          o.jsxs("span", {
            className: "counter-head-r",
            children: [
              today > 0 && o.jsxs("span", { className: "counter-today", children: ["сьогодні +", Ul(today)] }),
              o.jsx("button", {
                type: "button", className: "counter-more", onClick: () => { close(); setFlash(null); setMenu(true); },
                "aria-label": "Історія та коригування", "aria-haspopup": "dialog", title: "Історія та коригування",
                children: o.jsxs("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true,
                  children: [o.jsx("circle", { cx: 5, cy: 12, r: 1.8 }), o.jsx("circle", { cx: 12, cy: 12, r: 1.8 }), o.jsx("circle", { cx: 19, cy: 12, r: 1.8 })] }),
              }),
            ],
          }),
        ],
      }),
      o.jsxs("div", {
        className: "counter-num",
        children: [
          o.jsx("span", { className: "big", "aria-live": "polite", children: Ul(c.total) }),
          o.jsxs("button", {
            className: "of",
            onClick: () => (mode === "target" ? close() : open("target", String(c.target))),
            "aria-label": `Ціль ${c.target}. Змінити ціль`,
            children: ["/ ", Ul(c.target)],
          }),
        ],
      }),
      o.jsx("div", { className: "bar", "aria-hidden": "true", children: o.jsx("div", { style: { width: `${pct}%` } }) }),
      c.weeklyGoal > 0 && o.jsx(__NgWeekLine, { id, c }),

      mode === "none" && o.jsxs("div", {
        className: "counter-btns counter-btns-big",
        children: [
          o.jsx("button", { onClick: () => add(21), children: "+21" }),
          o.jsx("button", { onClick: () => add(108), children: "+108" }),
          o.jsx("button", { onClick: () => open("custom"), children: "Інше…" }),
        ],
      }),
      form && o.jsxs("form", {
        className: "counter-form",
        onSubmit: submit,
        children: [
          o.jsx("label", { className: "sr-only", htmlFor: "cnt", children: labels[mode][0] }),
          o.jsx("input", { id: "cnt", inputMode: "numeric", pattern: "[0-9 ]*", autoFocus: true, value: val, onChange: (e) => setVal(e.target.value), placeholder: labels[mode][0] }),
          o.jsx("button", { type: "submit", disabled: !valid, children: labels[mode][1] }),
          o.jsx("button", { type: "button", onClick: close, "aria-label": "Скасувати", children: "✕" }),
        ],
      }),
      form && o.jsx("div", { className: "counter-preview", "aria-live": "polite", children: preview || (mode === "target" ? "Нова ціль для цієї практики" : "Скільки додати") }),

      // Contextual undo, below a divider, only right after an addition.
      mode === "none" && flash && flashEntry && o.jsxs("div", {
        className: "counter-undo",
        children: [
          o.jsx("span", { children: flash.text }),
          o.jsx("button", { type: "button", className: "linklike", onClick: () => setMode("undo"), children: "Скасувати" }),
        ],
      }),
      mode === "undo" && flashEntry && o.jsxs("div", {
        className: "counter-undo counter-confirm",
        role: "group", "aria-label": "Підтвердження скасування",
        children: [
          o.jsxs("span", { children: [`Скасувати ${__ngWhat(flashEntry)}? `, Ul(c.total), " → ", o.jsx("b", { children: Ul(Math.max(0, c.total - flashEntry.n)) })] }),
          o.jsxs("span", {
            className: "counter-links",
            children: [
              o.jsx("button", { type: "button", className: "linklike", onClick: () => { __ngCounterDo(id, { type: "undo", entryId: flashEntry.id }); setFlash(null); close(); }, children: "Так, скасувати" }),
              o.jsx("button", { type: "button", className: "linklike", onClick: close, children: "Ні" }),
            ],
          }),
        ],
      }),
      o.jsx(__NgAccountRow, {}),
      menu && o.jsx(__NgHistory, { id, onClose: () => setMenu(false) }),
    ],
  });
}

// «Історія та коригування»: review this device's actions, undo any of them,
// or correct the total. Every change needs an explicit confirmation.
function __NgHistory({ id, onClose }) {
  const [all] = Lf();
  const c = qs(all, id);
  const [step, setStep] = X.useState("list"); // list | fix | fixConfirm | goal
  const [val, setVal] = X.useState("");
  const [ask, setAsk] = X.useState(null);      // entry id awaiting undo confirmation
  const [done, setDone] = X.useState(null);
  const ref = X.useRef(null);
  const n = __ngNum(val);
  const entries = (c.log || []).slice(-30).reverse();
  const validFix = n !== null && n !== c.total && n <= 100000000;

  X.useEffect(() => {
    ref.current && ref.current.focus();
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  if (step === "goal") return o.jsx(__NgWeeklyGoalPanel, { id, c, onBack: () => setStep("list"), onClose });

  const change = o.jsxs(o.Fragment, { children: [Ul(c.total), " → ", o.jsx("b", { children: Ul(n ?? 0) }), n !== null ? ` (${__ngSigned(n - c.total)})` : ""] });

  return o.jsxs(o.Fragment, {
    children: [
      o.jsx("div", { className: "scrim", onClick: onClose }),
      o.jsxs("div", {
        className: "sheet hist", role: "dialog", "aria-modal": "true", "aria-label": "Історія та коригування", tabIndex: -1, ref,
        children: [
          o.jsx("div", { className: "grab", "aria-hidden": "true" }),
          o.jsxs("div", {
            className: "hist-top",
            children: [
              o.jsxs("div", { children: [o.jsx("div", { className: "eyebrow", children: "Історія та коригування" }), o.jsx("div", { className: "hist-name", children: Nr.get(id).short })] }),
              o.jsx("button", { type: "button", className: "linklike", onClick: onClose, children: "Готово" }),
            ],
          }),

          // Total + correction
          o.jsxs("div", {
            className: "hist-total",
            children: [
              o.jsxs("div", { className: "hist-row", children: [
                o.jsxs("span", { children: [o.jsx("span", { className: "hist-label", children: "Загальне число" }), o.jsx("span", { className: "hist-big", children: Ul(c.total) })] }),
                step === "list" && o.jsx("button", { type: "button", className: "linklike", onClick: () => { setStep("fix"); setVal(String(c.total)); setAsk(null); setDone(null); }, children: "Виправити" }),
              ] }),
              step === "fix" && o.jsxs(o.Fragment, { children: [
                o.jsxs("form", {
                  className: "counter-form",
                  onSubmit: (e) => { e.preventDefault(); validFix && setStep("fixConfirm"); },
                  children: [
                    o.jsx("label", { className: "sr-only", htmlFor: "fixv", children: "Правильне загальне число" }),
                    o.jsx("input", { id: "fixv", inputMode: "numeric", pattern: "[0-9 ]*", autoFocus: true, value: val, onChange: (e) => setVal(e.target.value), placeholder: "Правильне загальне число" }),
                    o.jsx("button", { type: "submit", disabled: !validFix, children: "Далі" }),
                    o.jsx("button", { type: "button", onClick: () => setStep("list"), "aria-label": "Скасувати", children: "✕" }),
                  ],
                }),
                o.jsx("div", { className: "counter-preview", children: n === null ? "Введіть правильне загальне число" : n === c.total ? "Без змін" : change }),
              ] }),
              step === "fixConfirm" && o.jsxs("div", { className: "hist-confirm", children: [
                o.jsxs("p", { children: ["Змінити загальне число: ", change, "?"] }),
                o.jsx("p", { className: "hist-note", children: "Виправлення буде записано в історію; його можна скасувати." }),
                o.jsxs("span", { className: "counter-links", children: [
                  o.jsx("button", { type: "button", className: "linklike", onClick: () => {
                    const before = c.total;
                    if (__ngCounterDo(id, { type: "adjust", to: n })) setDone(`Виправлено: ${Ul(before)} → ${Ul(n)}`);
                    setStep("list"); setVal("");
                  }, children: "Так, змінити" }),
                  o.jsx("button", { type: "button", className: "linklike", onClick: () => setStep("fix"), children: "Назад" }),
                ] }),
              ] }),
              done && step === "list" && o.jsx("div", { className: "counter-preview", role: "status", children: done }),
            ],
          }),

          // Weekly goal (settings in its own view)
          o.jsxs("div", { className: "hist-row hist-goal", children: [
            o.jsxs("span", { children: [
              o.jsx("span", { className: "hist-label", children: "Тижнева мета" }),
              o.jsx("span", { children: c.weeklyGoal ? `${Ul(c.weeklyGoal)} на тиждень · цього тижня ${Ul(__ngWeekDone(id, c))}` : "Не встановлено" }),
            ] }),
            o.jsx("button", { type: "button", className: "linklike", onClick: () => { setStep("goal"); setAsk(null); setDone(null); }, children: c.weeklyGoal ? "Змінити" : "Встановити" }),
          ] }),

          // This device's recent actions
          o.jsx("div", { className: "eyebrow", children: "Останні дії на цьому пристрої" }),
          entries.length === 0 && o.jsx("p", { className: "hist-note", children: "Ще немає дій." }),
          entries.length > 0 && o.jsx("ul", {
            className: "hist-list",
            children: entries.map((e) => o.jsxs("li", {
              children: [
                o.jsxs("div", { className: "hist-row", children: [
                  o.jsxs("span", { children: [o.jsx("span", { className: e.k === "adjust" ? "hist-what adj" : "hist-what", children: __ngWhat(e) }), o.jsx("span", { className: "hist-when", children: __ngWhen(e.at) })] }),
                  ask !== e.id && o.jsx("button", { type: "button", className: "linklike", onClick: () => { setAsk(e.id); setDone(null); setStep("list"); }, children: "Скасувати" }),
                ] }),
                ask === e.id && o.jsxs("div", { className: "hist-confirm", children: [
                  o.jsxs("span", { children: [`Скасувати ${__ngWhat(e).toLowerCase()}? `, Ul(c.total), " → ", o.jsx("b", { children: Ul(Math.max(0, c.total - e.n)) })] }),
                  o.jsxs("span", { className: "counter-links", children: [
                    o.jsx("button", { type: "button", className: "linklike", onClick: () => { __ngCounterDo(id, { type: "undo", entryId: e.id }); setAsk(null); setDone("Скасовано"); }, children: "Так, скасувати" }),
                    o.jsx("button", { type: "button", className: "linklike", onClick: () => setAsk(null), children: "Ні" }),
                  ] }),
                ] }),
              ],
            }, e.id || e.at)),
          }),
          o.jsx("p", { className: "hist-note", children: "Дії з інших пристроїв тут не показані — загальне число можна виправити будь-коли." }),
        ],
      }),
    ],
  });
}

// Subtle weekly line on the card. No streaks, no judgement — just this week.
function __NgWeekLine({ id, c }) {
  const [, tick] = X.useState(0);
  X.useEffect(() => {
    const h = () => tick((n) => n + 1);
    window.addEventListener("ngsync", h);
    const t = setInterval(h, 60000); // a new week starts on Monday without reopening
    return () => { window.removeEventListener("ngsync", h); clearInterval(t); };
  }, []);
  const done = __ngWeekDone(id, c);
  const pct = Math.min(100, (done / c.weeklyGoal) * 100);
  return o.jsxs("div", {
    className: "counter-week",
    children: [
      o.jsxs("span", { children: ["Цей тиждень: ", Ul(done), " з ", Ul(c.weeklyGoal)] }),
      o.jsx("div", { className: "bar bar-week", "aria-hidden": "true", children: o.jsx("div", { style: { width: `${pct}%` } }) }),
    ],
  });
}

// Weekly goal settings: suggested 108 / 500 / 1 000, a custom value, or off.
function __NgWeeklyGoalPanel({ id, c, onBack, onClose }) {
  const [custom, setCustom] = X.useState(false);
  const [val, setVal] = X.useState("");
  const n = __ngNum(val);
  const g = c.weeklyGoal || null;
  const presets = [108, 500, 1000];
  const set = (goal) => { __ngCounterDo(id, { type: "weekly", goal }); setCustom(false); setVal(""); };
  const validCustom = n > 0 && n <= 1000000 && n !== g;
  return o.jsxs(o.Fragment, {
    children: [
      o.jsx("div", { className: "scrim", onClick: onClose }),
      o.jsxs("div", {
        className: "sheet hist", role: "dialog", "aria-modal": "true", "aria-label": "Тижнева мета",
        children: [
          o.jsx("div", { className: "grab", "aria-hidden": "true" }),
          o.jsxs("div", { className: "hist-top", children: [
            o.jsxs("div", { children: [o.jsx("div", { className: "eyebrow", children: "Тижнева мета" }), o.jsx("div", { className: "hist-name", children: Nr.get(id).short })] }),
            o.jsx("button", { type: "button", className: "linklike", onClick: onBack, children: "Назад" }),
          ] }),
          o.jsx("p", { className: "hist-note", children: "Необов’язкова мета на тиждень — з понеділка до неділі, за часовим поясом цього пристрою. Рахуються лише додавання; загальне число не скидається." }),
          o.jsxs("div", { className: "seg goal-seg", role: "group", "aria-label": "Тижнева мета", children: [
            ...presets.map((p) => o.jsx("button", { type: "button", "aria-pressed": g === p && !custom, onClick: () => set(p), children: Ul(p) }, p)),
            o.jsx("button", { type: "button", "aria-pressed": custom || (g !== null && !presets.includes(g)), onClick: () => { setCustom(true); setVal(g && !presets.includes(g) ? String(g) : ""); }, children: g && !presets.includes(g) && !custom ? Ul(g) : "Інше…" }, "custom"),
          ] }),
          custom && o.jsxs("form", {
            className: "counter-form",
            onSubmit: (e) => { e.preventDefault(); validCustom && set(n); },
            children: [
              o.jsx("label", { className: "sr-only", htmlFor: "wgoal", children: "Своя тижнева мета" }),
              o.jsx("input", { id: "wgoal", inputMode: "numeric", pattern: "[0-9 ]*", autoFocus: true, value: val, onChange: (e) => setVal(e.target.value), placeholder: "Кількість на тиждень" }),
              o.jsx("button", { type: "submit", disabled: !validCustom, children: "Зберегти" }),
              o.jsx("button", { type: "button", onClick: () => setCustom(false), "aria-label": "Скасувати", children: "✕" }),
            ],
          }),
          o.jsx("div", { className: "counter-preview", "aria-live": "polite", children: g ? `Цього тижня: ${Ul(__ngWeekDone(id, c))} з ${Ul(g)}` : "Мету не встановлено." }),
          g && o.jsx("button", { type: "button", className: "linklike goal-off", onClick: () => set(0), children: "Вимкнути тижневу мету" }),
        ],
      }),
    ],
  });
}
