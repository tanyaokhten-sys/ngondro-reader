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
    const last = c.log.pop();
    if (!last) return null;
    const before = c.total;
    c.total = Math.max(0, c.total - last.n);
    if (uid) {
      if (last.id && last.u === uid && (last.k === "add" || last.k === "adjust" || !last.k))
        ev = __ngEvent(a, id, "undo", { delta: -last.n, undoes: last.id });
      else if (last.n) // recorded before signing in: cancel it with a correction
        ev = __ngEvent(a, id, "adjust", { delta: -last.n, before, after: c.total, note: "undo of an action made before sign-in" });
    }
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

function __NgCounter({ id }) {
  const [all] = Lf();
  const c = qs(all, id);
  const [mode, setMode] = X.useState("none"); // none | custom | fix | target | undo
  const [val, setVal] = X.useState("");
  const [flash, setFlash] = X.useState(null);  // text about the action just done
  const name = Nr.get(id).short;
  const log = c.log || [];
  const last = log[log.length - 1];
  const pct = c.target > 0 ? Math.min(100, (c.total / c.target) * 100) : 0;
  const today = __ngToday(c);
  const n = __ngNum(val);

  const open = (m, v = "") => { setMode(m); setVal(v); setFlash(null); };
  const close = () => { setMode("none"); setVal(""); };
  const add = (k) => { if (__ngCounterDo(id, { type: "add", n: k })) setFlash(`Додано +${Ul(k)}`); };

  // What the form would do, shown before confirming.
  let preview = null, valid = false;
  if (mode === "custom" && n > 0) {
    valid = n <= 100000000;
    preview = o.jsxs(o.Fragment, { children: [Ul(c.total), " + ", Ul(n), " = ", o.jsx("b", { children: Ul(c.total + n) })] });
  } else if (mode === "fix" && n !== null) {
    valid = n !== c.total && n <= 100000000;
    preview = n === c.total ? "Без змін" : o.jsxs(o.Fragment, { children: [Ul(c.total), " → ", o.jsx("b", { children: Ul(n) }), ` (${__ngSigned(n - c.total)})`] });
  } else if (mode === "target" && n > 0) {
    valid = n !== c.target && n <= 100000000;
  }

  function submit(e) {
    e.preventDefault();
    if (!valid) return;
    if (mode === "custom") add(n);
    else if (mode === "fix") {
      const before = c.total;
      if (__ngCounterDo(id, { type: "adjust", to: n })) setFlash(`Виправлено: ${Ul(before)} → ${Ul(n)}`);
    } else if (mode === "target") __ngCounterDo(id, { type: "target", target: n });
    close();
  }
  function undo() {
    if (__ngCounterDo(id, { type: "undo" })) setFlash("Скасовано");
    close();
  }

  const lastLabel = last ? (last.k === "adjust" ? `виправлення ${__ngSigned(last.n)}` : __ngSigned(last.n)) : "";
  const form = mode === "custom" || mode === "fix" || mode === "target";
  const labels = { custom: ["Кількість", "Додати"], fix: ["Правильне загальне число", "Зберегти"], target: ["Ціль", "Зберегти"] };

  return o.jsxs("section", {
    className: "counter",
    "aria-label": `Лічильник: ${name}`,
    children: [
      o.jsxs("div", {
        className: "counter-head",
        children: [
          o.jsxs("span", { className: "eyebrow", children: ["Лічильник · ", name] }),
          today > 0 && o.jsxs("span", { style: { fontSize: 13, color: "var(--muted)" }, children: ["сьогодні +", Ul(today)] }),
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

      mode === "none" && o.jsxs("div", {
        className: "counter-btns",
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
          o.jsx("input", {
            id: "cnt", inputMode: "numeric", pattern: "[0-9 ]*", autoFocus: true, value: val,
            onChange: (e) => setVal(e.target.value), placeholder: labels[mode][0],
          }),
          o.jsx("button", { type: "submit", disabled: !valid, children: labels[mode][1] }),
          o.jsx("button", { type: "button", onClick: close, "aria-label": "Скасувати", children: "✕" }),
        ],
      }),
      form && o.jsx("div", {
        className: "counter-preview", "aria-live": "polite",
        children: preview || (mode === "fix" ? "Введіть правильне загальне число" : mode === "target" ? "Нова ціль для цієї практики" : "Скільки додати"),
      }),

      mode === "undo" && last && o.jsxs("div", {
        className: "counter-confirm",
        role: "group",
        "aria-label": "Підтвердження скасування",
        children: [
          o.jsxs("span", { children: [`Скасувати ${lastLabel}? `, Ul(c.total), " → ", o.jsx("b", { children: Ul(Math.max(0, c.total - last.n)) })] }),
          o.jsxs("span", {
            className: "counter-links",
            children: [
              o.jsx("button", { type: "button", className: "linklike", onClick: undo, children: "Так, скасувати" }),
              o.jsx("button", { type: "button", className: "linklike", onClick: close, children: "Ні" }),
            ],
          }),
        ],
      }),

      mode === "none" && o.jsxs("div", {
        className: "counter-foot2",
        children: [
          o.jsx("span", { children: flash || (last ? "" : "Додайте кількість після сесії") }),
          o.jsxs("span", {
            className: "counter-links",
            children: [
              last && o.jsx("button", { type: "button", className: "linklike", onClick: () => open("undo"), children: flash && flash !== "Скасовано" ? "Скасувати" : "Скасувати останнє" }),
              o.jsx("button", { type: "button", className: "linklike", onClick: () => open("fix", String(c.total)), children: "Виправити" }),
            ],
          }),
        ],
      }),

      o.jsx(__NgAccountRow, {}),
    ],
  });
}
