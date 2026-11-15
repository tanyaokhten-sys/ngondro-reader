// Reminders settings in the "Aa" panel. Serve a copy of public/ on :8772 with
// fake-supabase.js as vendor/supabase-js-*.js (the real service worker runs).
const { chromium, devices } = require("playwright");
const { db, pool } = require("./db");

const URL = "http://localhost:8772/";
const A = { id: "aaaaaaaa-0000-0000-0000-000000000001", email: "anna@example.com" };
let failures = 0;
const check = (cond, label, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`); if (!cond) failures++; };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;

// Push/permission stand-ins (headless Chromium cannot reach a push service).
const PUSH_STUB = () => {
  const K = "__fakeSub";
  window.__permAsked = 0;
  const perm = () => localStorage.getItem("__perm") || "default";
  Object.defineProperty(Notification, "permission", { get: perm, configurable: true });
  Notification.requestPermission = async () => { window.__permAsked++; localStorage.setItem("__perm", "granted"); return "granted"; };
  const make = (endpoint) => ({
    endpoint,
    toJSON() { return { endpoint, keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) } }; },
    async unsubscribe() { localStorage.removeItem(K); return true; },
  });
  PushManager.prototype.getSubscription = async function () { const e = localStorage.getItem(K); return e ? make(e) : null; };
  PushManager.prototype.subscribe = async function (o) {
    if (!o || !o.userVisibleOnly || !o.applicationServerKey) throw new Error("bad options");
    const e = "https://push.example/" + Math.random().toString(36).slice(2);
    localStorage.setItem(K, e); return make(e);
  };
};

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  async function device(name, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
    await ctx.exposeFunction("__db", db);
    await ctx.addInitScript(PUSH_STUB);
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(name + ": " + e.message));
    p.on("dialog", (d) => d.accept());
    await p.goto(URL, { waitUntil: "networkidle" });
    await p.evaluate(() => navigator.serviceWorker.ready);
    return p;
  }
  const signIn = async (p, u) => {
    await p.evaluate((x) => localStorage.setItem("sb-himkikciqlogffqflaxc-auth-token", JSON.stringify({ access_token: "t", user: x })), u);
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(2000);
  };
  const openSettings = async (p) => { await p.click('button[aria-label="Налаштування читання"]'); await p.waitForTimeout(1200); };
  const rem = (p) => p.textContent(".rem");
  const toggle = '.rem .toggle input[type="checkbox"]';

  console.log("# signed out");
  const phone = await device("phone", { timezoneId: "Europe/Kyiv" });
  await openSettings(phone);
  check((await rem(phone)).includes("увійдіть через Google"), "asks to sign in first");
  check(await phone.isDisabled(toggle), "toggle disabled when signed out");
  check(await phone.evaluate(() => window.__permAsked) === 0, "no permission prompt");

  console.log("# signed in, default off");
  await signIn(phone, A);
  await openSettings(phone);
  check(!(await phone.isChecked(toggle)), "reminders off by default");
  check(await phone.evaluate(() => window.__permAsked) === 0, "still no permission prompt just by opening settings");
  check((await q("select count(*)::int n from reminder_settings")).at(0).n === 0, "nothing saved until the user enables it");

  console.log("# enable");
  await phone.click(toggle); await phone.waitForTimeout(1500);
  check(await phone.evaluate(() => window.__permAsked) === 1, "permission asked once, after the user switched it on");
  const s1 = (await q("select enabled, remind_at::text, weekdays, timezone from reminder_settings where user_id=$1", [A.id]))[0];
  check(s1 && s1.enabled && /^Europe\/Ky?iev$|^Europe\/Kyiv$/.test(s1.timezone), "saved: enabled, timezone detected", JSON.stringify(s1));
  check((await q("select count(*)::int n from push_subscriptions where user_id=$1", [A.id]))[0].n === 1, "this device subscribed");
  check(/Europe\/(Kyiv|Kiev)/.test(await rem(phone)), "shows detected timezone");

  console.log("# time and weekdays");
  await phone.fill('.rem input[type="time"]', "21:30"); await phone.waitForTimeout(300);
  await phone.click('.rem-days button:has-text("Сб")'); await phone.click('.rem-days button:has-text("Нд")'); await phone.waitForTimeout(1500);
  const s2 = (await q("select remind_at::text t, weekdays from reminder_settings where user_id=$1", [A.id]))[0];
  check(s2.t === "21:30:00" && JSON.stringify(s2.weekdays) === "[1,2,3,4,5]", "time and weekdays saved", JSON.stringify(s2));

  console.log("# test notification");
  await phone.click('button:has-text("Надіслати тестове сповіщення")'); await phone.waitForTimeout(1000);
  check((await rem(phone)).includes("Тестове сповіщення надіслано"), "test notification sent");

  console.log("# second device, other timezone");
  const desk = await device("desk", { timezoneId: "America/New_York" });
  await signIn(desk, A);
  await openSettings(desk);
  check(await desk.isChecked(toggle), "desktop sees reminders on");
  check((await rem(desk)).includes("Цей пристрій не отримує нагадувань"), "desktop not yet subscribed");
  check(await desk.inputValue('.rem input[type="time"]') === "21:30", "desktop sees 21:30");
  await desk.click('button:has-text("Отримувати і тут")'); await desk.waitForTimeout(1500);
  check((await q("select count(*)::int n from push_subscriptions where user_id=$1", [A.id]))[0].n === 2, "two devices subscribed");

  console.log("# subscription expired in the browser -> renewed on next start");
  await desk.evaluate(() => localStorage.removeItem("__fakeSub"));
  await desk.reload({ waitUntil: "networkidle" }); await desk.waitForTimeout(5000);
  const ends = await q("select endpoint from push_subscriptions where user_id=$1", [A.id]);
  check(ends.length === 2, "renewed subscription replaces the expired one", String(ends.length));
  check((await q("select timezone from reminder_settings where user_id=$1", [A.id]))[0].timezone === "America/New_York", "timezone follows the device the user opened");

  console.log("# disable on phone");
  await phone.click(toggle); await phone.waitForTimeout(1500);
  check(!(await q("select enabled from reminder_settings where user_id=$1", [A.id]))[0].enabled, "disabled for the account");
  check(await phone.evaluate(() => localStorage.getItem("__fakeSub")) === null, "phone unsubscribed");

  console.log("# sign out removes this device");
  const before = (await q("select count(*)::int n from push_subscriptions where user_id=$1", [A.id]))[0].n;
  await desk.keyboard.press("Escape"); await desk.mouse.wheel(0, 800);
  await desk.click('.counter-sync button:has-text("Вийти")'); await desk.waitForTimeout(2000);
  const after = (await q("select count(*)::int n from push_subscriptions where user_id=$1", [A.id]))[0].n;
  check(after === before - 1, "desktop's subscription removed on sign-out", `${before} -> ${after}`);

  console.log("# iPhone in Safari (not on Home Screen)");
  const ios = await device("ios", { ...devices["iPhone 13"], timezoneId: "Europe/Kyiv" });
  await signIn(ios, A);
  await openSettings(ios);
  check((await rem(ios)).includes("На початковий екран"), "explains Add to Home Screen");
  await ios.click(toggle); await ios.waitForTimeout(800);
  check(await ios.evaluate(() => window.__permAsked) === 0, "no permission prompt in Safari tab");

  console.log("\nerrors:", errs);
  if (errs.length) failures++;
  console.log(failures ? `\n${failures} FAILED` : "\nALL REMINDER UI CHECKS PASSED");
  await browser.close(); await pool.end();
  process.exit(failures ? 1 : 0);
})();
