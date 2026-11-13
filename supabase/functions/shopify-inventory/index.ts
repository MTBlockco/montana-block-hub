// Two-way inventory with Shopify.
//  - action "set":  an inventory editor corrects a product's count in the hub; it's written to Shopify first,
//                   then saved in the hub. Uses compare-and-set so a sale that happened meanwhile isn't overwritten.
//  - action "sync": pull all active, tracked product counts from Shopify into the hub.
// Auth: signed-in inventory editors (Mitchell, plus anyone with can_edit_inventory), or the nightly DB job token.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cors, json } from "./common.ts";

const SHOP = "brittany-316.myshopify.com";
const API = "2026-04";
const LOCATION = "gid://shopify/Location/67244589311";

let cachedToken: { value: string; expires: number } | null = null;
async function shopifyToken() {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;
  const id = Deno.env.get("SHOPIFY_CLIENT_ID"), secret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Shopify isn't connected to the hub yet.");
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) throw new Error(`Shopify sign-in failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
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
  if (!res.ok || out.errors) throw new Error(`Shopify error: ${JSON.stringify(out.errors ?? out).slice(0, 300)}`);
  return out.data;
}

const category = (title: string) =>
  title.startsWith("Bumblechutes") ? "Board care" : (title.startsWith("Short Sleeve") || title.startsWith("Hat -")) ? "Merch" : "Finished goods";

async function sync(service: ReturnType<typeof createClient>) {
  const rows: Record<string, unknown>[] = [];
  let after: string | null = null;
  do {
    const data = await gql(`query($after: String) {
      productVariants(first: 100, after: $after, query: "product_status:active") {
        pageInfo { hasNextPage endCursor }
        nodes { id sku title inventoryItem { id tracked inventoryLevel(locationId: "${LOCATION}") { quantities(names: ["available"]) { quantity } } } product { title } }
      } }`, { after });
    const pv = data.productVariants;
    for (const v of pv.nodes) {
      if (!v.inventoryItem?.tracked) continue;
      const qty = v.inventoryItem.inventoryLevel?.quantities?.[0]?.quantity ?? 0;
      rows.push({
        shopify_variant_id: v.id,
        shopify_inventory_item_id: v.inventoryItem.id,
        sku: v.sku || null,
        name: v.title === "Default Title" ? v.product.title : `${v.product.title} – ${v.title}`,
        category: category(v.product.title),
        unit: "ea",
        quantity: qty,
        source: "shopify",
        synced_at: new Date().toISOString(),
      });
    }
    after = pv.pageInfo.hasNextPage ? pv.pageInfo.endCursor : null;
  } while (after);

  // Upsert without overwriting a category someone changed in the hub.
  const { data: existing } = await service.from("inventory_items").select("shopify_variant_id, category").eq("source", "shopify");
  const known = new Map((existing ?? []).map((r) => [r.shopify_variant_id, r.category]));
  for (const r of rows) if (known.has(r.shopify_variant_id as string)) r.category = known.get(r.shopify_variant_id as string);
  const { error } = await service.from("inventory_items").upsert(rows, { onConflict: "shopify_variant_id" });
  if (error) throw new Error(error.message);

  const keep = new Set(rows.map((r) => r.shopify_variant_id));
  const stale = (existing ?? []).map((r) => r.shopify_variant_id).filter((id) => !keep.has(id));
  if (stale.length) await service.from("inventory_items").delete().in("shopify_variant_id", stale);
  return { synced: rows.length, removed: stale.length };
}

// Unfulfilled orders, line by line, for the Jobs > SHOPIFY / WHOLESALE tabs. No prices are returned.
async function openOrders() {
  const out: Record<string, unknown>[] = [];
  let after: string | null = null;
  do {
    const data = await gql(`query($after: String) {
      orders(first: 100, after: $after, sortKey: CREATED_AT, query: "status:open AND (fulfillment_status:unfulfilled OR fulfillment_status:partial)") {
        pageInfo { hasNextPage endCursor }
        nodes { id name createdAt tags displayFulfillmentStatus note
          customer { displayName } shippingAddress { company name } shippingLine { title }
          lineItems(first: 100) { nodes { title variantTitle sku unfulfilledQuantity requiresShipping variant { id } } } } } }`, { after });
    const o = data.orders;
    for (const n of o.nodes) {
      const lines = n.lineItems.nodes.filter((l: any) => l.unfulfilledQuantity > 0 && l.requiresShipping)
        .map((l: any) => ({ title: l.title, variant: l.variantTitle === "Default Title" ? null : l.variantTitle, sku: l.sku || null, qty: l.unfulfilledQuantity, variant_id: l.variant?.id ?? null }));
      if (!lines.length) continue;
      const wholesale = (n.tags ?? []).some((t: string) => /wholesale/i.test(t)) || lines.some((l: any) => /^wholesale/i.test(l.title));
      out.push({
        id: n.id, name: n.name, created_at: n.createdAt, status: n.displayFulfillmentStatus,
        customer: n.shippingAddress?.company || n.customer?.displayName || n.shippingAddress?.name || "",
        pickup: /pickup/i.test(n.shippingLine?.title ?? ""), note: n.note ?? null, wholesale, lines,
      });
    }
    after = o.pageInfo.hasNextPage ? o.pageInfo.endCursor : null;
  } while (after);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  // Who's calling?
  let userId: string | null = null;
  const cronHeader = req.headers.get("x-cron-token");
  if (cronHeader) {
    const { data } = await service.from("app_settings").select("value").eq("key", "cron_token").single();
    if (!data || data.value !== cronHeader) return json({ error: "Not allowed" }, 403);
  } else {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Not signed in" }, 401);
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);
    const { data: p } = await service.from("profiles").select("role, active, can_edit_inventory").eq("id", user.id).single();
    // Open orders (read-only, no prices) are for leads and up.
    if (body.action === "open_orders" && p?.active && ["lead", "admin", "owner"].includes(p.role)) {
      try { return json({ ok: true, orders: await openOrders() }); } catch (e) { return json({ error: (e as Error).message }, 502); }
    }
    if (!p || !p.active || !(p.role === "owner" || p.can_edit_inventory)) {
      return json({ error: "Only people Mitchell has given inventory access can change inventory." }, 403);
    }
    userId = user.id;
  }

  try {
    if (body.action === "sync") {
      const result = await sync(service);
      if (userId) await service.from("activity_log").insert({ user_id: userId, action: "sync_shopify", detail: result });
      return json({ ok: true, ...result });
    }

    if (body.action === "set" && userId) {
      const id = String(body.id ?? "");
      const next = Math.round(Number(body.quantity));
      if (!Number.isFinite(next)) return json({ error: "Enter a whole number" }, 400);
      const { data: item } = await service.from("inventory_items").select("*").eq("id", id).single();
      if (!item || item.source !== "shopify") return json({ error: "Not a Shopify item" }, 400);

      let invItemId = item.shopify_inventory_item_id;
      if (!invItemId) {
        const d = await gql(`query($id: ID!) { productVariant(id: $id) { inventoryItem { id } } }`, { id: item.shopify_variant_id });
        invItemId = d.productVariant.inventoryItem.id;
      }
      // Read Shopify's current number so a sale since the last sync isn't silently overwritten.
      const cur = await gql(`query($id: ID!) { inventoryItem(id: $id) { inventoryLevel(locationId: "${LOCATION}") { quantities(names: ["available"]) { quantity } } } }`, { id: invItemId });
      const shopifyNow = cur.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity ?? 0;
      if (body.expected !== undefined && Number(body.expected) !== shopifyNow) {
        await service.from("inventory_items").update({ quantity: shopifyNow, synced_at: new Date().toISOString(), shopify_inventory_item_id: invItemId }).eq("id", id);
        return json({ error: `Shopify shows ${shopifyNow} now (it changed since you loaded the page). Check the count and try again.`, current: shopifyNow }, 409);
      }

      const res = await gql(`mutation($input: InventorySetQuantitiesInput!, $key: String!) {
        inventorySetQuantities(input: $input) @idempotent(key: $key) { userErrors { field message code } } }`, {
        key: crypto.randomUUID(),
        input: {
          name: "available",
          reason: "correction",
          referenceDocumentUri: `montana-block-hub://inventory/${id}`,
          quantities: [{ inventoryItemId: invItemId, locationId: LOCATION, quantity: next, changeFromQuantity: shopifyNow }],
        },
      });
      const errs = res.inventorySetQuantities.userErrors;
      if (errs?.length) return json({ error: errs.map((e: { message: string }) => e.message).join("; ") }, 400);

      await service.from("inventory_items").update({
        quantity: next, synced_at: new Date().toISOString(), shopify_inventory_item_id: invItemId,
        updated_at: new Date().toISOString(), updated_by: userId,
      }).eq("id", id);
      await service.from("activity_log").insert({
        user_id: userId, action: "adjust_inventory", entity: "inventory", entity_id: id,
        detail: { name: item.name, from: shopifyNow, to: next, shopify: true },
      });
      return json({ ok: true, quantity: next });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 502);
  }
});
