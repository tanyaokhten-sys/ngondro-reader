// Executes the fake Supabase client's calls against local Postgres, as the
// signed-in user (role authenticated + auth.uid()) or anon, so the real
// row-level security, grants and triggers decide what is allowed.
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "/var/lib/postgresql/ngtest",
  port: +(process.env.PGPORT || 5433),
  user: "postgres",
  database: process.env.PGDATABASE || "e2e",
});
const TABLES = new Set(["counter_events", "counter_totals", "reminder_settings", "push_subscriptions"]);
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("bad identifier " + s); return s; };
const where = (filters, start) =>
  filters.length ? " where " + filters.map(([c], i) => `${ident(c)} = $${start + i}`).join(" and ") : "";

async function db(op, uid, table, payload, opts = {}) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(uid ? "set local role authenticated" : "set local role anon");
    if (uid) await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    let data = null;
    const filters = opts.filters || [];
    if (op === "fn") {
      // Emulates the "test" action of the reminders Edge Function.
      if (!uid) throw Object.assign(new Error("sign in first"), { code: "401" });
      const r = await c.query("select count(*)::int n from public.push_subscriptions");
      data = { devices: r.rows[0].n, sent: r.rows[0].n, removed: 0, failed: 0 };
    } else if (op === "rpc") {
      const names = Object.keys(payload || {}).map(ident);
      await c.query(`select public.${ident(table)}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`, names.map((n) => payload[n]));
    } else {
      if (!TABLES.has(table)) throw new Error("table " + table);
      if (op === "select") {
        const cols = (payload || "*").split(",").map((x) => x.trim()).map((x) => (x === "*" ? x : ident(x))).join(", ");
        const r = await c.query(`select ${cols} from public.${table}${where(filters, 1)}`, filters.map((f) => f[1]));
        const rows = r.rows.map((x) => { for (const k of ["total", "target"]) if (k in x) x[k] = Number(x[k]); return x; });
        data = opts.single ? rows[0] || null : rows;
      } else if (op === "upsert") {
        const rows = [].concat(payload.rows), o = payload.opts || {};
        const cols = Object.keys(rows[0]).map(ident);
        const conflict = o.onConflict
          ? ` on conflict (${ident(o.onConflict)}) do ` + (o.ignoreDuplicates ? "nothing" : "update set " + cols.map((k) => `${k} = excluded.${k}`).join(", "))
          : "";
        await c.query(
          `insert into public.${table} (${cols.join(", ")}) select ${cols.join(", ")} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)${conflict}`,
          [JSON.stringify(rows)]);
      } else if (op === "update") {
        const cols = Object.keys(payload).map(ident);
        await c.query(
          `update public.${table} set (${cols.join(", ")}) = (select ${cols.join(", ")} from jsonb_populate_record(null::public.${table}, $1::jsonb))${where(filters, 2)}`,
          [JSON.stringify(payload), ...filters.map((f) => f[1])]);
      } else if (op === "delete") {
        await c.query(`delete from public.${table}${where(filters, 1)}`, filters.map((f) => f[1]));
      } else throw new Error("op " + op);
    }
    await c.query("commit");
    return { data, error: null };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { data: null, error: { code: e.code, message: e.message } };
  } finally {
    c.release();
  }
}

module.exports = { db, pool };
