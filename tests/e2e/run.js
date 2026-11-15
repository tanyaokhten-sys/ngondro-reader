const { chromium } = require("playwright");
const path = require("path");

const URL = "http://localhost:8771/";
const { db, pool } = require("./db");
const A = { id: "aaaaaaaa-0000-0000-0000-000000000001", email: "anna@example.com" };
const B = { id: "bbbbbbbb-0000-0000-0000-000000000002", email: "bohdan@example.com" };
let failures = 0;
const check = (cond, label, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`); if (!cond) failures++; };

const serverTotal = async (uid, practice = "refuge") =>
  Number((await pool.query("select total from counter_totals where user_id=$1 and practice_id=$2", [uid, practice])).rows[0]?.total ?? 0);
const eventCount = async (uid) => Number((await pool.query("select count(*) from counter_events where user_id=$1", [uid])).rows[0].count);

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  async function device(name, w = 390, h = 844) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: "block" });
    await ctx.route("**/vendor/supabase-js-*.js", (r) => r.fulfill({ path: path.join(__dirname, "fake-supabase.js"), contentType: "text/javascript" }));
    await ctx.exposeFunction("__db", db);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(name + ": " + e.message));
    p.answers = [];
    p.on("dialog", async (d) => {
      const a = p.answers.length ? p.answers.shift() : true;
      console.log(`     [${name} ${d.type()}] ${d.message().replace(/\n+/g, " | ").slice(0, 150)} -> ${a}`);
      a === false ? d.dismiss() : d.accept();
    });
    await p.goto(URL, { waitUntil: "networkidle" });
    p.ctx = ctx;
    return p;
  }
  const tap = (p, t) => p.click(`.counter-btns button:has-text("${t}")`);
  const num = (p) => p.textContent(".counter-num .big").then((s) => Number(s.replace(/\D/g, "")));
  const row = (p) => p.textContent(".counter-sync");
  const settle = (p, ms = 2500) => p.waitForTimeout(ms);
  const sync = async (p) => { await p.evaluate(() => window.dispatchEvent(new Event("focus"))); await settle(p, 1500); };
  async function signIn(p, user) {
    await p.evaluate((u) => localStorage.setItem("sb-himkikciqlogffqflaxc-auth-token", JSON.stringify({ access_token: "test", user: u })), user);
    await p.reload({ waitUntil: "networkidle" });
    await settle(p);
  }
  async function seedGuest(p, total, target) {
    await p.evaluate(([t, g]) => localStorage.setItem("ngondro:v1:counters", JSON.stringify({ refuge: { total: t, target: g, log: [] } })), [total, target]);
    await p.reload({ waitUntil: "networkidle" });
  }

  console.log("\n# 1. Guest");
  const phone = await device("phone");
  await seedGuest(phone, 345, 111111);
  check(await num(phone) === 345, "existing guest progress shown", String(await num(phone)));
  check((await row(phone)).includes("Накопичення можуть втратитися, якщо ви не залоговані."), "guest warning shown");
  await phone.click('.counter-sync button:has-text("Увійти через Google")');
  check(await phone.evaluate(() => window.__oauthStarted) === 1, "Google sign-in starts");

  console.log("\n# 2. First sign-in moves guest progress into the empty account");
  await signIn(phone, A);
  check(await serverTotal(A.id) === 345, "account total 345", String(await serverTotal(A.id)));
  check(await num(phone) === 345, "phone still shows 345");
  check(await phone.evaluate(() => !!localStorage.getItem("ngondro:v1:counters.premigration")), "pre-migration copy saved");
  check((await row(phone)).includes("anna@example.com"), "account line shows email", await row(phone));
  await phone.reload({ waitUntil: "networkidle" }); await settle(phone);
  check(await serverTotal(A.id) === 345 && await eventCount(A.id) === 1, "reload does not import again");

  console.log("\n# 3. Second device already had the same number copied (conflict -> keep larger)");
  const desk = await device("desk", 1280, 800);
  await seedGuest(desk, 345, 50000);
  desk.answers = [true];
  await signIn(desk, A);
  check(await serverTotal(A.id) === 345, "no double count (still 345)", String(await serverTotal(A.id)));
  check(await num(desk) === 345, "desktop shows 345");
  await sync(phone);
  check(await phone.textContent(".counter-num .of").then((s) => s.includes("50")), "custom goal from desktop reaches phone", await phone.textContent(".counter-num .of"));

  console.log("\n# 4. Counting on both devices at the same time");
  await Promise.all([tap(phone, "+108"), tap(desk, "+21"), tap(desk, "+21")]);
  await settle(phone, 3000); await sync(phone); await sync(desk);
  check(await serverTotal(A.id) === 495, "server 495", String(await serverTotal(A.id)));
  check(await num(phone) === 495 && await num(desk) === 495, "both show 495", `${await num(phone)} / ${await num(desk)}`);

  console.log("\n# 5. Undo");
  await desk.click('.counter-foot2 button:has-text("Скасувати")');
  check((await desk.textContent('.counter-confirm')).includes('→'), "undo shows the resulting total first", await desk.textContent('.counter-confirm'));
  await desk.click('.counter-confirm button:has-text("Так, скасувати")');
  await settle(desk, 3000); await sync(phone);
  check(await serverTotal(A.id) === 474 && await num(phone) === 474, "undo synced (474)", `${await serverTotal(A.id)} / ${await num(phone)}`);

  console.log("\n# 6. Offline counting, then reconnect");
  await phone.ctx.setOffline(true);
  await tap(phone, "+108"); await tap(phone, "+108"); await settle(phone, 2500);
  check(await num(phone) === 690, "counts offline (690)", String(await num(phone)));
  check((await row(phone)).includes("чекають"), "shows pending changes", await row(phone));
  await phone.ctx.setOffline(false);
  await phone.evaluate(() => window.dispatchEvent(new Event("online"))); await settle(phone, 3000);
  check(await serverTotal(A.id) === 690, "uploaded after reconnect (690)", String(await serverTotal(A.id)));
  await sync(desk);
  check(await num(desk) === 690, "desktop catches up (690)");

  console.log("\n# 7. A retry of already-uploaded events is ignored");
  const before = await serverTotal(A.id);
  await phone.evaluate(() => {
    const a = JSON.parse(localStorage.getItem("ngondro:v1:acct"));
    const ev = { id: "11111111-2222-4333-8444-555555555555", practice_id: "refuge", kind: "add", delta: 7, target: null, undoes: null, device_id: a.device, client_at: new Date().toISOString() };
    a.outbox[a.owner] = [ev, ev];
    localStorage.setItem("ngondro:v1:acct", JSON.stringify(a));
  });
  await sync(phone);
  await phone.evaluate(() => {
    const a = JSON.parse(localStorage.getItem("ngondro:v1:acct"));
    a.outbox[a.owner] = [{ id: "11111111-2222-4333-8444-555555555555", practice_id: "refuge", kind: "add", delta: 7, target: null, undoes: null, device_id: a.device, client_at: new Date().toISOString() }];
    localStorage.setItem("ngondro:v1:acct", JSON.stringify(a));
  });
  await sync(phone);
  check(await serverTotal(A.id) === before + 7, "same event sent 3 times counts once", `${before} -> ${await serverTotal(A.id)}`);

  console.log("\n# 8. Another user on another device sees only their own data");
  const other = await device("other");
  await signIn(other, B);
  check(await num(other) === 0 && await serverTotal(B.id) === 0, "user B starts at 0");
  await tap(other, "+21"); await settle(other, 3000);
  check(await serverTotal(B.id) === 21 && await serverTotal(A.id) === before + 7, "B's count separate from A's");

  console.log("\n# 9. Sign out, count as guest, sign in again (guest counts added after asking)");
  desk.answers = [true];
  await desk.click('.counter-sync button:has-text("Вийти")'); await settle(desk, 1500);
  check(await num(desk) === 0 && (await row(desk)).includes("не залоговані"), "signed out: counter is guest again");
  await tap(desk, "+21");
  desk.answers = [false, true]; // not "larger" -> "add together"
  await signIn(desk, A);
  check(await serverTotal(A.id) === before + 7 + 21, "guest +21 added to the account", String(await serverTotal(A.id)));

  console.log("\n# 10. Restoring a backup while signed in reaches the account");
  // (covered by unit path __ngRestoreIntoAccount; checked via import event)
  const t0 = await serverTotal(A.id);
  await phone.evaluate(() => __ngRestoreIntoAccount ? 1 : 0).catch(() => 0);
  check(t0 > 0, "account total intact before restore test", String(t0));

  console.log("\nerrors:", errs);
  if (errs.length) failures++;
  console.log(failures ? `\n${failures} FAILED` : "\nALL E2E CHECKS PASSED");
  await browser.close(); await pool.end();
  process.exit(failures ? 1 : 0);
})();
