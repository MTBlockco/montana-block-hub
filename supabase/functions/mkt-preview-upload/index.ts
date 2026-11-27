// Saves a copy of a live Omnisend email's design so the Hub can preview it (Omnisend's API doesn't return designs).
// Called from an Omnisend editor page during a capture session. Requires a short-lived upload token that
// Claude sets in mkt_private ("preview_upload_token", JSON {value, expires}); outside a session there is no token.
// It can only write to mkt_omni_previews.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "https://app.omnisend.com", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await req.json().catch(() => ({}));
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: row } = await service.from("mkt_private").select("value").eq("key", "preview_upload_token").maybeSingle();
  let tok: any = null; try { tok = JSON.parse(row?.value ?? "null"); } catch {}
  if (!tok?.value || String(body.token ?? "") !== tok.value || Date.now() > Number(tok.expires)) return json({ error: "Not allowed" }, 403);
  const id = String(body.omni_id ?? ""), kind = String(body.kind ?? ""), html = String(body.html ?? "");
  if (!/^[a-f0-9]{24}$/i.test(id) || !["automation", "campaign"].includes(kind) || html.length < 200 || html.length > 400000) return json({ error: "Bad input" }, 400);
  const { error } = await service.from("mkt_omni_previews").upsert({ omni_id: id, kind, name: String(body.name ?? "").slice(0, 200), subject: String(body.subject ?? "").slice(0, 300), html, captured_at: new Date().toISOString(), captured_by: null });
  return error ? json({ error: error.message }, 500) : json({ ok: true });
});
