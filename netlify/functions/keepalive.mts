import type { Config } from "@netlify/functions";

// Supabase pauses free projects after about a week without activity.
// Ping the database once a day so sync never stops for that reason.
// The publishable key is public by design (the database rules protect data);
// ping() touches no user data.
const URL = "https://himkikciqlogffqflaxc.supabase.co/rest/v1/rpc/ping";
const KEY = "sb_publishable_h9UICSo9TmatMBJJOvX_iw_E894KFUH";

export default async () => {
  const res = await fetch(URL, {
    method: "POST",
    headers: { apikey: KEY, "content-type": "application/json" },
    body: "{}",
  });
  console.log("supabase ping", res.status, await res.text());
};

// 06:17 UTC daily (08:17 Kyiv in winter, 09:17 in summer).
export const config: Config = { schedule: "17 6 * * *" };
