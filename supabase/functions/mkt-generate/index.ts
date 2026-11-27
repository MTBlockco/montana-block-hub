// Email Studio: Claude writes the email.
//  action "products": live retail catalog from Shopify (titles, prices, photos, stock) for the product picker.
//  action "generate": write a full email (subject, preview text, blocks) from the brief, then proofread it.
//  action "revise":   rewrite the current draft following Mitchell's notes.
// Nothing here sends anything. Drafts are saved as "draft" and still need the owner's approval.
import { cors, json, getCaller, rank } from "./common.ts";

const MODEL = "claude-sonnet-5-5";
const DAILY_CAP = 80;
const SHOP = "brittany-316.myshopify.com";
const API = "2026-04";

// ---------- Shopify (same app credentials the hub already uses) ----------
let cachedToken: { value: string; expires: number } | null = null;
async function shopifyToken() {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;
  const id = Deno.env.get("SHOPIFY_CLIENT_ID"), secret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Shopify isn't connected yet.");
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) throw new Error(`Shopify sign-in failed (${res.status})`);
  const t = await res.json();
  cachedToken = { value: t.access_token, expires: Date.now() + (Number(t.expires_in ?? 3600) - 300) * 1000 };
  return cachedToken.value;
}
async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await shopifyToken() },
    body: JSON.stringify({ query, variables }),
  });
  const out = await res.json();
  if (!res.ok || out.errors) throw new Error(`Shopify error: ${JSON.stringify(out.errors ?? out).slice(0, 200)}`);
  return out.data;
}

let productCache: { at: number; rows: any[] } | null = null;
async function retailProducts() {
  if (productCache && Date.now() - productCache.at < 10 * 60 * 1000) return productCache.rows;
  const rows: any[] = [];
  let after: string | null = null;
  do {
    const data: any = await gql(`query($after: String) {
      products(first: 100, after: $after, query: "status:active AND published_status:published AND tag_not:Wholesale AND tag_not:MKC") {
        pageInfo { hasNextPage endCursor }
        nodes { id title handle tags productType vendor totalInventory description(truncateAt: 240)
          featuredMedia { preview { image { url } } }
          priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } } }
      } }`, { after });
    for (const p of data.products.nodes) {
      if (/wholesale|exclusive/i.test(p.title)) continue;
      rows.push({
        handle: p.handle, title: p.title, tags: p.tags, vendor: p.vendor, stock: p.totalInventory,
        price: Number(p.priceRangeV2.minVariantPrice.amount), price_max: Number(p.priceRangeV2.maxVariantPrice.amount),
        image: p.featuredMedia?.preview?.image?.url ?? null, url: `https://mtblock.com/products/${p.handle}`,
        description: p.description,
      });
    }
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  productCache = { at: Date.now(), rows };
  return rows;
}

// The store's own pages (care instructions, warranty, story, engraving...) so emails match what the site says.
let pagesCache: { at: number; text: string } | null = null;
async function sitePages() {
  if (pagesCache && Date.now() - pagesCache.at < 10 * 60 * 1000) return pagesCache.text;
  const data: any = await gql(`{ pages(first: 50) { nodes { title handle isPublished body } } }`);
  const strip = (h: string) => String(h || "").replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n").replace(/<li[^>]*>/gi, "- ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  const text = (data.pages.nodes ?? []).filter((p: any) => p.isPublished && p.body)
    .map((p: any) => `=== ${p.title} (https://mtblock.com/pages/${p.handle}) ===\n${strip(p.body).slice(0, 6000)}`).join("\n\n");
  pagesCache = { at: Date.now(), text };
  return text;
}

// ---------- The email format Claude fills in ----------
const BLOCK_TYPES = ["hero", "heading", "text", "callout", "product", "products", "quote", "button", "steps", "divider", "signoff", "note"];
const draftTool = {
  name: "email_draft",
  description: "The finished marketing email for Montana Block Co., as structured blocks the app renders into branded HTML.",
  input_schema: {
    type: "object",
    required: ["subject", "preheader", "blocks", "rationale"],
    properties: {
      subject: { type: "string", description: "The subject line: under 50 characters, no ALL CAPS, no emoji." },
      preheader: { type: "string", description: "Preview text, 40-90 characters, that adds to the subject instead of repeating it." },
      blocks: {
        type: "array",
        description: "Email body top to bottom. Start with one hero block (the headline). 5-12 blocks.",
        items: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", enum: BLOCK_TYPES },
            text: { type: "string", description: "heading/text/callout/quote/note/signoff: the words. Plain sentences only: no asterisks, no markdown, no emoji. Separate paragraphs with a blank line. [label](https://mtblock.com/...) links are allowed in text." },
            eyebrow: { type: "string" }, headline: { type: "string" }, sub: { type: "string" },
            handle: { type: "string", description: "product: a product handle from the catalog." },
            handles: { type: "array", items: { type: "string" }, description: "products: 2-4 handles from the catalog." },
            blurb: { type: "string", description: "product: one or two sentences on why this one." },
            label: { type: "string" }, url: { type: "string", description: "button: must be an mtblock.com link." },
            items: { type: "array", items: { type: "string" }, description: "steps: 2-5 items, each one or two complete sentences." },
            cite: { type: "string", description: "quote: who said it. Only real, provided quotes." },
          },
        },
      },
      rationale: { type: "string", description: "2-3 sentences for Mitchell: the angle, who it's for, and why it fits the brand." },
    },
  },
};

function systemPrompt(kit: any, products: any[], recent: any[], pages: string) {
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Denver", dateStyle: "full" });
  return `You are the email marketing director for Montana Block Co. (Montana Block LLC), a solid hardwood shop in Billings, Montana that handcrafts end grain butcher blocks, cutting, carving and serving boards, magnetic knife holders and custom pieces. Today is ${today}.

You write complete, ready-to-review marketing emails. Always deliver each email by calling the email_draft tool; never reply in plain text. A human (Mitchell, the owner) approves every email before it goes anywhere; you never imply it has been sent.

BRAND KIT (follow it exactly):
${JSON.stringify(kit, null, 1)}

STRATEGY YOU FOLLOW (learned from the best small-batch, made-in-USA brands such as Montana Knife Company, and from current ecommerce benchmarks):
- Build full-margin demand. Default to NO discounts or coupon codes. Use real reasons to act: real shipping and made-to-order deadlines from the brand kit, real small-batch stock counts from the catalog, engraving/personalization, gifting occasions, care and longevity.
- Every email solves one problem for one kind of customer, then hands them the product that solves it.
- Lead with the shop and the people: real wood, real hands, Billings Montana. Teach (end grain vs edge grain, species, care) so readers trust the brand.
- Plain, warm, confident, Montana-direct voice. Short sentences. No hype words (amazing, epic, game-changer, elevate, unleash), no fake urgency, no exclamation-point pileups.
- Never invent facts: no made-up reviews, quotes, awards, stock numbers, prices, discounts, timelines, partnerships or customer names. Use only the catalog and brand kit. If a fact you'd want isn't provided, write around it.
- Never mention Montana Knife Company or any customer or retailer by name unless the brand kit says that's approved.
- Only feature products that are in stock (stock > 0) unless the brief says made-to-order or pre-order; if a product is made to order, say so plainly.
- Links: only https://mtblock.com URLs (product urls from the catalog, https://mtblock.com/collections/all, or https://mtblock.com).

DESIGN: Every email uses the house template from the Black Walnut Friday email (dark charcoal, Montserrat, centered, logo on top, green rule, white headline, warm off-white body, tan accents, white square "Shop now" buttons under products). The app renders it; you only supply words and products. There is no header graphic.

WRITING STANDARD (Mitchell reads every word; errors are not acceptable):
- Complete, grammatical sentences. No sentence fragments ("Warm water, mild soap, quick scrub." is wrong; "Use warm water and a little mild soap." is right).
- American English, correct punctuation, Oxford comma, consistent tense, no run-ons, no comma splices.
- No asterisks, markdown, ALL CAPS words, or emoji in any text field.
- Speak as "we" (the shop). Keep it plain and specific.
- Before you call the tool, proofread every field line by line and fix anything that isn't clean.

BLOCK GUIDE: hero (headline = the big white title, 2-6 words; sub = optional one-sentence intro under it), callout (one short tan accent line, e.g. a date or the one thing to remember), heading (text), text (text), product (handle, blurb), products (handles), quote (text, cite — only real provided quotes), button (label, url), steps (items), divider, note (small print like deadlines), signoff (text: a short personal sign-off from the shop crew, e.g. "— Mitchell and the crew at Montana Block").
Use at most 2 buttons. Keep the whole email readable in under 60 seconds (about 120-220 words of body copy).

MTBLOCK.COM PAGES (the website's own words; when an email covers care, warranty, engraving, the story or the process, follow these pages exactly and don't contradict them. Exceptions: the brand kit overrides them where they conflict, e.g. we no longer sell or recommend Bumblechutes; we make our own board wax):
${pages}

LIVE RETAIL CATALOG (handle | title | price | stock | tags):
${products.map((p) => `${p.handle} | ${p.title} | $${p.price}${p.price_max > p.price ? "-" + p.price_max : ""} | stock ${p.stock} | ${p.tags.join(", ")}`).join("\n")}

RECENT EMAILS (don't repeat these angles or subject lines):
${recent.length ? recent.map((r) => `- ${r.planned_at?.slice(0, 10) ?? ""} ${r.subject ?? r.title}`).join("\n") : "(none yet)"}`;
}

async function callClaude(system: string, messages: any[], apiKey: string, retry = false): Promise<{ draft: any; usage: any }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: [draftTool],
      tool_choice: { type: "auto" },
      messages,
    }),
  });
  if (!res.ok) {
    console.error("Anthropic error", res.status, await res.text());
    throw new Error("Claude couldn't write that right now. Try again in a minute.");
  }
  const out = await res.json();
  const tool = (out.content ?? []).find((b: any) => b.type === "tool_use" && b.name === "email_draft");
  if (!tool) {
    if (!retry) return callClaude(system, [...messages, { role: "assistant", content: out.content }, { role: "user", content: "Deliver the email now by calling the email_draft tool. No other reply." }], apiKey, true);
    throw new Error("Claude didn't return a draft. Try again.");
  }
  return { draft: tool.input, usage: out.usage ?? {} };
}

// Second pass: a careful copyedit of the finished draft (grammar, fragments, punctuation), wording otherwise kept.
async function proofread(system: string, draft: any, apiKey: string) {
  const msg = `Copyedit this finished email draft before Mitchell sees it. Do not change any facts, instructions or content choices; only fix the language. Fix every grammar, spelling and punctuation error, every sentence fragment and every awkward phrase. Remove any asterisks or markdown. Keep the meaning, structure, products, links and tone. Return the whole corrected draft with the email_draft tool.\nDRAFT:\n${JSON.stringify(draft)}`;
  try { return await callClaude(system, [{ role: "user", content: msg }], apiKey); } catch { return { draft, usage: {} }; }
}

function sanitizeDraft(d: any, products: any[]) {
  const handles = new Set(products.map((p) => p.handle));
  const okUrl = (u: string) => /^https:\/\/(www\.)?mtblock\.com(\/|$)/i.test(String(u || ""));
  const blocks = (Array.isArray(d.blocks) ? d.blocks : []).filter((b: any) => BLOCK_TYPES.includes(b?.type)).map((b: any) => {
    if (b.type === "product" && !handles.has(b.handle)) return null;
    if (b.type === "products") b.handles = (b.handles ?? []).filter((h: string) => handles.has(h)).slice(0, 4);
    if (b.type === "products" && !b.handles.length) return null;
    if (b.type === "button" && !okUrl(b.url)) b.url = "https://mtblock.com/collections/all";
    for (const k of ["text", "headline", "sub", "blurb", "label", "eyebrow"]) if (typeof b[k] === "string") b[k] = b[k].replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/\*/g, "");
    if (Array.isArray(b.items)) b.items = b.items.map((x: string) => String(x).replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/\*/g, ""));
    if (typeof b.text === "string") b.text = b.text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m: string, t: string, u: string) => okUrl(u) ? `[${t}](${u})` : t);
    return b;
  }).filter(Boolean);
  return {
    subject_options: [],
    subject: String(d.subject ?? "").slice(0, 150),
    preheader: String(d.preheader ?? "").slice(0, 200),
    theme_key: String(d.theme ?? ""),
    hero_svg: "",
    hero_alt: "",
    blocks,
    rationale: String(d.rationale ?? ""),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const caller = await getCaller(req);
  if (caller instanceof Response) return caller;
  const { userClient, service, user, profile } = caller;
  if (rank(profile.role) < rank("admin")) return json({ error: "Email Studio is for Mitchell and the office." }, 403);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  try {
    if (action === "products") return json({ products: await retailProducts() });

    if (!["generate", "revise"].includes(action)) return json({ error: "Unknown action" }, 400);

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await service.from("mkt_ai_log").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
    if ((count ?? 0) >= DAILY_CAP) return json({ error: `Daily writing limit (${DAILY_CAP}) reached. It resets over the next 24 hours.` }, 429);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "Claude isn't switched on for the hub." }, 503);

    const id = String(body.id ?? "");
    const { data: c, error } = await userClient.from("mkt_campaigns").select("*").eq("id", id).single();
    if (error || !c) return json({ error: "Email not found." }, 404);
    if (["approved", "scheduled", "sending", "sent"].includes(c.status)) {
      return json({ error: "This email is approved or sent. Duplicate it to write a new version." }, 409);
    }

    const [{ data: brand }, products, { data: recent }, pages] = await Promise.all([
      userClient.from("mkt_brand").select("kit").eq("id", 1).single(),
      retailProducts(),
      userClient.from("mkt_campaigns").select("title, subject, planned_at").neq("id", id).not("subject", "is", null).order("planned_at", { ascending: false }).limit(12),
      sitePages().catch(() => ""),
    ]);
    const kit = brand?.kit ?? {};
    const system = systemPrompt(kit, products, recent ?? [], pages);

    const brief = {
      title: c.title, kind: c.kind, flow: c.flow_name ? `${c.flow_name} email #${c.flow_step ?? 1}` : null,
      goal: c.goal, persona: c.persona, send_date: c.planned_at, audience: c.audience?.label,
      ...c.brief, extra_instructions: String(body.instructions ?? "").slice(0, 3000),
    };
    const notes = String(body.instructions ?? "").slice(0, 3000);
    let userMsg: string;
    if (action === "generate") {
      userMsg = `Write this email from scratch.${notes ? `\nMITCHELL'S INSTRUCTIONS (follow every one of these exactly; they override anything else in the brief):\n${notes}` : ""}\nBRIEF:\n${JSON.stringify(brief, null, 1)}`;
    } else if (action === "revise") {
      userMsg = `Mitchell reviewed the current draft and wrote the critique below. Apply EVERY point in it exactly as he says, even if that means rewriting most of the email. His critique overrides the brief and your earlier choices. If he points you to something on the website, use the MTBLOCK.COM PAGES above. Then give the rest a quick polish.\nMITCHELL'S CRITIQUE:\n${notes || "(tighten and improve it)"}\nBRIEF:\n${JSON.stringify(brief, null, 1)}\nCURRENT DRAFT:\n${JSON.stringify({ subject: c.subject, preheader: c.preheader, blocks: c.blocks })}`;

    }

    const first = await callClaude(system, [{ role: "user", content: userMsg }], apiKey);
    const second = await proofread(system, first.draft, apiKey);
    const draft = second.draft, usage = {
      input_tokens: (first.usage.input_tokens ?? 0) + (second.usage.input_tokens ?? 0) + (first.usage.cache_read_input_tokens ?? 0) + (second.usage.cache_read_input_tokens ?? 0) + (first.usage.cache_creation_input_tokens ?? 0) + (second.usage.cache_creation_input_tokens ?? 0),
      output_tokens: (first.usage.output_tokens ?? 0) + (second.usage.output_tokens ?? 0) };
    const d = sanitizeDraft(draft, products);
    const themeKey = kit.default_theme || "black_walnut";

    if (notes) await service.from("mkt_events").insert({ campaign_id: id, actor: user.id, action: action === "revise" ? "critique" : "instructions", detail: { text: notes } });
    await service.from("mkt_ai_log").insert({
      user_id: user.id, campaign_id: id, action, model: MODEL,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
    });

    // Return the draft to the app; the app renders the HTML in the house template, then saves it as a draft.
    const used = products.filter((p) => d.blocks.some((b: any) => b.handle === p.handle || (b.handles ?? []).includes(p.handle)));
    return json({ draft: { ...d, theme_key: themeKey }, products: used });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
