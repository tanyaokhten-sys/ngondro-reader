const { chromium } = require("playwright");
const { Pool } = require("pg");
const pool = new Pool({ host: process.env.PGHOST || "/var/lib/postgresql/ngtest", port: +(process.env.PGPORT || 5433), user: "postgres", database: "e2e" });
const U = { id: "aaaaaaaa-0000-0000-0000-000000000001", email: "anna@example.com" };
async function db(op, uid, table, a) {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    let res;
    if (op === "upsert") { await c.query(`insert into public.counter_events (id, practice_id, kind, delta, target, undoes, device_id, client_at)
      select * from jsonb_to_recordset($1::jsonb) as x(id uuid, practice_id text, kind text, delta bigint, target bigint, undoes uuid, device_id text, client_at timestamptz) on conflict (id) do nothing`, [JSON.stringify(a)]); res = { error: null }; }
    else { const r = await c.query("select practice_id, total, target, target_at from public.counter_totals"); res = { data: r.rows.map(x => ({ ...x, total: +x.total, target: +x.target })), error: null }; }
    await c.query("commit"); return res;
  } catch (e) { await c.query("rollback"); return { error: { code: e.code, message: e.message } }; } finally { c.release(); }
}
const total = async () => +((await pool.query("select total from counter_totals where user_id=$1 and practice_id='refuge'", [U.id])).rows[0]?.total ?? 0);
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.exposeFunction("__db", db);
  let p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message));
  await p.goto("http://localhost:8772/", { waitUntil: "networkidle" });
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.evaluate(u => localStorage.setItem("sb-himkikciqlogffqflaxc-auth-token", JSON.stringify({ access_token: "t", user: u })), U);
  await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2500);
  const start = await total();
  console.log("signed in, server total", start, "| sw controls page:", await p.evaluate(() => !!navigator.serviceWorker.controller));
  await ctx.setOffline(true); await p.close();
  p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message));
  await p.goto("http://localhost:8772/", { waitUntil: "load" }); await p.waitForTimeout(1500);
  console.log("opened offline, counter shows", await p.textContent(".counter-num .big"), "| row:", await p.textContent(".counter-sync"));
  await p.click('.counter-btns button:has-text("+108")'); await p.waitForTimeout(1500);
  console.log("after +108 offline:", await p.textContent(".counter-num .big"), "| server still", await total(), "| row:", await p.textContent(".counter-sync"));
  await p.close(); await ctx.setOffline(false);
  p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message));
  await p.goto("http://localhost:8772/", { waitUntil: "networkidle" }); await p.waitForTimeout(3000);
  const end = await total();
  console.log("reopened online:", await p.textContent(".counter-num .big"), "| server", end, "| row:", await p.textContent(".counter-sync"));
  console.log(end === start + 108 ? "OK offline tap uploaded exactly once" : "FAIL", "errors:", errs);
  await b.close(); await pool.end();
})();
