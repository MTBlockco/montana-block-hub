// Ask Claude: answers employee questions from the shop's own data.
// Uses the cheapest model, caches the shop context, enforces a daily cap per person,
// and logs every question with its cost.
import { cors, json, getCaller } from "./common.ts";

const MODEL = "claude-haiku-5-5";
// USD per million tokens (Haiku 5.5, prompts up to 100k tokens). Cache writes estimated at 1.25x input.
const PRICE = { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 };
const MAX_CONTEXT_CHARS = 200_000; // keeps prompts well under the 100k-token price tier

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const caller = await getCaller(req);
  if (caller instanceof Response) return caller;
  const { userClient, service, user, profile } = caller;

  const body = await req.json().catch(() => ({}));
  const question = String(body.question ?? "").trim().slice(0, 2000);
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  if (!question) return json({ error: "Ask a question" }, 400);

  // Daily cap (rolling 24 hours)
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await service
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  const used = count ?? 0;
  if (used >= profile.daily_ai_limit) {
    return json({ error: `You've hit your limit of ${profile.daily_ai_limit} questions for today. Check the SOPs tab or ask a lead.` }, 429);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "Ask Claude isn't switched on yet." }, 503);

  // Gather only what this person is allowed to see (row level security applies).
  const [sops, inventory, jobs, announcements, team] = await Promise.all([
    userClient.from("sops").select("title, category, body").order("category"),
    userClient.from("inventory_items").select("category, name, sku, unit, quantity, reorder_point, reorder_qty, location, pack_size, vendor_sku, suppliers(name, order_method, website, phone)").order("category"),
    userClient.from("jobs").select("title, customer, channel, status, priority, due_date, notes").neq("status", "Shipped").order("due_date"),
    userClient.from("announcements").select("title, body, due_at").order("created_at", { ascending: false }).limit(20),
    userClient.from("profiles").select("full_name, title, role").eq("active", true),
  ]);

  const section = (name: string, rows: unknown[] | null) =>
    `## ${name}\n${rows && rows.length ? rows.map((r) => JSON.stringify(r)).join("\n") : "(none recorded yet)"}`;

  let context = [
    "# Montana Block Co. shop data",
    section("Standard operating procedures", (sops.data ?? []).map((s) => ({ title: s.title, category: s.category, body: s.body }))),
    section("Inventory", inventory.data),
    section("Open jobs", jobs.data),
    section("Announcements and reminders", announcements.data),
    section("Team", team.data),
  ].join("\n\n");
  if (context.length > MAX_CONTEXT_CHARS) context = context.slice(0, MAX_CONTEXT_CHARS) + "\n(truncated)";

  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Denver", dateStyle: "full" });
  const instructions =
    `You are the shop assistant for Montana Block Co., a solid hardwood fabrication shop in Billings, Montana. ` +
    `You answer questions from employees using ONLY the shop data provided. Today is ${today}. ` +
    `Be short and practical: a shop employee is reading on a phone, possibly with dusty hands. ` +
    `Quote SOP steps exactly when safety or finishing quality depends on them. ` +
    `If the answer isn't in the data, say so plainly and suggest who to ask (a lead or Mitchell). Never guess at measurements, finish schedules, or safety steps. ` +
    `You can't change records; if someone wants something updated, tell them which tab in the app to use.`;

  const messages = [
    ...history
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 2000) })),
    { role: "user", content: question },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: [
        { type: "text", text: instructions },
        { type: "text", text: context, cache_control: { type: "ephemeral" } },
      ],
      messages,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Anthropic error", res.status, detail);
    return json({ error: "Claude couldn't answer right now. Try again in a minute." }, 502);
  }

  const out = await res.json();
  const answer = (out.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
  const u = out.usage ?? {};
  const inputTokens = u.input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cost =
    (inputTokens * PRICE.input + outputTokens * PRICE.output + cacheRead * PRICE.cacheRead + cacheWrite * PRICE.cacheWrite) / 1_000_000;

  await service.from("ai_usage").insert({
    user_id: user.id,
    question,
    answer,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    cost_usd: cost,
  });

  return json({ answer, remaining: profile.daily_ai_limit - used - 1 });
});
