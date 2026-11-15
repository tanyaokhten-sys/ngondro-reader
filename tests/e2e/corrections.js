// Counter corrections: preview, correction (incl. lowering), undo, offline,
// retries, two devices. Serves public/ on :8771 with the fake Supabase client.
const { chromium } = require("playwright");
const path = require("path");
const { db, pool } = require("./db");

const URL = "http://localhost:8771/";
const A = { id: "aaaaaaaa-0000-0000-0000-000000000001", email: "anna@example.com" };
let failures = 0;
const check = (cond, label, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra !== "" ? "  " + extra : ""}`); if (!cond) failures++; };
const total = async () => Number((await pool.query("select total from counter_totals where user_id=$1 and practice_id='refuge'", [A.id])).rows[0]?.total ?? 0);
const sumEvents = async () => Number((await pool.query("select coalesce(sum(delta),0) s from counter_events where user_id=$1 and practice_id='refuge'", [A.id])).rows[0].s);

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await ctx.route("**/vendor/supabase-js-*.js", (r) => r.fulfill({ path: path.join(__dirname, "fake-supabase.js"), contentType: "text/javascript" }));
    await ctx.exposeFunction("__db", db);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(name + ": " + e.message));
    p.on("dialog", (d) => d.accept());
    await p.goto(URL, { waitUntil: "networkidle" });
    p.ctx = ctx;
    return p;
  }
  const num = (p) => p.textContent(".counter-num .big").then((s) => Number(s.replace(/\D/g, "")));
  const sync = async (p) => { await p.evaluate(() => window.dispatchEvent(new Event("focus"))); await p.waitForTimeout(1500); };
  const fix = async (p, v) => { await p.click('.counter-foot2 button:has-text("Виправити")'); await p.fill("#cnt", String(v)); };
  const undo = async (p) => { await p.click('.counter-foot2 button:has-text("Скасувати")'); await p.click('.counter-confirm button:has-text("Так, скасувати")'); };
  const signIn = async (p) => {
    await p.evaluate((u) => localStorage.setItem("sb-himkikciqlogffqflaxc-auth-token", JSON.stringify({ access_token: "t", user: u })), A);
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2500);
  };

  console.log("# guest: previews, correction, undo");
  const phone = await device("phone");
  await phone.click('.counter-btns button:has-text("Інше…")'); await phone.fill("#cnt", "345");
  check((await phone.textContent(".counter-preview")) === "0 + 345 = 345", "custom add previews the result", await phone.textContent(".counter-preview"));
  await phone.click('.counter-form button[type="submit"]');
  check(await num(phone) === 345, "added 345");
  await fix(phone, 300);
  check((await phone.textContent(".counter-preview")).replace(/\s/g, " ") === "345 → 300 (−45)", "correction previews old → new (difference)", await phone.textContent(".counter-preview"));
  check(await phone.isDisabled('.counter-form button[type="submit"]') === false, "save enabled");
  await phone.fill("#cnt", "345");
  check(await phone.isDisabled('.counter-form button[type="submit"]'), "no-op correction can't be saved");
  await phone.fill("#cnt", "-5");
  check((await phone.textContent(".counter-preview")).includes("→ 5"), "minus sign ignored: totals can't be negative");
  await phone.fill("#cnt", "300"); await phone.click('.counter-form button[type="submit"]');
  check(await num(phone) === 300, "corrected to 300");
  check((await phone.textContent(".counter-foot2")).includes("Виправлено: 345 → 300"), "says what changed");
  await phone.click('.counter-foot2 button:has-text("Скасувати")');
  check((await phone.textContent(".counter-confirm")).replace(/\s/g, " ").includes("Скасувати виправлення −45? 300 → 345"), "undo of a correction previews result", await phone.textContent(".counter-confirm"));
  await phone.click('.counter-confirm button:has-text("Ні")');
  check(await num(phone) === 300, "'Ні' changes nothing");

  console.log("# sign in: guest progress imported, guest actions undone as corrections");
  await signIn(phone);
  check(await total() === 300, "account starts at 300");
  await undo(phone); await phone.waitForTimeout(2500);
  check(await total() === 345 && await num(phone) === 345, "undo of a pre-sign-in correction reaches the account (345)", `${await total()}`);
  const fallback = (await pool.query("select kind, delta from counter_events where user_id=$1 order by server_seq desc limit 1", [A.id])).rows[0];
  check(fallback.kind === "adjust" && Number(fallback.delta) === 45, "recorded as an auditable correction", JSON.stringify(fallback));

  console.log("# correction while another device adds");
  const desk = await device("desk");
  desk.on("dialog", (d) => d.accept());
  await signIn(desk);
  check(await num(desk) === 345, "desktop sees 345");
  await desk.ctx.setOffline(true);
  await desk.click('.counter-btns button:has-text("+108")'); // desktop offline: 453 locally
  await fix(phone, 300); await phone.click('.counter-form button[type="submit"]'); await phone.waitForTimeout(2500);
  await desk.ctx.setOffline(false); await desk.evaluate(() => window.dispatchEvent(new Event("online"))); await desk.waitForTimeout(3000);
  await sync(phone);
  check(await total() === 408 && await num(phone) === 408 && await num(desk) === 408, "both changes kept: 345 − 45 + 108 = 408", `${await total()} / ${await num(phone)} / ${await num(desk)}`);
  const audit = (await pool.query("select delta, client_total_before b, client_total_after a, note from counter_events where user_id=$1 and kind='adjust' order by server_seq desc limit 1", [A.id])).rows[0];
  check(Number(audit.delta) === -45 && Number(audit.b) === 345 && Number(audit.a) === 300 && audit.note === "manual correction", "audit trail: −45, seen 345 → 300", JSON.stringify(audit));

  console.log("# undo after reopening the app");
  await phone.reload({ waitUntil: "networkidle" }); await phone.waitForTimeout(2000);
  await undo(phone); await phone.waitForTimeout(2500);
  check(await total() === 453, "undo of the correction after reload (+45 → 453)", String(await total()));

  console.log("# offline correction + repeated upload");
  await phone.ctx.setOffline(true);
  await fix(phone, 400); await phone.click('.counter-form button[type="submit"]'); await phone.waitForTimeout(500);
  check(await num(phone) === 400 && await total() === 453, "offline: shown 400, server unchanged");
  const pending = await phone.evaluate(() => { const a = JSON.parse(localStorage.getItem("ngondro:v1:acct")); return a.outbox[a.owner]; });
  await phone.ctx.setOffline(false); await phone.evaluate(() => window.dispatchEvent(new Event("online"))); await phone.waitForTimeout(3000);
  await phone.evaluate((p) => { const a = JSON.parse(localStorage.getItem("ngondro:v1:acct")); a.outbox[a.owner] = p.concat(p); localStorage.setItem("ngondro:v1:acct", JSON.stringify(a)); }, pending);
  await sync(phone); await sync(desk);
  check(await total() === 400 && await num(desk) === 400, "correction applied exactly once (400)", String(await total()));

  console.log("# never negative");
  await desk.ctx.setOffline(true);
  await fix(desk, 0); await desk.click('.counter-form button[type="submit"]'); // desk saw 400 → −400
  await fix(phone, 100); await phone.click('.counter-form button[type="submit"]'); await phone.waitForTimeout(2500); // −300 first
  await desk.ctx.setOffline(false); await desk.evaluate(() => window.dispatchEvent(new Event("online"))); await desk.waitForTimeout(3000);
  await sync(phone);
  check(await total() === 0 && await num(phone) === 0 && await num(desk) === 0, "two reductions totalling −700 on 400 stop at 0", `${await total()}`);
  check(await total() === await sumEvents(), "total equals the sum of all events");
  const lim = (await pool.query("select delta, requested_delta from counter_events where user_id=$1 and requested_delta is not null", [A.id])).rows;
  check(lim.length === 1 && Number(lim[0].delta) === -100 && Number(lim[0].requested_delta) === -400, "limited reduction keeps requested amount", JSON.stringify(lim));

  console.log("\nerrors:", errs);
  if (errs.length) failures++;
  console.log(failures ? `\n${failures} FAILED` : "\nALL CORRECTION CHECKS PASSED");
  await browser.close(); await pool.end();
  process.exit(failures ? 1 : 0);
})();
