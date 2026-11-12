import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

/**
 * Counter sync between devices.
 *
 * Devices that share a sync key form a group. Each device stores ONLY its own
 * contribution under `<sha256(key)>/<deviceId>`, so devices never overwrite
 * each other's data; the app adds the contributions together.
 *
 * POST /api/sync
 *   { key, device, rev?, practices? }
 *   practices: { [practiceId]: { total, target, targetAt } }
 * Saves this device's entry (when `practices` is sent and `rev` is newer than
 * the stored one) and returns every device in the group:
 *   { devices: { [deviceId]: { rev, at, practices } } }
 */

const KEY_RE = /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/;
const DEVICE_RE = /^[a-z0-9]{8,32}$/;
const PRACTICE_RE = /^[a-z0-9_-]{1,40}$/;
const MAX_DEVICES = 20;
const MAX_PRACTICES = 50;
const MAX_TOTAL = 1e9;

type Practice = { total: number; target: number; targetAt: number };
type Entry = { rev: number; at: number; practices: Record<string, Practice> };

export interface SyncStore {
  get(key: string, opts: { type: "json"; consistency?: "strong" }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanPractices(input: unknown): Record<string, Practice> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, Practice> = {};
  const ids = Object.keys(input);
  if (ids.length > MAX_PRACTICES) return null;
  for (const id of ids) {
    const p = (input as Record<string, any>)[id];
    if (!PRACTICE_RE.test(id) || !p || typeof p !== "object") return null;
    const total = Math.round(Number(p.total));
    const target = Math.round(Number(p.target));
    const targetAt = Math.round(Number(p.targetAt) || 0);
    if (!Number.isFinite(total) || total < 0 || total > MAX_TOTAL) return null;
    if (!Number.isFinite(target) || target < 0 || target > MAX_TOTAL) return null;
    out[id] = { total, target, targetAt: Math.max(0, targetAt) };
  }
  return out;
}

export async function handle(req: Request, store: SyncStore): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const key = String(body?.key ?? "");
  const device = String(body?.device ?? "");
  if (!KEY_RE.test(key)) return json({ error: "bad key" }, 400);
  if (!DEVICE_RE.test(device)) return json({ error: "bad device" }, 400);

  const group = await sha256("ngondro-sync:" + key);
  const prefix = `${group}/`;
  const { blobs } = await store.list({ prefix });

  if (body.practices !== undefined) {
    const practices = cleanPractices(body.practices);
    const rev = Math.round(Number(body.rev));
    if (!practices || !Number.isFinite(rev) || rev < 1) return json({ error: "bad data" }, 400);
    const myKey = prefix + device;
    const known = blobs.some((b) => b.key === myKey);
    if (!known && blobs.length >= MAX_DEVICES) return json({ error: "too many devices" }, 409);
    const existing = known ? ((await store.get(myKey, { type: "json", consistency: "strong" })) as Entry | null) : null;
    if (!existing || rev > existing.rev) {
      await store.setJSON(myKey, { rev, at: Date.now(), practices } satisfies Entry);
      if (!known) blobs.push({ key: myKey });
    }
  }

  const devices: Record<string, Entry> = {};
  await Promise.all(
    blobs.map(async (b) => {
      const e = (await store.get(b.key, { type: "json", consistency: "strong" })) as Entry | null;
      if (e && typeof e === "object" && e.practices) devices[b.key.slice(prefix.length)] = e;
    }),
  );
  return json({ devices });
}

export default async (req: Request) =>
  handle(req, getStore({ name: "ngondro-sync", consistency: "strong" }) as unknown as SyncStore);

export const config: Config = { path: "/api/sync", method: ["POST"] };
