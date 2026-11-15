// Stand-in for the Supabase browser client. Auth is simulated (session in
// localStorage); every database call goes to window.__db (exposed by the
// Playwright test), which runs it against a local Postgres with the real
// migrations, row-level security and triggers.
(function () {
  const KEY = "sb-himkikciqlogffqflaxc-auth-token";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  window.supabase = {
    createClient() {
      const listeners = [];
      const auth = {
        onAuthStateChange(cb) {
          listeners.push(cb);
          setTimeout(() => cb("INITIAL_SESSION", read()), 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        async getSession() { return { data: { session: read() }, error: null }; },
        async signInWithOAuth() { window.__oauthStarted = (window.__oauthStarted || 0) + 1; return { error: null }; },
        async signOut() { localStorage.removeItem(KEY); listeners.forEach((cb) => cb("SIGNED_OUT", null)); return { error: null }; },
      };
      const net = () => (navigator.onLine ? null : { message: "Failed to fetch", code: "" });
      return {
        auth,
        from(table) {
          return {
            async upsert(rows, opts) {
              const s = read(); if (net()) return { error: net() };
              return window.__db("upsert", s && s.user.id, table, rows, opts);
            },
            async select(cols) {
              const s = read(); if (net()) return { data: null, error: net() };
              return window.__db("select", s && s.user.id, table, cols);
            },
          };
        },
      };
    },
  };
})();
