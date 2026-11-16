// Laser notifications, delivered even when the app is closed or the phone is locked. Everyone who turned on notifications gets them.
//  - Run starts: a quiet notification that stays on the phone: "Laser running · done at 11:43 AM".
//  - Run time is up: it's replaced by a loud "Laser run done" alert, repeated every ~90s (up to 6 times) until someone taps Reloaded/Done.
//  - Run finished or stopped: it's replaced by a short "finished" notice.
// Called by the database every 20 seconds (laser_alert_tick), only when there's something to send.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { json } from "./common.ts";

const TAG = "laser"; // one laser = one notification slot; each message replaces the last
const clock = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit" });

Deno.serve(async (req) => {
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfg } = await service.from("app_settings").select("key, value").in("key", ["cron_token", "vapid_public", "vapid_private"]);
  const s = Object.fromEntries((cfg ?? []).map((r) => [r.key, r.value]));
  if (!s.cron_token || req.headers.get("x-cron-token") !== s.cron_token) return json({ error: "Not allowed" }, 403);
  webpush.setVapidDetails("mailto:mitchell@mtblock.com", s.vapid_public, s.vapid_private);

  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: runs } = await service.from("laser_runs")
    .select("id, user_id, status, started_at, ended_at, planned_seconds, notify_count, notified_at, start_sent, end_sent, laser_programs(name), jobs(title)")
    .or(`status.eq.running,and(start_sent.eq.true,end_sent.eq.false,ended_at.gt.${since})`);
  const { data: subs } = await service.from("push_subscriptions").select("*");
  const names = new Map(((await service.from("profiles").select("id, full_name")).data ?? []).map((p) => [p.id, (p.full_name ?? "").split(" ")[0]]));

  const send = async (payload: Record<string, unknown>) => {
    let n = 0;
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ tag: TAG, url: "./#jobs", ...payload }), { TTL: 600, urgency: "high" });
        n++;
      } catch (e) {
        const code = (e as any)?.statusCode;
        if (code === 404 || code === 410) await service.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        else console.error("push failed", code, (e as any)?.body);
      }
    }
    return n;
  };

  const now = Date.now();
  const anyRunning = (runs ?? []).some((r) => r.status === "running");
  let sent = 0;
  for (const r of runs ?? []) {
    const who = names.get(r.user_id) || "Someone";
    const what = `${(r as any).laser_programs?.name ?? "Laser"}${(r as any).jobs?.title ? " · " + (r as any).jobs.title : ""}`;
    const end = new Date(new Date(r.started_at).getTime() + r.planned_seconds * 1000);

    if (r.status !== "running") {
      const { data: c } = await service.from("laser_runs").update({ end_sent: true }).eq("id", r.id).eq("end_sent", false).select("id");
      if (c?.length && !anyRunning) sent += await send({ title: r.status === "done" ? `✓ Laser run finished · ${who}` : `Laser run stopped · ${who}`, body: what, silent: true, sticky: false });
      continue;
    }
    if (end.getTime() > now) {
      if (r.start_sent) continue;
      const { data: c } = await service.from("laser_runs").update({ start_sent: true }).eq("id", r.id).eq("start_sent", false).select("id");
      if (c?.length) sent += await send({ title: `🔦 Laser running · done at ${clock(end)}`, body: `${who}'s run · ${what}`, silent: true, sticky: true, timestamp: end.getTime() });
      continue;
    }
    // Time is up.
    if (r.notify_count >= 6 || (r.notified_at && now - new Date(r.notified_at).getTime() < 85_000)) continue;
    const { data: c } = await service.from("laser_runs").update({ notified_at: new Date().toISOString(), notify_count: r.notify_count + 1, start_sent: true })
      .eq("id", r.id).eq("notify_count", r.notify_count).select("id");
    if (!c?.length) continue;
    const late = Math.round((now - end.getTime()) / 60000);
    sent += await send({
      title: (r.notify_count ? `Laser still waiting${late ? ` (${late} min)` : ""}` : "🔔 Laser run done") + ` · ${who}'s run`,
      body: `${what}: reload the machine`, silent: false, sticky: true,
    });
  }
  return json({ ok: true, runs: (runs ?? []).length, sent });
});
