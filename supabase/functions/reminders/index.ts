// Ngondro Reader — practice reminders via Web Push.
//
// POST {"action":"dispatch"}  from Supabase Cron, header x-cron-secret: <CRON_SECRET>
//      Claims due reminders (once per user per local day) and sends them.
// POST {"action":"test"}      from the app, Authorization: Bearer <user access token>
//      Sends a test notification to the caller's own devices only.
//
// Secrets (Edge Function secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT, CRON_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase. Deployed with verify_jwt = false: this code checks
// the cron secret or the user's token itself.

import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import webpush from "npm:web-push@3.6.7";

const ALLOWED_ORIGINS = new Set([
  "https://ngondro-reader.netlify.app",
  "http://localhost:8770",
  "http://localhost:8771",
]);

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`missing secret ${k}`);
  return v;
};

webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin) && !/^https:\/\/[a-z0-9-]+--ngondro-reader\.netlify\.app$/.test(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(req) } });

function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

type Sub = { subscription_id: string; endpoint: string; p256dh: string; auth: string };

const REMINDER = { title: "Ньондро", body: "Час для щоденної практики.", url: "/", tag: "ngondro-reminder" };
const TEST = { title: "Ньондро", body: "Тестове нагадування: сповіщення працюють.", url: "/", tag: "ngondro-test" };

async function send(subs: Sub[], payload: typeof REMINDER) {
  let sent = 0, removed = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: "normal", topic: payload.tag },
      );
      sent++;
      await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq("id", s.subscription_id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        // Subscription expired or was revoked by the browser: forget it.
        await admin.from("push_subscriptions").delete().eq("id", s.subscription_id);
        removed++;
      } else {
        failed++;
        console.error("push failed", code, (e as Error).message);
        const { data } = await admin.from("push_subscriptions").select("failures").eq("id", s.subscription_id).maybeSingle();
        const n = ((data?.failures as number) ?? 0) + 1;
        if (n >= 10) await admin.from("push_subscriptions").delete().eq("id", s.subscription_id);
        else await admin.from("push_subscriptions").update({ failures: n }).eq("id", s.subscription_id);
      }
    }
  }));
  return { sent, removed, failed };
}

const lastTest = new Map<string, number>();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }

  if (body.action === "dispatch") {
    if (!sameSecret(req.headers.get("x-cron-secret") ?? "", env("CRON_SECRET"))) return json(req, { error: "forbidden" }, 403);
    const { data, error } = await admin.rpc("claim_due_reminders");
    if (error) { console.error(error); return json(req, { error: "claim failed" }, 500); }
    const subs = (data ?? []) as Sub[];
    const result = subs.length ? await send(subs, REMINDER) : { sent: 0, removed: 0, failed: 0 };
    if (subs.length) console.log("dispatch", result);
    return json(req, { due: subs.length, ...result });
  }

  if (body.action === "test") {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json(req, { error: "sign in first" }, 401);
    const { data: u, error } = await admin.auth.getUser(token);
    if (error || !u?.user) return json(req, { error: "sign in first" }, 401);
    const uid = u.user.id;
    const now = Date.now();
    if (now - (lastTest.get(uid) ?? 0) < 20_000) return json(req, { error: "too many tests, wait a moment" }, 429);
    lastTest.set(uid, now);
    const { data: rows } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", uid);
    const subs = (rows ?? []).map((r) => ({ subscription_id: r.id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
    if (!subs.length) return json(req, { devices: 0, sent: 0 });
    return json(req, { devices: subs.length, ...(await send(subs, TEST)) });
  }

  return json(req, { error: "unknown action" }, 400);
});
