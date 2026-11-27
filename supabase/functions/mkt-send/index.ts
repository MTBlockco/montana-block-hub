// Email Studio: the only door to the outside world, and it is locked by approval.
//  action "status":   is the email service (Omnisend) connected? Lists subscriber segments.
//  action "test":     sends a proof of a draft to up to 5 @mtblock.com inboxes (never to customers).
//  action "send":     sends or schedules an APPROVED email to the list. Requires all of:
//                       - caller is Mitchell or Brittany (owner/admin),
//                       - the email's status is "approved",
//                       - the content is byte-for-byte what was approved (hash match),
//                       - the business address is in the footer, the unsubscribe link is present,
//                       - the caller typed SEND.
//  action "refresh":  pulls the latest status of a sent/scheduled email from Omnisend.
//  action "cancel":   cancels a scheduled send in Omnisend.
import { cors, json, getCaller, rank } from "./common.ts";

const OMNI = "https://api.omnisend.com/api";
const OMNI_VERSION = "2026-03-15";

async function omni(key: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${OMNI}${path}`, {
    ...init,
    headers: {
      "Authorization": `Omnisend-API-Key ${key}`,
      "Omnisend-Version": OMNI_VERSION,
      "Accept": "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.message ?? data?.title ?? text.slice(0, 300);
    const code = data?.error?.code ?? data?.code ?? "";
    const friendly: Record<number, string> = {
      401: "Omnisend rejected the API key. Paste a fresh key in Settings.",
      402: "Your Omnisend plan doesn't cover this many sends. Upgrade the plan or narrow the audience.",
      403: "The Omnisend API key is missing a permission (needs campaigns, email templates and segments).",
      409: "Omnisend says this campaign isn't in a state that allows that.",
      422: code === "sender-email-not-available" ? "Set up and verify a sender address in Omnisend (Store settings > Sender) first." : `Omnisend couldn't accept the email: ${msg}`,
    };
    throw new Error(friendly[res.status] ?? `Omnisend error ${res.status}: ${msg}`);
  }
  return data;
}

const isShopAddress = (e: string) => /^[^\s@]+@mtblock\.com$/i.test(e.trim());

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const caller = await getCaller(req);
  if (caller instanceof Response) return caller;
  const { service, user, profile } = caller;
  if (rank(profile.role) < rank("admin")) return json({ error: "Not allowed." }, 403);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const log = (campaign_id: string | null, act: string, detail: Record<string, unknown> = {}) =>
    service.from("mkt_events").insert({ campaign_id, actor: user.id, action: act, detail });

  const { data: secret } = await service.from("mkt_private").select("value").eq("key", "omnisend_api_key").maybeSingle();
  const key = secret?.value ?? "";

  try {
    if (action === "status") {
      if (!key) return json({ connected: false });
      let segments: any[] = [];
      try {
        const s = await omni(key, "/segments?limit=100");
        const list = s?.segments ?? s?.data ?? (Array.isArray(s) ? s : []);
        segments = list.map((x: any) => ({ id: x.segmentID ?? x.id, name: x.name, size: x.contactsCount ?? x.size ?? null }));
      } catch (e) {
        return json({ connected: true, ok: false, error: (e as Error).message });
      }
      return json({ connected: true, ok: true, segments });
    }


    // Everything already in Omnisend (campaigns + automations), with subjects, timing and triggers,
    // so the Hub shows Omnisend as the source of truth.
    if (action === "library") {
      if (!key) return json({ connected: false });
      const [camps, autos] = await Promise.all([
        omni(key, "/campaigns?limit=100&view=summary&sort=updatedAt&direction=desc").catch((e) => ({ error: (e as Error).message })),
        omni(key, "/automations?limit=100").catch((e) => ({ error: (e as Error).message })),
      ]);
      const list = (x: any, k: string) => x?.[k] ?? x?.data ?? (Array.isArray(x) ? x : []);
      const campList = list(camps, "campaigns").filter((c: any) => !/^\[PROOF/.test(c.name ?? "")).slice(0, 40);
      const autoList = list(autos, "automations").slice(0, 40);
      const [cd, ad] = await Promise.all([
        Promise.all(campList.map((c: any) => omni(key, `/campaigns/${c.id ?? c.campaignID}`).catch(() => c))),
        Promise.all(autoList.map((a: any) => omni(key, `/automations/${a.id ?? a.automationID}`).catch(() => a))),
      ]);
      const dur = (d: any) => d ? `${d.amount} ${({ m: "min", h: "hr", d: "day", w: "wk" } as Record<string, string>)[d.units] ?? d.units}${d.amount === 1 ? "" : "s"}` : null;
      return json({
        connected: true,
        campaigns: cd.map((c: any) => ({
          id: c.id ?? c.campaignID, name: c.name, status: c.status, channel: c.channel,
          subject: c.content?.email?.subject ?? c.subject ?? null, preheader: c.content?.email?.preheader ?? null,
          sender: c.content?.email?.senderEmail ?? null,
          audience: (c.audience?.includedSegmentIDs ?? []).length ? "Segments" : "All subscribers",
          scheduledAt: c.sendingSettings?.scheduledAt ?? null, sentAt: c.startedAt ?? c.sentAt ?? null,
          createdAt: c.createdAt, updatedAt: c.updatedAt, url: `https://app.omnisend.com/campaigns/edit/${c.id}/content`,
        })),
        automations: ad.map((a: any) => {
          const blocks = a.blocks ?? [];
          const emails = blocks.filter((b: any) => b.action?.type === "sendEmail").map((b: any) => ({ subject: b.action.sendEmail.subject, preheader: b.action.sendEmail.preheader }));
          const delay = blocks.find((b: any) => b.type === "delay")?.delay?.duration;
          const inact = a.trigger?.inactivitySettings?.duration;
          return {
            id: a.id ?? a.automationID, name: a.name, enabled: !!a.isEnabled, status: a.isEnabled ? "live" : "off",
            trigger: a.trigger?.condition?.event ?? null, delay: dur(delay), inactivity: dur(inact), emails,
            updatedAt: a.updatedAt, url: a.url ?? `https://app.omnisend.com/automation/edit/${a.id}`,
          };
        }),
        errors: [camps?.error, autos?.error].filter(Boolean),
      });
    }

    // Read-only look at one Omnisend campaign, automation or template (ids are Omnisend's 24-char hex ids).
    if (action === "detail") {
      if (!key) return json({ connected: false });
      const kind = ({ campaign: "campaigns", automation: "automations", template: "email-templates" } as Record<string, string>)[String(body.kind)];
      const oid = String(body.oid ?? "");
      if (!kind || !/^[a-f0-9]{24}$/i.test(oid)) return json({ error: "Bad id" }, 400);
      return json({ ok: true, data: await omni(key, `/${kind}/${oid}`) });
    }

    // Results: per-email numbers and store totals from Omnisend's Reports API.
    if (action === "results") {
      if (!key) return json({ connected: false });
      const interval = ["last7Days", "last30Days", "last90Days", "thisMonth", "lastMonth", "thisYear"].includes(body.interval) ? body.interval : "last30Days";
      const perActivity = ["sent", "openedUnique", "openRate", "clickedUnique", "clickRate", "unsubscribedUnique", "unsubscribeRate", "attributedOrders", "attributedRevenue"];
      const r = await omni(key, "/analytics/reports", {
        method: "POST",
        body: JSON.stringify({
          queries: [
            { alias: "activities", metrics: perActivity.map((name) => ({ name })),
              dimensions: [{ name: "marketingActivityID" }, { name: "marketingActivityType" }],
              filters: [{ name: "messageChannel", operator: "in", values: ["Email"] }], dateRange: { interval } },
            { alias: "weekly", metrics: ["sent", "openedUnique", "clickedUnique", "attributedRevenue"].map((name) => ({ name })),
              dimensions: [{ name: "timestamp", granularity: "week" }],
              filters: [{ name: "messageChannel", operator: "in", values: ["Email"] }], dateRange: { interval } },
            { alias: "store", metrics: [{ name: "totalOrders" }, { name: "totalRevenue" }],
              dimensions: [{ name: "timestamp", granularity: "week" }], dateRange: { interval } },
          ],
        }),
      });
      const byAlias = Object.fromEntries((r?.reports ?? []).map((x: any) => [x.alias, x.rows ?? []]));
      return json({ connected: true, interval, activities: byAlias.activities ?? [], weekly: byAlias.weekly ?? [], store: byAlias.store ?? [] });
    }

    const id = String(body.id ?? "");
    const { data: c } = await service.from("mkt_campaigns").select("*").eq("id", id).single();
    if (!c) return json({ error: "Email not found." }, 404);
    const { data: brand } = await service.from("mkt_brand").select("kit").eq("id", 1).single();
    const kit = brand?.kit ?? {};

    if (action === "test") {
      if (!key) return json({ error: "Connect Omnisend in Settings first." }, 400);
      const to = (Array.isArray(body.to) ? body.to : [user.email]).map(String).filter(Boolean).slice(0, 5);
      if (!to.length || !to.every(isShopAddress)) return json({ error: "Proofs only go to @mtblock.com inboxes." }, 400);
      if (!c.html || !c.subject) return json({ error: "Write the email first." }, 400);
      const tpl = await omni(key, "/email-templates/import", { method: "POST", body: JSON.stringify({ name: `[PROOF] ${c.title} ${new Date().toISOString()}`, html: c.html }) });
      // A throwaway draft that is never sent to the list; only test-email is called on it.
      const draft = await omni(key, "/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: `[PROOF – DO NOT SEND] ${c.title}`.slice(0, 190), type: "regular", channel: "email", language: "en_US",
          content: { email: { subject: `[PROOF] ${c.subject}`, preheader: c.preheader ?? "", senderName: kit.sender_name || "Montana Block Co.", templateID: tpl.id ?? tpl.templateID } },
        }),
      });
      const draftId = draft.id ?? draft.campaignID;
      await omni(key, `/campaigns/${draftId}/test-email`, { method: "POST", body: JSON.stringify({ recipients: to }) });
      await omni(key, `/campaigns/${draftId}`, { method: "DELETE" }).catch(() => {});
      await log(id, "test_sent", { to, hash: c.content_hash });
      return json({ ok: true, to });
    }

    if (action === "send") {
      if (String(body.confirm ?? "") !== "SEND") return json({ error: "Type SEND to confirm." }, 400);
      if (c.status !== "approved") return json({ error: "This email isn't approved. Approve it first." }, 409);
      if (!c.approved_hash || c.approved_hash !== c.content_hash) return json({ error: "This email changed after approval. Review and approve it again." }, 409);
      if (c.esp_campaign_id) return json({ error: "This email was already handed to Omnisend." }, 409);
      if (!c.html.includes("[[unsubscribe_link]]") || !kit.address || !c.html.includes(String(kit.address).split(",")[0])) {
        return json({ error: "The footer needs the unsubscribe link and the business address." }, 400);
      }
      if (!key) return json({ error: "Connect Omnisend in Settings first." }, 400);

      const when = body.send_at ? new Date(body.send_at) : null;
      if (when && (isNaN(when.getTime()) || when.getTime() < Date.now() + 5 * 60 * 1000)) return json({ error: "Pick a send time at least 5 minutes from now." }, 400);

      // Claim it first so a double-click can't send twice.
      const { data: claimed } = await service.from("mkt_campaigns").update({ status: "sending", esp: "omnisend" })
        .eq("id", id).eq("status", "approved").eq("approved_hash", c.content_hash).is("esp_campaign_id", null).select("id");
      if (!claimed?.length) return json({ error: "Someone else is already sending this one." }, 409);

      try {
        const tpl = await omni(key, "/email-templates/import", { method: "POST", body: JSON.stringify({ name: `${c.title} (${new Date().toISOString().slice(0, 10)})`, html: c.html }) });
        const aud = c.audience ?? {};
        const audience = aud.type === "segments" && Array.isArray(aud.include) && aud.include.length
          ? { includedSegmentIDs: aud.include, ...(Array.isArray(aud.exclude) && aud.exclude.length ? { excludedSegmentIDs: aud.exclude } : {}) }
          : (Array.isArray(aud.exclude) && aud.exclude.length ? { excludedSegmentIDs: aud.exclude } : undefined);
        const camp = await omni(key, "/campaigns", {
          method: "POST",
          body: JSON.stringify({
            name: c.title.slice(0, 190), type: "regular", channel: "email", language: "en_US",
            content: { email: { subject: c.subject, preheader: c.preheader ?? "", senderName: kit.sender_name || "Montana Block Co.", templateID: tpl.id ?? tpl.templateID } },
            ...(audience ? { audience } : {}),
            sendingSettings: when ? { strategy: "scheduled", scheduledAt: when.toISOString() } : { strategy: "immediate" },
          }),
        });
        const espId = camp.id ?? camp.campaignID;
        await omni(key, `/campaigns/${espId}/send`, { method: "POST" });
        await service.from("mkt_campaigns").update({
          status: when ? "scheduled" : "sending", esp_campaign_id: espId, esp_status: when ? "scheduled" : "started",
          send_at: when ? when.toISOString() : new Date().toISOString(),
        }).eq("id", id);
        await log(id, when ? "scheduled" : "sent", { esp_campaign_id: espId, hash: c.content_hash, audience: c.audience, send_at: when });
        return json({ ok: true, esp_campaign_id: espId, scheduled: !!when });
      } catch (e) {
        // Put it back to approved so nothing is stuck; nothing reached customers if we got here before /send.
        await service.from("mkt_campaigns").update({ status: "approved" }).eq("id", id).eq("status", "sending").is("esp_campaign_id", null);
        await log(id, "send_failed", { error: (e as Error).message });
        throw e;
      }
    }

    if (action === "refresh" || action === "cancel") {
      if (!key || !c.esp_campaign_id) return json({ error: "Nothing to check yet." }, 400);
      if (action === "cancel") {
        await omni(key, `/campaigns/${c.esp_campaign_id}/cancel`, { method: "POST" });
        await service.from("mkt_campaigns").update({ status: "approved", esp_status: "canceled", esp_campaign_id: null, send_at: null }).eq("id", id);
        await log(id, "canceled", {});
        return json({ ok: true });
      }
      const s = await omni(key, `/campaigns/${c.esp_campaign_id}`);
      const st = s.status ?? "";
      const patch: Record<string, unknown> = { esp_status: st };
      if (st === "sent") { patch.status = "sent"; patch.sent_at = s.sentAt ?? s.endDate ?? new Date().toISOString(); }
      if (s.statistics || s.stats) patch.stats = s.statistics ?? s.stats;
      await service.from("mkt_campaigns").update(patch).eq("id", id);
      return json({ ok: true, esp_status: st });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
