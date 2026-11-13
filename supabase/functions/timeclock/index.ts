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

// Break types live in Square (Labor > Breaks). Lunch = "Lunch" (30 min, unpaid); quick = "Quick Break" (5 min, paid).
const BREAKS = { lunch: { name: "Lunch", minutes: 30, paid: false }, quick: { name: "Quick Break", minutes: 5, paid: true } } as const;
type Kind = keyof typeof BREAKS;
async function breakType(kind: Kind) {
  const list = (await square(`/labor/break-types?location_id=${LOCATION}`)).break_types ?? [];
  return list.find((b: { break_name: string }) => b.break_name.toLowerCase() === BREAKS[kind].name.toLowerCase()) ?? null;
}

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
  const openBreak = async () => (await service.from("time_breaks").select("*").eq("user_id", user.id).is("end_at", null).maybeSingle()).data;

  // Status checks Square too, so a punch made on the Square register shows up in the app (and vice versa).
  if (body.action === "status") {
    if (!tmId || !Deno.env.get("SQUARE_ACCESS_TOKEN")) return json({ open, break: open ? await openBreak() : null });
    try {
      const found = await square("/labor/timecards/search", "POST", {
        query: { filter: { team_member_ids: [tmId], status: "OPEN" } }, limit: 1,
      });
      const tc = found.timecards?.[0];
      if (tc && !open) {
        // Clocked in on Square only: mirror it in the hub.
        const { data: entry } = await service.from("time_entries").insert({
          user_id: user.id, clock_in: tc.start_at, square_timecard_id: tc.id, square_version: tc.version, square_status: "synced",
        }).select().single();
        return json({ open: entry, note: "Picked up your Square clock-in." });
      }
      if (open && !tc && open.square_timecard_id) {
        // Clocked out on Square: close the hub entry with Square's end time.
        const cur = (await square(`/labor/timecards/${open.square_timecard_id}`)).timecard;
        if (cur?.status === "CLOSED") {
          await service.from("time_entries").update({ clock_out: cur.end_at, square_version: cur.version, square_status: "synced" }).eq("id", open.id);
          return json({ open: null });
        }
      }
      if (open && tc && open.square_timecard_id !== tc.id) {
        await service.from("time_entries").update({ square_timecard_id: tc.id, square_version: tc.version, square_status: "synced", clock_in: tc.start_at }).eq("id", open.id);
        const { data: fresh } = await service.from("time_entries").select("*").eq("id", open.id).single();
        return json({ open: fresh });
      }
      // Breaks taken or ended on the Square register show up here too.
      if (open && tc && open.square_timecard_id === tc.id) {
        const sqOpen = (tc.breaks ?? []).find((b: { end_at?: string }) => !b.end_at);
        const mine = await openBreak();
        if (sqOpen && !mine) {
          const kind: Kind = /lunch/i.test(sqOpen.name ?? "") ? "lunch" : "quick";
          await service.from("time_breaks").insert({ entry_id: open.id, user_id: user.id, kind, paid: !!sqOpen.is_paid, start_at: sqOpen.start_at, square_status: "synced" });
        } else if (!sqOpen && mine) {
          const done = (tc.breaks ?? []).filter((b: { end_at?: string }) => b.end_at).pop();
          await service.from("time_breaks").update({ end_at: done?.end_at ?? new Date().toISOString() }).eq("id", mine.id);
        }
      }
    } catch (e) {
      console.error("status reconcile", (e as Error).message);
    }
    return json({ open, break: open ? await openBreak() : null });
  }

  // Admins: who is on the clock right now according to Square (covers register punches too).
  if (body.action === "team_status") {
    if (!["admin", "owner"].includes(caller.profile.role)) return json({ error: "Admins only" }, 403);
    try {
      const found = await square("/labor/timecards/search", "POST", {
        query: { filter: { location_ids: [LOCATION], status: "OPEN" } }, limit: 100,
      });
      const { data: people } = await service.from("profiles").select("id, square_team_member_id").not("square_team_member_id", "is", null);
      const byTm = new Map((people ?? []).map((p) => [p.square_team_member_id, p.id]));
      const on = (found.timecards ?? []).map((t: { team_member_id: string; start_at: string }) => ({ user_id: byTm.get(t.team_member_id) ?? null, team_member_id: t.team_member_id, clock_in: t.start_at }));
      return json({ ok: true, on });
    } catch (e) { return json({ ok: false, error: (e as Error).message }); }
  }

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
    await service.from("time_breaks").update({ end_at: now.toISOString() }).eq("user_id", user.id).is("end_at", null);
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

  // Start a lunch (30, unpaid) or quick break (5, paid). Added to the open Square timecard.
  if (body.action === "break_start") {
    const kind = body.kind as Kind;
    if (!BREAKS[kind]) return json({ error: "Pick lunch or a quick break." }, 400);
    if (!open) return json({ error: "Clock in first." }, 409);
    if (await openBreak()) return json({ error: "You're already on a break." }, 409);
    const now = new Date();
    const { data: br, error } = await service.from("time_breaks").insert({ entry_id: open.id, user_id: user.id, kind, paid: BREAKS[kind].paid, start_at: now.toISOString() }).select().single();
    if (error) return json({ error: error.message }, 400);
    let squareNote = "";
    try {
      if (!open.square_timecard_id) throw new Error(Deno.env.get("SQUARE_ACCESS_TOKEN") ? "No Square timecard for this shift." : "NO_TOKEN");
      const bt = await breakType(kind);
      if (!bt) throw new Error(`No "${BREAKS[kind].name}" break type in Square.`);
      const cur = (await square(`/labor/timecards/${open.square_timecard_id}`)).timecard;
      const breaks = [...(cur.breaks ?? []).map((b: Record<string, unknown>) => (b.end_at ? b : { ...b, end_at: denver(now) })),
        { start_at: denver(now), break_type_id: bt.id, name: bt.break_name, expected_duration: bt.expected_duration, is_paid: bt.is_paid }];
      const upd = (await square(`/labor/timecards/${cur.id}`, "PUT", { timecard: { ...cur, breaks } })).timecard;
      await service.from("time_entries").update({ square_version: upd.version }).eq("id", open.id);
      await service.from("time_breaks").update({ square_status: "synced", paid: !!bt.is_paid }).eq("id", br.id);
    } catch (e) {
      const msg = (e as Error).message;
      await service.from("time_breaks").update({ square_status: msg === "NO_TOKEN" ? "pending" : "error", square_error: msg === "NO_TOKEN" ? null : msg }).eq("id", br.id);
      squareNote = msg === "NO_TOKEN" ? "" : "Break saved in the hub, but Square didn't take it. The office has been flagged.";
    }
    await service.from("activity_log").insert({ user_id: user.id, action: "break_start", detail: { kind } });
    return json({ ok: true, open, break: (await service.from("time_breaks").select("*").eq("id", br.id).single()).data, note: squareNote });
  }

  if (body.action === "break_end") {
    const br = await openBreak();
    if (!br) return json({ error: "You're not on a break." }, 409);
    const now = new Date();
    await service.from("time_breaks").update({ end_at: now.toISOString() }).eq("id", br.id);
    let squareNote = "";
    try {
      if (!open?.square_timecard_id) throw new Error(Deno.env.get("SQUARE_ACCESS_TOKEN") ? "No Square timecard for this shift." : "NO_TOKEN");
      const cur = (await square(`/labor/timecards/${open.square_timecard_id}`)).timecard;
      if ((cur.breaks ?? []).some((b: { end_at?: string }) => !b.end_at)) {
        const breaks = cur.breaks.map((b: Record<string, unknown>) => (b.end_at ? b : { ...b, end_at: denver(now) }));
        const upd = (await square(`/labor/timecards/${cur.id}`, "PUT", { timecard: { ...cur, breaks } })).timecard;
        await service.from("time_entries").update({ square_version: upd.version }).eq("id", open.id);
      }
      await service.from("time_breaks").update({ square_status: "synced", square_error: null }).eq("id", br.id);
    } catch (e) {
      const msg = (e as Error).message;
      await service.from("time_breaks").update({ square_status: msg === "NO_TOKEN" ? "pending" : "error", square_error: msg === "NO_TOKEN" ? null : msg }).eq("id", br.id);
      squareNote = msg === "NO_TOKEN" ? "" : "Saved in the hub, but Square didn't take it. The office has been flagged.";
    }
    await service.from("activity_log").insert({ user_id: user.id, action: "break_end", detail: { kind: br.kind } });
    return json({ ok: true, open, break: null, note: squareNote });
  }

  return json({ error: "Unknown action" }, 400);
});
