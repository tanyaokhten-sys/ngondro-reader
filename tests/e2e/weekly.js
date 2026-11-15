// Weekly goals: settings panel, card line, derivation from events, undo,
// corrections, offline, two devices, disabling. Serves public/ on :8771.
const { chromium } = require("playwright");
const path = require("path");
const { db, pool } = require("./db");

const URL = "http://localhost:8771/";
const A = { id: "aaaaaaaa-0000-0000-0000-000000000001", email: "anna@example.com" };
let failures = 0;
const check = (cond, label, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra !== "" ? "  " + extra : ""}`); if (!cond) failures++; };
const q1 = async (sql, args = [A.id]) => (await pool.query(sql, args)).rows[0] || {};

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", timezoneId: "Europe/Kyiv" });
    await ctx.route("**/vendor/supabase-js-*.js", (r) => r.fulfill({ path: path.join(__dirname, "fake-supabase.js"), contentType: "text/javascript" }));
    await ctx.exposeFunction("__db", db);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(name + ": " + e.message));
    p.on("dialog", (d) => d.accept());
    await p.goto(URL, { waitUntil: "networkidle" });
    p.ctx = ctx;
    return p;
  }
  const week = async (p) => ((await p.$(".counter-week")) ? (await p.textContent(".counter-week")).replace(/\s/g, " ") : null);
  const total = (p) => p.textContent(".counter-num .big").then((s) => Number(s.replace(/\D/g, "")));
  const tap = (p, t) => p.click(`.counter-btns button:has-text("${t}")`);
  const sync = async (p) => { await p.evaluate(() => window.dispatchEvent(new Event("focus"))); await p.waitForTimeout(1500); };
  const goal = async (p, label) => {
    await p.click(".counter-more"); await p.click('.hist-goal button');
    if (label === "off") await p.click(".goal-off");
    else if (typeof label === "number") { await p.click('.goal-seg button:has-text("Інше")'); await p.fill("#wgoal", String(label)); await p.click('.hist button[type="submit"]'); }
    else await p.click(`.goal-seg button:has-text("${label}")`);
    await p.click('.hist-top button:has-text("Назад")'); await p.click('.hist-top button:has-text("Готово")');
  };
  const signIn = async (p) => {
    await p.evaluate((u) => localStorage.setItem("sb-himkikciqlogffqflaxc-auth-token", JSON.stringify({ access_token: "t", user: u })), A);
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2500);
  };

  console.log("# off by default, set from the separate panel");
  const phone = await device("phone");
  check(await week(phone) === null, "no weekly line until a goal is set");
  await goal(phone, "500");
  check(await week(phone) === "Цей тиждень: 0 з 500", "card shows weekly line", await week(phone));

  console.log("# guest: adds count, undo and corrections handled");
  await tap(phone, "+108");
  check(await week(phone) === "Цей тиждень: 108 з 500", "add counts toward the week");
  await phone.click('.counter-undo button:has-text("Скасувати")'); await phone.click('.counter-confirm button:has-text("Так, скасувати")');
  check(await week(phone) === "Цей тиждень: 0 з 500", "undo removes it from the week");
  await tap(phone, "+108");
  await phone.click(".counter-more"); await phone.click('.hist-total button:has-text("Виправити")'); await phone.fill("#fixv", "5000");
  await phone.click('.hist-total button:has-text("Далі")'); await phone.click('.hist-confirm button:has-text("Так, змінити")'); await phone.click('.hist-top button:has-text("Готово")');
  check(await total(phone) === 5000 && await week(phone) === "Цей тиждень: 108 з 500", "correction changes lifetime total, not the week", `${await total(phone)} | ${await week(phone)}`);

  console.log("# sign in: goal moves to the account");
  await signIn(phone);
  check((await q1("select weekly_goal from counter_totals where user_id=$1 and practice_id='refuge'")).weekly_goal == 500, "weekly goal stored in the account");
  await tap(phone, "+108"); await phone.waitForTimeout(2500);
  check(await week(phone) === "Цей тиждень: 108 з 500", "signed-in week derived from events (guest-era adds were imported, not weekly)", await week(phone));

  console.log("# second device, concurrent and offline");
  const desk = await device("desk");
  await signIn(desk);
  check(await week(desk) === "Цей тиждень: 108 з 500", "desktop sees the same goal and week", await week(desk));
  await Promise.all([tap(desk, "+21"), tap(phone, "+21")]); await desk.waitForTimeout(2500); await sync(phone); await sync(desk);
  check(await week(phone) === "Цей тиждень: 150 з 500" && await week(desk) === "Цей тиждень: 150 з 500", "both devices 150", `${await week(phone)} / ${await week(desk)}`);
  await desk.ctx.setOffline(true);
  await tap(desk, "+108"); await desk.waitForTimeout(300);
  check(await week(desk) === "Цей тиждень: 258 з 500", "offline add shows immediately", await week(desk));
  await desk.click('.counter-undo button:has-text("Скасувати")'); await desk.click('.counter-confirm button:has-text("Так, скасувати")');
  await tap(desk, "+108");
  check(await week(desk) === "Цей тиждень: 258 з 500", "offline add + undo + add = one 108", await week(desk));
  await desk.ctx.setOffline(false); await desk.evaluate(() => window.dispatchEvent(new Event("online"))); await desk.waitForTimeout(3000); await sync(phone);
  check(await week(phone) === "Цей тиждень: 258 з 500" && await week(desk) === "Цей тиждень: 258 з 500", "after reconnect both 258, nothing doubled", `${await week(phone)} / ${await week(desk)}`);
  const serverWeek = await (async () => { const r = await db("rpc", A.id, "weekly_progress", { p_tz: "Europe/Kyiv" }); return Number(r.data.find((x) => x.practice_id === "refuge").done); })();
  check(serverWeek === 258, "server derives the same 258 from events", String(serverWeek));

  console.log("# custom goal and disabling, synced");
  await goal(desk, 1234); await desk.waitForTimeout(2500); await sync(phone);
  check(await week(phone) === "Цей тиждень: 258 з 1 234", "custom goal reaches the phone", await week(phone));
  await goal(phone, "off"); await phone.waitForTimeout(2500); await sync(desk);
  check(await week(phone) === null && await week(desk) === null, "goal off on both devices");
  const t = await q1("select total, target, weekly_goal from counter_totals where user_id=$1 and practice_id='refuge'");
  check(t.weekly_goal === null && Number(t.target) === 111111 && Number(t.total) === await total(phone), "lifetime total and target untouched", JSON.stringify(t));
  const copy = (await phone.evaluate(() => document.body.innerText)).toLowerCase();
  check(!/серія|стрік|пропущ|не виконали|відстаєте/.test(copy), "no streak or guilt wording");

  console.log("\nerrors:", errs);
  if (errs.length) failures++;
  console.log(failures ? `\n${failures} FAILED` : "\nALL WEEKLY UI CHECKS PASSED");
  await browser.close(); await pool.end();
  process.exit(failures ? 1 : 0);
})();
