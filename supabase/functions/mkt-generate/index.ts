// Email Studio: Claude writes the email.
//  action "products": live retail catalog from Shopify (titles, prices, photos, stock) for the product picker.
//  action "generate": write a full email (subject options, preview text, blocks, hero graphic) from the brief.
//  action "revise":   rewrite the current draft following Mitchell's notes.
//  action "graphic":  redraw only the hero graphic.
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

// ---------- The email format Claude fills in ----------
const BLOCK_TYPES = ["hero", "heading", "text", "product", "products", "quote", "button", "steps", "divider", "signoff", "note"];
const draftTool = {
  name: "email_draft",
  description: "The finished marketing email for Montana Block Co., as structured blocks the app renders into branded HTML.",
  input_schema: {
    type: "object",
    required: ["subject_options", "subject", "preheader", "theme", "blocks", "hero_svg", "rationale"],
    properties: {
      subject_options: { type: "array", items: { type: "string" }, description: "3 distinct subject lines, under 50 characters each, no ALL CAPS, max one emoji total." },
      subject: { type: "string", description: "The recommended one of the three." },
      preheader: { type: "string", description: "Preview text, 40-90 characters, that adds to the subject instead of repeating it." },
      theme: { type: "string", description: "Key of one of the brand kit themes." },
      hero_svg: { type: "string", description: "The hero graphic as a complete <svg> 1200x600 (viewBox 0 0 1200 600). See graphic rules." },
      hero_alt: { type: "string", description: "Alt text for the hero graphic, including its words." },
      blocks: {
        type: "array",
        description: "Email body top to bottom. Start with one hero block. 5-12 blocks.",
        items: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", enum: BLOCK_TYPES },
            text: { type: "string", description: "heading/text/quote/note: the words. text allows **bold**, *italic*, [link](url) and blank-line paragraphs." },
            eyebrow: { type: "string" }, headline: { type: "string" }, sub: { type: "string" },
            handle: { type: "string", description: "product: a product handle from the catalog." },
            handles: { type: "array", items: { type: "string" }, description: "products: 2-4 handles from the catalog." },
            blurb: { type: "string", description: "product: one or two sentences on why this one." },
            label: { type: "string" }, url: { type: "string", description: "button: must be an mtblock.com link." },
            items: { type: "array", items: { type: "string" }, description: "steps: 2-5 short items." },
            cite: { type: "string", description: "quote: who said it. Only real, provided quotes." },
          },
        },
      },
      rationale: { type: "string", description: "2-3 sentences for Mitchell: the angle, who it's for, and why it fits the brand." },
    },
  },
};

function systemPrompt(kit: any, products: any[], recent: any[]) {
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

GRAPHIC RULES (hero_svg):
- A complete standalone SVG, width="1200" height="600" viewBox="0 0 1200 600", under 14,000 characters.
- Use the chosen theme's colors. Montana-made, crafted, rugged-refined look: layered mountain ridgelines, wood-grain line work, end-grain checkerboard patterns, growth rings, topo contour lines, pine silhouettes, simple badge/stamp shapes, brass rule lines. Flat, clean, print-like. No gradients heavier than two stops, no filters, no <image>, no external references, no scripts, no foreignObject.
- Type: font-family "Oswald" (uppercase, letter-spacing) for headlines and "Lora" (italic) for the accent line. Max 12 words of text in the graphic, all clearly legible on a phone (headline at least 64px). Keep text inside x 80-1120, y 60-540.
- Do not draw logos, brand marks of other companies, people, or the Montana Block logo (the email adds the real logo).

BLOCK GUIDE: hero (eyebrow, headline, sub = the words on/under the graphic), heading (text), text (text), product (handle, blurb), products (handles), quote (text, cite — only real provided quotes), button (label, url), steps (items), divider, note (small print like deadlines), signoff (text: a short personal sign-off from the shop crew, e.g. "— Mitchell and the crew at Montana Block").
Use at most 2 buttons. Keep the whole email readable in under 60 seconds (about 120-220 words of body copy).

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

// Strip anything unsafe from the SVG before it is stored.
function cleanSvg(svg: string) {
  let s = String(svg || "").trim();
  if (!s.startsWith("<svg")) s = s.slice(s.indexOf("<svg"));
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "").replace(/(href|xlink:href)="(?!#)[^"]*"/gi, "").replace(/<image[\s\S]*?>/gi, "");
  if (!/xmlns=/.test(s)) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return s.slice(0, 40000);
}

function sanitizeDraft(d: any, products: any[]) {
  const handles = new Set(products.map((p) => p.handle));
  const okUrl = (u: string) => /^https:\/\/(www\.)?mtblock\.com(\/|$)/i.test(String(u || ""));
  const blocks = (Array.isArray(d.blocks) ? d.blocks : []).filter((b: any) => BLOCK_TYPES.includes(b?.type)).map((b: any) => {
    if (b.type === "product" && !handles.has(b.handle)) return null;
    if (b.type === "products") b.handles = (b.handles ?? []).filter((h: string) => handles.has(h)).slice(0, 4);
    if (b.type === "products" && !b.handles.length) return null;
    if (b.type === "button" && !okUrl(b.url)) b.url = "https://mtblock.com/collections/all";
    if (typeof b.text === "string") b.text = b.text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m: string, t: string, u: string) => okUrl(u) ? `[${t}](${u})` : t);
    return b;
  }).filter(Boolean);
  return {
    subject_options: (d.subject_options ?? []).map(String).slice(0, 3),
    subject: String(d.subject ?? d.subject_options?.[0] ?? "").slice(0, 150),
    preheader: String(d.preheader ?? "").slice(0, 200),
    theme_key: String(d.theme ?? ""),
    hero_svg: cleanSvg(d.hero_svg),
    hero_alt: String(d.hero_alt ?? ""),
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

    if (!["generate", "revise", "graphic"].includes(action)) return json({ error: "Unknown action" }, 400);

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

    const [{ data: brand }, products, { data: recent }] = await Promise.all([
      userClient.from("mkt_brand").select("kit").eq("id", 1).single(),
      retailProducts(),
      userClient.from("mkt_campaigns").select("title, subject, planned_at").neq("id", id).not("subject", "is", null).order("planned_at", { ascending: false }).limit(12),
    ]);
    const kit = brand?.kit ?? {};
    const system = systemPrompt(kit, products, recent ?? []);

    const brief = {
      title: c.title, kind: c.kind, flow: c.flow_name ? `${c.flow_name} email #${c.flow_step ?? 1}` : null,
      goal: c.goal, persona: c.persona, send_date: c.planned_at, audience: c.audience?.label,
      ...c.brief, extra_instructions: String(body.instructions ?? "").slice(0, 3000),
    };
    const notes = String(body.instructions ?? "").slice(0, 3000);
    let userMsg: string;
    if (action === "generate") {
      userMsg = `Write this email from scratch.\nBRIEF:\n${JSON.stringify(brief, null, 1)}`;
    } else if (action === "revise") {
      userMsg = `Here is the current draft. Revise it following Mitchell's notes, keeping everything he didn't ask to change.\nNOTES: ${notes || "(tighten and improve it)"}\nBRIEF:\n${JSON.stringify(brief, null, 1)}\nCURRENT DRAFT:\n${JSON.stringify({ subject: c.subject, subject_options: c.subject_options, preheader: c.preheader, theme: c.theme?.key, blocks: c.blocks, hero_svg: c.hero_svg })}`;
    } else {
      userMsg = `Keep the subject, preheader, theme and blocks exactly as they are (return them unchanged) and draw a NEW hero_svg. ${notes ? "Direction for the graphic: " + notes : "Try a different composition than the current one."}\nHero words to use: ${JSON.stringify((c.blocks ?? []).find((b: any) => b.type === "hero") ?? {})}\nCURRENT DRAFT:\n${JSON.stringify({ subject: c.subject, subject_options: c.subject_options, preheader: c.preheader, theme: c.theme?.key, blocks: c.blocks })}`;
    }

    const { draft, usage } = await callClaude(system, [{ role: "user", content: userMsg }], apiKey);
    const d = sanitizeDraft(draft, products);
    const themes = kit.themes ?? {};
    const themeKey = themes[d.theme_key] ? d.theme_key : (c.theme?.key && themes[c.theme.key] ? c.theme.key : Object.keys(themes)[0]);

    await service.from("mkt_ai_log").insert({
      user_id: user.id, campaign_id: id, action, model: MODEL,
      input_tokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      output_tokens: usage.output_tokens ?? 0,
    });

    // Return the draft to the app; the app renders the HTML and graphic, then saves it as a draft.
    const used = products.filter((p) => d.blocks.some((b: any) => b.handle === p.handle || (b.handles ?? []).includes(p.handle)));
    return json({ draft: { ...d, theme_key: themeKey }, products: used });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
