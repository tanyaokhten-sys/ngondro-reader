// Reading flow (Вступні → selected practice → Завершальні) and the
// "Почати практику" button while the counter is edited. Mobile + desktop.
const { chromium, devices } = require("playwright");
const path = require("path");

const URL = "http://localhost:8771/";
const PRACTICES = ["refuge", "vajrasattva", "mandala", "guru-yoga", "bodhicitta"];
let failures = 0;
const check = (cond, label, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra !== "" ? "  " + extra : ""}`); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  for (const [kind, opts] of [["mobile", { ...devices["iPhone 13"] }], ["desktop", { viewport: { width: 1280, height: 800 } }]]) {
    console.log(`\n######## ${kind}`);
    const ctx = await browser.newContext({ ...opts, serviceWorkers: "block" });
    await ctx.route("**/vendor/supabase-js-*.js", (r) => r.fulfill({ path: path.join(__dirname, "fake-supabase.js"), contentType: "text/javascript" }));
    await ctx.exposeFunction("__db", async () => ({ data: [], error: null }));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(`${kind}: ${e.message}`));
    p.on("console", (m) => m.type() === "error" && errs.push(`${kind} console: ${m.text()}`));
    await p.goto(URL, { waitUntil: "networkidle" });
    const nav = async () => p.$$eval(".ch-nav a", (as) => as.map((a) => ({ cls: a.className, text: a.innerText.replace(/\s+/g, " ").trim(), href: a.getAttribute("href") })));
    const read = async (id) => { await p.goto(URL + "#/read/" + id); await p.waitForSelector(".ch-title"); await p.waitForTimeout(200); };
    const nextHref = async () => (await nav()).find((a) => a.cls.includes("next"))?.href;
    const prevHref = async () => (await nav()).find((a) => !a.cls.includes("next"))?.href;

    console.log("# reading flow for every practice");
    for (const pr of PRACTICES) {
      await p.evaluate((pr) => { const k = "ngondro:v1:ui"; const u = JSON.parse(localStorage.getItem(k) || "{}"); u.currentPractice = pr; localStorage.setItem(k, JSON.stringify(u)); }, pr);
      await read("opening");
      check(await nextHref() === `#/read/${pr}`, `[${pr}] Вступні → Next goes to the selected practice`, await nextHref());
      // follow the link like a reader would
      await p.click(".ch-nav a.next"); await p.waitForTimeout(300);
      check(p.url().endsWith(`#/read/${pr}`), `[${pr}] clicking Next opens it`);
      check(await prevHref() === "#/read/opening" && await nextHref() === "#/read/closing", `[${pr}] practice: ← Вступні, → Завершальні`, JSON.stringify((await nav()).map((a) => a.text)));
      await p.click(".ch-nav a.next"); await p.waitForTimeout(300);
      check(p.url().endsWith("#/read/closing") && await prevHref() === `#/read/${pr}` && !(await nextHref()), `[${pr}] Завершальні: ← back to the selected practice, no Next`);
    }
    const labels = await (async () => { await read("opening"); return (await nav()).map((a) => a.text); })();
    check(labels.some((t) => t.startsWith("Наступний →")) && labels.some((t) => t.startsWith("← Попередній")), "same Previous/Next design, labels show the destination", JSON.stringify(labels));

    console.log("# a practice opened from Зміст that is not the selected one");
    await read("mandala");
    check(await prevHref() === "#/read/opening" && await nextHref() === "#/read/closing", "Мандала (not selected) still → Завершальні");
    await read("preface");
    check(await nextHref() === "#/read/opening" && !(await prevHref()), "Передмова → Вступні (unchanged)");

    console.log("# selecting a practice on the home screen changes the flow");
    await p.goto(URL); await p.waitForSelector(".counter");
    await p.click('.session-row a:has-text("змінити"), button:has-text("змінити"), a:has-text("змінити")').catch(() => {});
    await p.waitForTimeout(300);
    if (await p.$('.practice-pick button')) {
      await p.click('.practice-pick button:has-text("Ґуру-йоґа")'); await p.waitForTimeout(200);
      await read("opening");
      check(await nextHref() === "#/read/guru-yoga", "picked Ґуру-йоґа on home → Вступні leads there", await nextHref());
    } else check(false, "practice picker found on home");

    console.log("# chapter content unchanged");
    for (const id of ["opening", "refuge", "closing"]) {
      await read(id);
      const n = await p.$$eval(".reader [class^='b '], .reader .b", (x) => x.length);
      check(n > 0, `${id}: text renders (${n} blocks)`);
    }

    console.log("# Почати практику while the counter is edited");
    await p.goto(URL); await p.waitForSelector(".counter");
    const st = async () => p.$eval("a.start", (a) => ({ disabled: a.getAttribute("aria-disabled") === "true", href: a.getAttribute("href"), tab: a.tabIndex, sub: a.querySelector(".b").textContent, opacity: getComputedStyle(a).opacity }));
    const enabled = async (label) => { await p.waitForTimeout(150); const s = await st(); check(!s.disabled && s.href && s.href.startsWith("#/practice/"), label, JSON.stringify(s)); };
    const disabled = async (label) => {
      await p.waitForTimeout(150);
      const s = await st();
      check(s.disabled && !s.href && s.tab === -1 && Number(s.opacity) < 0.6, label, `${s.sub} · opacity ${s.opacity}`);
      const before = p.url();
      await p.click("a.start", { force: true }); await p.waitForTimeout(250);
      check(p.url() === before && !(await p.$(".practice")), "  …and tapping it does not start a session");
    };
    await enabled("enabled at rest");
    await p.click('.counter-btns button:has-text("Інше…")');
    await disabled("Інше… open → disabled");
    await p.click('.counter-form button[aria-label="Скасувати"]');
    await enabled("cancel → enabled");
    await p.click('.counter-btns button:has-text("Інше…")'); await p.fill("#cnt", "21"); await p.click('.counter-form button[type="submit"]');
    await enabled("save → enabled");
    check((await p.textContent(".counter-num .big")).replace(/\D/g, "") === "21", "counter still counts (21)");
    await p.click(".counter-num .of");
    await disabled("goal editor open → disabled");
    await p.click('.counter-form button[aria-label="Скасувати"]');
    await enabled("goal editor closed → enabled");
    await p.click('.counter-btns button:has-text("+108")');
    await enabled("undo offer alone does not disable");
    await p.click('.counter-undo button:has-text("Скасувати")');
    await disabled("undo confirmation → disabled");
    await p.click('.counter-confirm button:has-text("Ні")');
    await enabled("'Ні' → enabled");
    await p.click(".counter-more");
    await p.click('.hist-total button:has-text("Виправити")');
    await disabled("correction (⋯ → Виправити) → disabled");
    await p.fill("#fixv", "100"); await p.click('.hist-total button:has-text("Далі")');
    await disabled("correction confirmation → disabled");
    await p.click('.hist-confirm button:has-text("Так, змінити")');
    await enabled("correction saved → enabled");
    await p.click('.hist-goal button'); await p.click('.goal-seg button:has-text("Інше")');
    await disabled("custom weekly goal input → disabled");
    await p.click('.hist .counter-form button[aria-label="Скасувати"]');
    await enabled("custom weekly goal cancelled → enabled");
    await p.click('.hist-top button:has-text("Назад")'); await p.click('.hist-top button:has-text("Готово")');
    await enabled("menu closed → enabled");
    check((await p.textContent(".counter-num .big")).replace(/\D/g, "") === "100", "correction applied (100)");
    await p.click("a.start"); await p.waitForTimeout(500);
    check(p.url().includes("#/practice/"), "enabled button starts the practice");
    await ctx.close();
  }
  console.log("\nerrors:", errs);
  if (errs.length) failures++;
  console.log(failures ? `\n${failures} FAILED` : "\nALL NAVIGATION/EDITING CHECKS PASSED");
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
