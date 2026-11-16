// Reading flow and the "Почати практику" button.
// Injected by tools/build.py (module scope of the bundle: Fe/Nr = chapters,
// wf = selectable practices, o = jsx, X = React).

// ---------- Previous / Next between chapters ----------
// Reading flow: Вступні молитви і мантри → the selected practice → Завершальні.
// Every practice chapter goes back to Вступні and on to Завершальні, whichever
// practice it is. Other chapters (Передмова) keep their usual neighbours.
function __ngChNav(chapterId, currentPractice) {
  const practices = wf;
  const cur = practices.includes(currentPractice) ? currentPractice : practices[0];
  const i = Fe.chapters.findIndex((c) => c.id === chapterId);
  let prev = Fe.chapters[i - 1], next = Fe.chapters[i + 1];
  if (chapterId === "opening") next = Nr.get(cur);
  if (practices.includes(chapterId)) { prev = Nr.get("opening"); next = Nr.get("closing"); }
  if (chapterId === "closing") { prev = Nr.get(cur); next = undefined; }
  return [prev, next];
}

// ---------- counter editing state ----------
// The counter card reports when an edit is open (custom amount, goal,
// correction, undo confirmation); "Почати практику" is disabled meanwhile.
const __ngEditors = new Set();
const __ngEditListeners = new Set();
function __ngSetEditing(key, on) {
  const had = __ngEditors.has(key);
  if (on) __ngEditors.add(key); else __ngEditors.delete(key);
  if (had !== on) __ngEditListeners.forEach((f) => f(__ngEditors.size > 0));
}
// In a component: mark "editing" while `on` is true; cleared on unmount.
function __ngUseEditing(key, on) {
  X.useEffect(() => {
    __ngSetEditing(key, !!on);
    return () => __ngSetEditing(key, false);
  }, [key, on]);
}
function __ngUseAnyEditing() {
  const [v, setV] = X.useState(__ngEditors.size > 0);
  X.useEffect(() => { __ngEditListeners.add(setV); return () => __ngEditListeners.delete(setV); }, []);
  return v;
}

// The home screen's start button (same look); disabled while the counter is edited.
function __NgStart({ href, onStart, lang, passageLabel }) {
  const editing = __ngUseAnyEditing();
  return o.jsxs("a", {
    className: "start",
    href: editing ? undefined : href,
    role: editing ? "link" : undefined,
    "aria-disabled": editing ? "true" : undefined,
    tabIndex: editing ? -1 : undefined,
    onClick: (e) => { if (editing) { e.preventDefault(); return; } onStart(); },
    children: [
      o.jsx("span", { className: "a", children: "Почати практику" }),
      editing
        ? o.jsx("span", { className: "b", children: "Спершу збережіть або скасуйте зміну лічильника" })
        : o.jsxs("span", { className: "b", children: ["Поклони · ", passageLabel, " · ", lang] }),
    ],
  });
}
