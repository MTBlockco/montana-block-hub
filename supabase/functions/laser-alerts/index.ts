// Sends a push notification to the engraver's phone when a laser run is due, even with the phone locked.
// Called by the database every 20 seconds (laser_alert_tick) only when a run is due. Repeats every ~90s, up to 6 times,
// until someone taps Reloaded/Done in the app.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { json } from "./common.ts";

Deno.serve(async (req) => {
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfg } = await service.from("app_settings").select("key, value").in("key", ["cron_token", "vapid_public", "vapid_private"]);
  const s = Object.fromEntries((cfg ?? []).map((r) => [r.key, r.value]));
  if (!s.cron_token || req.headers.get("x-cron-token") !== s.cron_token) return json({ error: "Not allowed" }, 403);
  webpush.setVapidDetails("mailto:mitchell@mtblock.com", s.vapid_public, s.vapid_private);

  const { data: runs } = await service.from("laser_runs")
    .select("id, user_id, started_at, planned_seconds, notify_count, notified_at, laser_programs(name), jobs(title)")
    .eq("status", "running").lt("notify_count", 6);
  const now = Date.now();
  const due = (runs ?? []).filter((r) => new Date(r.started_at).getTime() + r.planned_seconds * 1000 <= now
    && (!r.notified_at || now - new Date(r.notified_at).getTime() >= 85_000));
  let sent = 0;
  for (const r of due) {
    // Claim it first so an overlapping call doesn't double-send.
    const { data: claimed } = await service.from("laser_runs").update({ notified_at: new Date().toISOString(), notify_count: r.notify_count + 1 })
      .eq("id", r.id).eq("notify_count", r.notify_count).select("id");
    if (!claimed?.length) continue;
    const { data: subs } = await service.from("push_subscriptions").select("*").eq("user_id", r.user_id);
    const late = Math.round((now - (new Date(r.started_at).getTime() + r.planned_seconds * 1000)) / 60000);
    const payload = JSON.stringify({
      title: r.notify_count ? `Laser still waiting${late ? ` (${late} min)` : ""}` : "Laser run done",
      body: `${(r as any).laser_programs?.name ?? "Laser"}${(r as any).jobs?.title ? " · " + (r as any).jobs.title : ""}: reload the machine`,
      tag: "laser-" + r.id, url: "./#jobs",
    });
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 300, urgency: "high" });
        sent++;
      } catch (e) {
        const code = (e as any)?.statusCode;
        if (code === 404 || code === 410) await service.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        else console.error("push failed", code, (e as any)?.body);
      }
    }
  }
  return json({ ok: true, due: due.length, sent });
});
