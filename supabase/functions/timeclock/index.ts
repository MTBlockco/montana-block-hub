// Clock in / clock out. Every punch is saved in the hub and written to Square Team as a timecard,
// so Square stays the payroll record. Pay rates are read from Square at punch time and never stored in the hub.
import { cors, json, getCaller } from "./common.ts";

const LOCATION = "6F0DGS0PWKQ1Q";
const SQUARE = "https://connect.squareup.com/v2";
const SQUARE_VERSION = "2025-10-16";

async function square(path: string, method = "GET", body?: unknown) {
  const token = Deno.env.get("SQUARE_ACCESS_TOKEN")?.trim();
  if (!token) throw new Error("NO_TOKEN");
  const res = await fetch(SQUARE + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.errors?.map((e: { detail?: string; code?: string }) => e.detail || e.code).join("; ") || `Square ${res.status}`);
  return out;
}

// Square's time is truncated to the minute; send it in the shop's local offset.
const denver = (d: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "longOffset" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  const off = g("timeZoneName").replace("GMT", "") || "+00:00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}:00${off}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const caller = await getCaller(req);
  if (caller instanceof Response) return caller;
  const { service, user } = caller;
  const body = await req.json().catch(() => ({}));

  const { data: me } = await service.from("profiles").select("square_team_member_id").eq("id", user.id).single();
  const tmId = me?.square_team_member_id as string | null;
  const { data: open } = await service.from("time_entries").select("*").eq("user_id", user.id).is("clock_out", null).maybeSingle();

  if (body.action === "status") return json({ open });

  // Read-only connection test for admins: confirms the Square token works and can see the shop's timecards.
  if (body.action === "square_check") {
    if (!["admin", "owner"].includes(caller.profile.role)) return json({ error: "Admins only" }, 403);
    // Shape of the saved token only (never the value): helps spot paste mistakes.
    const t = Deno.env.get("SQUARE_ACCESS_TOKEN") ?? "";
    const shape = { length: t.length, starts_with: t.slice(0, 4).replace(/[^\x20-\x7e]/g, "?"),
      non_ascii_chars: [...t].filter((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32).length,
      has_spaces: /\s/.test(t) };
    try {
      const loc = await square(`/locations/${LOCATION}`);
      const tc = await square("/labor/timecards/search", "POST", { query: { filter: { location_ids: [LOCATION] } }, limit: 1 });
      return json({ ok: true, shape, location: loc.location?.name, can_read_timecards: Array.isArray(tc.timecards) || tc.timecards === undefined });
    } catch (e) { return json({ ok: false, shape, error: (e as Error).message === "NO_TOKEN" ? "No Square token saved" : (e as Error).message }); }
  }

  if (body.action === "clock_in") {
    if (open) return json({ error: "You're already clocked in.", open }, 409);
    const now = new Date();
    const { data: entry, error } = await service.from("time_entries").insert({ user_id: user.id, clock_in: now.toISOString() }).select().single();
    if (error) return json({ error: error.message }, 400);

    let squareNote = "";
    try {
      if (!tmId) throw new Error("This login isn't linked to a Square team member.");
      // Already clocked in on the Square POS? Use that timecard instead of making a second one.
      const found = await square("/labor/timecards/search", "POST", {
        query: { filter: { team_member_ids: [tmId], status: "OPEN" } }, limit: 1,
      });
      let tc = found.timecards?.[0];
      if (!tc) {
        const ws = await square(`/team-members/${tmId}/wage-setting`);
        const job = ws.wage_setting?.job_assignments?.[0];
        tc = (await square("/labor/timecards", "POST", {
          idempotency_key: entry.id,
          timecard: {
            location_id: LOCATION, team_member_id: tmId, start_at: denver(now),
            ...(job ? { wage: { title: job.job_title, hourly_rate: job.hourly_rate } } : {}),
          },
        })).timecard;
      } else {
        await service.from("time_entries").update({ clock_in: tc.start_at }).eq("id", entry.id);
        squareNote = "You were already clocked in on Square, so the hub matched that.";
      }
      await service.from("time_entries").update({ square_timecard_id: tc.id, square_version: tc.version, square_status: "synced" }).eq("id", entry.id);
    } catch (e) {
      const msg = (e as Error).message;
      await service.from("time_entries").update({ square_status: msg === "NO_TOKEN" ? "pending" : "error", square_error: msg === "NO_TOKEN" ? null : msg }).eq("id", entry.id);
      squareNote = msg === "NO_TOKEN" ? "" : "Saved in the hub, but Square didn't take it. Mitchell has been flagged.";
    }
    await service.from("activity_log").insert({ user_id: user.id, action: "clock_in" });
    const { data: fresh } = await service.from("time_entries").select("*").eq("id", entry.id).single();
    return json({ ok: true, open: fresh, note: squareNote });
  }

  if (body.action === "clock_out") {
    if (!open) return json({ error: "You're not clocked in." }, 409);
    const now = new Date();
    await service.from("time_entries").update({ clock_out: now.toISOString() }).eq("id", open.id);
    let squareNote = "";
    try {
      if (!open.square_timecard_id) throw new Error(Deno.env.get("SQUARE_ACCESS_TOKEN") ? "No Square timecard for this shift." : "NO_TOKEN");
      const cur = (await square(`/labor/timecards/${open.square_timecard_id}`)).timecard;
      if (cur.status === "CLOSED") {
        await service.from("time_entries").update({ clock_out: cur.end_at, square_status: "synced" }).eq("id", open.id);
      } else {
        const breaks = (cur.breaks ?? []).map((b: Record<string, unknown>) => (b.end_at ? b : { ...b, end_at: denver(now) }));
        const upd = (await square(`/labor/timecards/${cur.id}`, "PUT", {
          timecard: { ...cur, breaks, end_at: denver(now), status: "CLOSED" },
        })).timecard;
        await service.from("time_entries").update({ square_version: upd.version, square_status: "synced", square_error: null }).eq("id", open.id);
      }
    } catch (e) {
      const msg = (e as Error).message;
      await service.from("time_entries").update({ square_status: msg === "NO_TOKEN" ? "pending" : "error", square_error: msg === "NO_TOKEN" ? null : msg }).eq("id", open.id);
      squareNote = msg === "NO_TOKEN" ? "" : "Saved in the hub, but Square didn't take it. Mitchell has been flagged.";
    }
    await service.from("activity_log").insert({ user_id: user.id, action: "clock_out" });
    return json({ ok: true, open: null, note: squareNote });
  }

  return json({ error: "Unknown action" }, 400);
});
