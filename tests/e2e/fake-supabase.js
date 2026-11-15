// Stand-in for the Supabase browser client. Auth is simulated (session in
// localStorage); every database call goes to window.__db (exposed by the
// Playwright test), which runs it against a local Postgres with the real
// migrations, row-level security and triggers.
(function () {
  const KEY = "sb-himkikciqlogffqflaxc-auth-token";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const uid = () => { const s = read(); return s && s.user.id; };
  const offline = () => (navigator.onLine ? null : { message: "Failed to fetch", code: "" });
  const call = (...args) => (offline() ? Promise.resolve({ data: null, error: offline() }) : window.__db(...args));
  // A tiny query builder: awaitable, with .eq() and .maybeSingle().
  function query(table, op, payload) {
    const filters = [];
    let single = false;
    const q = {
      eq(col, val) { filters.push([col, val]); return q; },
      maybeSingle() { single = true; return q; },
      then(res, rej) {
        return call(op, uid(), table, payload, { filters, single }).then(res, rej);
      },
    };
    return q;
  }
  window.supabase = {
    createClient() {
      const listeners = [];
      return {
        auth: {
          onAuthStateChange(cb) {
            listeners.push(cb);
            setTimeout(() => cb("INITIAL_SESSION", read()), 0);
            return { data: { subscription: { unsubscribe() {} } } };
          },
          async getSession() { return { data: { session: read() }, error: null }; },
          async signInWithOAuth() { window.__oauthStarted = (window.__oauthStarted || 0) + 1; return { error: null }; },
          async signOut() { localStorage.removeItem(KEY); listeners.forEach((cb) => cb("SIGNED_OUT", null)); return { error: null }; },
        },
        from(table) {
          return {
            select: (cols) => query(table, "select", cols),
            upsert: (rows, opts) => query(table, "upsert", { rows, opts }),
            update: (vals) => query(table, "update", vals),
            delete: () => query(table, "delete", null),
          };
        },
        rpc: (name, args) => call("rpc", uid(), name, args, {}),
        functions: { invoke: (name, opts) => call("fn", uid(), name, opts && opts.body, {}) },
      };
    },
  };
})();
