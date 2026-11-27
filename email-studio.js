// Email tab (Mitchell and Brittany only). Claude writes and designs the emails; an admin approves them;
// only then can they be handed to Omnisend. The database and the mkt-send function enforce the same rules,
// so nothing here is the only lock.
import { renderEmail } from "./email-render.js";

const TZ = "America/Denver";
let H = null;            // hub helpers: { sb, esc, toast, state, topbar, wireTopbar }
let kit = {};            // brand kit
let catalog = null;      // live Shopify retail products
let espStatus = null;    // Omnisend status (segments)
let library = null;      // campaigns + automations already in Omnisend
let sub = "today";       // which section of the Email tab
let openId = null;       // email open in the editor
let ed = null;           // editor state
let $root = null;

const esc = (s) => H.esc(s);
const toast = (m) => H.toast(m);
const fmtDate = (d, opts = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) =>
  d ? new Date(d).toLocaleString("en-US", { timeZone: TZ, ...opts }) : "";
const toLocalInput = (d) => {
  if (!d) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
};
const fromLocalInput = (v) => {
  if (!v) return null;
  const guess = new Date(v + ":00Z");
  const offset = new Date(guess.toLocaleString("en-US", { timeZone: TZ })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess.getTime() - offset).toISOString();
};
const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const pct = (n) => (n == null ? "—" : (Number(n) * 100).toFixed(1) + "%");
const num = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
const canApprove = () => ["admin", "owner"].includes(H.state.profile?.role);
const meEmail = () => H.state.session?.user?.email ?? "";

async function fn(name, body) {
  const { data, error } = await H.sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const STATUS = {
  planned: { label: "Planned", cls: "s-planned" }, draft: { label: "Draft – needs review", cls: "s-draft" },
  approved: { label: "Approved", cls: "s-approved" }, scheduled: { label: "Scheduled", cls: "s-scheduled" },
  sending: { label: "Sending", cls: "s-scheduled" }, sent: { label: "Sent", cls: "s-sent" },
  rejected: { label: "Rejected", cls: "s-rejected" }, archived: { label: "Archived", cls: "s-rejected" },
};
const OMNI_STATUS = { scheduled: "s-scheduled", sent: "s-sent", draft: "s-draft", started: "s-scheduled", sending: "s-scheduled", paused: "s-rejected", canceled: "s-rejected" };
const badge = (s) => `<span class="sbadge ${STATUS[s]?.cls ?? ""}">${esc(STATUS[s]?.label ?? s)}</span>`;
const themeOf = (key) => kit.themes?.[key] ?? Object.values(kit.themes ?? {})[0] ?? { bg: "#1f1813", panel: "#2a2019", text: "#f3e9dc", muted: "#c4b2a0", accent: "#d39b5c", accent2: "#d6a85a", button_text: "#1a120c", dark: true };
const personaName = (k) => (kit.personas ?? []).find((p) => p.key === k)?.name ?? k;

const SUBS = [["today", "Today"], ["calendar", "Calendar"], ["flows", "Automations"], ["results", "Results"], ["brand", "Brand kit"], ["plan", "The plan"], ["settings", "Settings"]];

// ---------------------------------------------------------------- entry point (called by the Hub)
export async function renderEmailTab(root, hub) {
  H = hub; $root = root;
  if (!canApprove()) { root.innerHTML = `<div class="empty">Email is for Mitchell and Brittany.</div>`; return; }
  const { data: b } = await H.sb.from("mkt_brand").select("kit").eq("id", 1).single();
  kit = b?.kit ?? {};
  if (openId) return renderEditor(openId);
  return paint();
}

function frame(title, actions = "") {
  $root.innerHTML = `${H.topbar(title, actions)}
    <div class="es">
      <nav class="subnav">${SUBS.map(([k, l]) => `<button data-sub="${k}" class="${!openId && sub === k ? "on" : ""}">${l}</button>`).join("")}</nav>
      <div id="esview"><p class="muted">Loading…</p></div>
    </div>`;
  H.wireTopbar($root);
  $root.querySelectorAll("[data-sub]").forEach((b) => (b.onclick = () => { sub = b.dataset.sub; openId = null; ed = null; paint(); }));
  return $root.querySelector("#esview");
}
const view = () => $root.querySelector("#esview");

function paint() {
  return ({ today: renderToday, calendar: renderCalendar, flows: renderFlows, results: renderResults, brand: renderBrand, plan: renderPlan, settings: renderSettings }[sub] ?? renderToday)();
}
function open(id) { openId = id; renderEditor(id); }
function wireOpen(el) { el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => open(b.dataset.open))); }

async function loadCampaigns(kind) {
  let q = H.sb.from("mkt_campaigns").select("id, kind, title, goal, persona, planned_at, status, subject, preheader, flow_name, flow_step, brief, theme, hero_url, approved_at, send_at, sent_at, esp_status, esp_campaign_id, updated_at").order("planned_at", { ascending: true, nullsFirst: false }).order("flow_name").order("flow_step");
  q = q.neq("status", "archived");
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) toast(error.message);
  return data ?? [];
}
async function getLibrary(force = false) {
  if (library && !force) return library;
  library = await fn("mkt-send", { action: "library" }).catch((e) => ({ connected: false, error: e.message, campaigns: [], automations: [] }));
  return library;
}

function card(c) {
  return `<button class="ecard" data-open="${c.id}">
    <div class="swatch" style="background:#202020;border-color:#0A8742"><span style="color:#C8B89F">${esc((c.flow_name || "MB").slice(0, 2).toUpperCase())}</span></div>
    <div class="ebody"><div class="row between"><b>${esc(c.title)}</b>${badge(c.status)}</div>
      <div class="small muted">${c.kind === "flow" ? esc(`${c.brief?.trigger ?? ""} · ${c.brief?.delay ?? ""}`) : esc(fmtDate(c.planned_at))}${c.persona && c.persona !== "all" ? " · " + esc(personaName(c.persona)) : ""}</div>
      ${c.subject ? `<div class="small subj">“${esc(c.subject)}”</div>` : `<div class="small muted">${esc(c.goal ?? "")}</div>`}
    </div></button>`;
}
// An email that lives only in Omnisend (built there by hand). Shown so the calendar is complete; edit it in Omnisend.
function extCard(o) {
  const when = o.scheduledAt || o.sentAt || o.updatedAt;
  return `<a class="ecard ext" href="${esc(o.url || "https://app.omnisend.com/campaigns")}" target="_blank" rel="noopener">
    <div class="swatch" style="background:#0f0d0c;border-color:#c79a62"><span class="small" style="color:#c79a62">OMNI</span></div>
    <div class="ebody"><div class="row between"><b>${esc(o.name)}</b><span class="sbadge ${OMNI_STATUS[o.status] ?? "s-planned"}">${esc(o.status)}</span></div>
      <div class="small muted">${esc(fmtDate(when))} · ${esc(o.audience || "All subscribers")} · open in Omnisend ↗</div>
      ${o.subject ? `<div class="small subj">“${esc(o.subject)}”</div>` : ""}</div></a>`;
}

async function newEmail() {
  const { data, error } = await H.sb.from("mkt_campaigns").insert({ kind: "campaign", title: "New email", status: "planned", theme: { key: kit.default_theme || Object.keys(kit.themes ?? {})[0] } }).select("id").single();
  if (error) return toast(error.message);
  open(data.id);
}

// ---------------------------------------------------------------- Today
async function renderToday() {
  frame("Email", `<button class="btn primary sm" id="new">+ New email</button>`);
  $root.querySelector("#new").onclick = newEmail;
  const [all, lib, res] = await Promise.all([loadCampaigns(), getLibrary(), fn("mkt-send", { action: "results", interval: "last30Days" }).catch(() => null)]);
  const now = Date.now();
  const ours = new Set(all.map((c) => c.esp_campaign_id).filter(Boolean));
  const review = all.filter((c) => c.status === "draft");
  const ready = all.filter((c) => c.status === "approved");
  const upcoming = all.filter((c) => c.kind === "campaign" && c.planned_at && new Date(c.planned_at).getTime() > now - 864e5 && c.status === "planned").slice(0, 4);
  const scheduled = all.filter((c) => ["scheduled", "sending"].includes(c.status));
  const extScheduled = (lib.campaigns ?? []).filter((o) => o.status === "scheduled" && !ours.has(o.id)).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  const extSent = (lib.campaigns ?? []).filter((o) => o.status === "sent" && !ours.has(o.id)).slice(0, 3);
  const toWrite = all.filter((c) => c.kind === "flow" && ["planned", "draft"].includes(c.status));
  const t = totals(res);
  view().innerHTML = `
    <div class="hero-note wood"><div><div class="eyebrow">The rule</div><b>Nothing goes out without approval from Mitchell or Brittany.</b>
      <div class="small">Claude writes and designs. You review, approve, then press Send. Any edit after approval cancels the approval.</div></div></div>
    ${!lib.connected ? `<div class="card warn-card"><b>Omnisend isn't connected.</b> Drafting, design and approvals still work. Connect it in Settings to send and see results.</div>` : ""}
    ${res ? `<div class="tiles">
      <div class="tile"><div class="k">Email revenue · 30 days</div><div class="v">${money(t.rev)}</div><div class="s">${num(t.orders)} orders from email</div></div>
      <div class="tile"><div class="k">Store revenue · 30 days</div><div class="v">${money(t.store)}</div><div class="s">${t.store ? pct(t.rev / t.store) : "—"} came from email</div></div>
      <div class="tile"><div class="k">Open rate</div><div class="v">${pct(t.sent ? t.opens / t.sent : null)}</div><div class="s">${num(t.sent)} emails sent</div></div>
      <div class="tile"><div class="k">Click rate</div><div class="v">${pct(t.sent ? t.clicks / t.sent : null)}</div><div class="s">${num(t.clicks)} people clicked</div></div>
    </div>` : ""}
    <div class="grid2">
      <section><h2>Needs review <span class="count">${review.length}</span></h2>${review.map(card).join("") || `<p class="muted small">Nothing waiting. Open a planned email and press Write it.</p>`}</section>
      <section><h2>Approved, ready to send <span class="count">${ready.length}</span></h2>${ready.map(card).join("") || `<p class="muted small">None yet.</p>`}
        ${scheduled.length || extScheduled.length ? `<h2 style="margin-top:18px">Scheduled in Omnisend</h2>${scheduled.map(card).join("")}${extScheduled.map(extCard).join("")}` : ""}</section>
    </div>
    ${toWrite.length ? `<section><h2>Automations to finish <span class="count">${toWrite.length}</span></h2>${toWrite.map(card).join("")}</section>` : ""}
    ${upcoming.length ? `<section><h2>Coming up next</h2>${upcoming.map(card).join("")}</section>` : ""}
    ${extSent.length ? `<section><h2>Recently sent</h2>${extSent.map(extCard).join("")}</section>` : ""}
    <section><h2>Running on their own <span class="count">${(lib.automations ?? []).filter((a) => a.enabled).length}</span></h2>
      <div class="card small">${(lib.automations ?? []).filter((a) => a.enabled).map((a) => `<div class="row between" style="padding:4px 0"><span>${esc(a.name)}</span><span class="muted">${esc(autoWhen(a))}</span></div>`).join("") || "None yet."}</div></section>`;
  wireOpen(view());
}

// Preview of a live Omnisend email (a copy of its design, captured from Omnisend's editor).
async function previewOmni(id, a) {
  const { data } = await H.sb.from("mkt_omni_previews").select("html, subject, captured_at").eq("omni_id", id).single();
  if (!data) return toast("No preview copy yet.");
  let device = "desktop";
  const m = modal(`<div class="row between"><h2 style="margin:0">${esc(a?.name ?? "Email")}</h2><button class="btn sm" id="x">Close</button></div>
    <div class="small muted">Subject: “${esc(a?.emails?.[0]?.subject ?? data.subject ?? "")}” · Sends ${esc(a ? autoWhen(a) : "")}</div>
    <div class="seg" style="align-self:flex-start"><button data-d="desktop" class="on">Desktop</button><button data-d="mobile">Phone</button></div>
    <div class="frame desktop" id="pvf"><iframe sandbox="allow-popups allow-popups-to-escape-sandbox" title="Email preview" style="height:70vh"></iframe></div>
    <div class="small muted">Copy of the live email in Omnisend as of ${esc(fmtDate(data.captured_at))}. Product blocks fill in with each customer's items when it sends.</div>`);
  m.classList.add("es"); m.querySelector(".es-modal-card").style.maxWidth = "720px";
  m.querySelector("iframe").srcdoc = data.html;
  m.querySelector("#x").onclick = () => m.remove();
  m.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => { device = b.dataset.d; m.querySelector("#pvf").className = "frame " + device; m.querySelectorAll("[data-d]").forEach((x) => x.classList.toggle("on", x === b)); }));
}

// ---------------------------------------------------------------- Calendar (ours + Omnisend's)
async function renderCalendar() {
  frame("Email calendar", `<button class="btn primary sm" id="new">+ New email</button>`);
  $root.querySelector("#new").onclick = newEmail;
  const [list, lib] = await Promise.all([loadCampaigns("campaign"), getLibrary()]);
  const ours = new Set(list.map((c) => c.esp_campaign_id).filter(Boolean));
  const items = [
    ...list.filter((c) => c.status !== "archived").map((c) => ({ when: c.send_at || c.planned_at, html: card(c) })),
    ...(lib.campaigns ?? []).filter((o) => !ours.has(o.id) && !/^\[PROOF/.test(o.name ?? "")).map((o) => ({ when: o.scheduledAt || o.sentAt || o.updatedAt, html: extCard(o) })),
  ].sort((a, b) => (a.when ? new Date(a.when) : Infinity) - (b.when ? new Date(b.when) : Infinity));
  const byWeek = {};
  for (const it of items) {
    const d = it.when ? new Date(it.when) : null;
    const key = d ? fmtDate(new Date(d.getTime() - ((d.getDay() + 6) % 7) * 864e5), { month: "long", day: "numeric" }) : "Not scheduled";
    (byWeek[key] ??= []).push(it.html);
  }
  view().innerHTML = `<p class="small muted">Dashed cards were built directly in Omnisend; tap one to open Omnisend.</p>` +
    (Object.entries(byWeek).map(([wk, h]) => `<section><h2>${wk === "Not scheduled" ? wk : "Week of " + esc(wk)}</h2>${h.join("")}</section>`).join("") || `<p class="muted">No emails yet.</p>`);
  wireOpen(view());
}

// ---------------------------------------------------------------- Automations
const TRIGGER = { "placed order": "after an order", "subscribed to marketing": "after someone signs up", "started checkout": "after an unfinished checkout" };
function autoWhen(a) {
  if (/engrav/i.test(a.name ?? "")) return `${a.delay ? a.delay + " " : ""}after an engraving order`;
  if (a.inactivity) { const h = (parseInt(a.inactivity) || 0) + (/hr/.test(a.delay || "") ? parseInt(a.delay) || 0 : 0); if (/hr/.test(a.inactivity)) return `${h} hours ${TRIGGER[a.trigger] ?? a.trigger ?? ""}`; }
  return `${a.delay ? a.delay + " " : ""}${TRIGGER[a.trigger] ?? a.trigger ?? ""}`.trim();
}
async function renderFlows() {
  frame("Automations");
  const [list, lib, { data: pv }] = await Promise.all([loadCampaigns("flow"), getLibrary(), H.sb.from("mkt_omni_previews").select("omni_id, captured_at")]);
  const live = (lib.automations ?? []);
  const hasPv = Object.fromEntries((pv ?? []).map((x) => [x.omni_id, x.captured_at]));
  view().innerHTML = `
    <section><h2>Live in Omnisend <span class="count">${live.filter((a) => a.enabled).length}</span></h2>
      ${live.map((a) => `<div class="ecard ext" ${hasPv[a.id] ? `data-pv="${esc(a.id)}" style="cursor:pointer"` : ""}>
        <div class="swatch" style="background:#0f0d0c;border-color:#c79a62"><span class="small" style="color:#c79a62">${a.enabled ? "LIVE" : "OFF"}</span></div>
        <div class="ebody"><div class="row between"><b>${esc(a.name)}</b><span class="sbadge ${a.enabled ? "s-approved" : "s-rejected"}">${a.enabled ? "Live" : "Off"}</span></div>
          <div class="small muted">Sends ${esc(autoWhen(a))} · ${a.emails.length} email${a.emails.length === 1 ? "" : "s"}</div>
          ${a.emails.map((e) => `<div class="small subj">“${esc(e.subject)}”</div>`).join("")}
          <div class="row wrap" style="margin-top:6px">${hasPv[a.id] ? `<button class="btn sm primary" data-pv="${esc(a.id)}">Preview</button>` : `<span class="small muted">No preview copy yet</span>`}<a class="btn sm" href="${esc(a.url)}" target="_blank" rel="noopener">Edit in Omnisend ↗</a></div></div></div>`).join("") || `<p class="small muted">${lib.connected ? "No automations yet." : "Connect Omnisend in Settings."}</p>`}
    </section>
    <section><h2>Approved to build <span class="count">${list.length}</span></h2>
      <div class="card small">Claude writes these here. Once you approve one, it gets set up in Omnisend and moves to the list above.</div>
      ${list.map(card).join("") || `<p class="small muted">Nothing waiting.</p>`}</section>`;
  wireOpen(view());
  view().querySelectorAll("[data-pv]").forEach((el) => (el.onclick = (e) => { if (e.target.closest("a")) return; e.stopPropagation(); previewOmni(el.dataset.pv, live.find((x) => x.id === el.dataset.pv)); }));
}

// ---------------------------------------------------------------- Results
function totals(r) {
  const acts = r?.activities ?? [];
  const sum = (k) => acts.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  return { sent: sum("sent"), opens: sum("openedUnique"), clicks: sum("clickedUnique"), rev: sum("attributedRevenue"), orders: sum("attributedOrders"),
    store: (r?.store ?? []).reduce((a, x) => a + (Number(x.totalRevenue) || 0), 0) };
}
let resInterval = "last30Days";
async function renderResults() {
  frame("Email results");
  const opts = [["last7Days", "Last 7 days"], ["last30Days", "Last 30 days"], ["last90Days", "Last 90 days"], ["thisMonth", "This month"], ["lastMonth", "Last month"], ["thisYear", "This year"]];
  const [r, lib] = await Promise.all([fn("mkt-send", { action: "results", interval: resInterval }).catch((e) => ({ error: e.message })), getLibrary()]);
  if (r.error || r.connected === false) { view().innerHTML = `<div class="card warn-card">${esc(r.error || "Connect Omnisend in Settings to see results.")}</div>`; return; }
  const names = Object.fromEntries([...(lib.campaigns ?? []), ...(lib.automations ?? [])].map((x) => [x.id, x.name]));
  const t = totals(r);
  const weeks = r.weekly ?? [];
  const max = Math.max(1, ...weeks.map((w) => Number(w.attributedRevenue) || 0));
  const rows = [...(r.activities ?? [])].sort((a, b) => (b.attributedRevenue || 0) - (a.attributedRevenue || 0) || (b.sent || 0) - (a.sent || 0));
  view().innerHTML = `
    <div class="row between" style="margin-bottom:12px"><select id="iv" style="max-width:220px">${opts.map(([k, l]) => `<option value="${k}" ${k === resInterval ? "selected" : ""}>${l}</option>`).join("")}</select>
      <span class="small muted">From Omnisend. Revenue is what Omnisend credits to an email (an order after an open or click).</span></div>
    <div class="tiles">
      <div class="tile"><div class="k">Email revenue</div><div class="v">${money(t.rev)}</div><div class="s">${num(t.orders)} orders</div></div>
      <div class="tile"><div class="k">Share of store revenue</div><div class="v">${t.store ? pct(t.rev / t.store) : "—"}</div><div class="s">of ${money(t.store)} total</div></div>
      <div class="tile"><div class="k">Emails sent</div><div class="v">${num(t.sent)}</div><div class="s">${num(t.opens)} opened</div></div>
      <div class="tile"><div class="k">Open rate</div><div class="v">${pct(t.sent ? t.opens / t.sent : null)}</div><div class="s">40%+ is strong</div></div>
      <div class="tile"><div class="k">Click rate</div><div class="v">${pct(t.sent ? t.clicks / t.sent : null)}</div><div class="s">${num(t.clicks)} people</div></div>
    </div>
    <div class="card"><h2>Email revenue by week</h2>
      <div class="bars">${weeks.map((w) => `<div class="b"><i style="height:${((Number(w.attributedRevenue) || 0) / max) * 100}%"></i><div class="tip">Week of ${esc(fmtDate(w.timestamp, { month: "short", day: "numeric" }))}<br>${money(w.attributedRevenue)} · ${num(w.sent)} sent</div></div>`).join("")}</div>
      <div class="xlab">${weeks.map((w, i) => `<span>${i % Math.ceil(weeks.length / 8) === 0 ? esc(fmtDate(w.timestamp, { month: "numeric", day: "numeric" })) : ""}</span>`).join("")}</div></div>
    <div class="card"><h2>By email</h2><div class="tablewrap"><table class="rt">
      <thead><tr><th>Email</th><th>Sent</th><th>Open</th><th>Click</th><th>Unsub</th><th>Orders</th><th>Revenue</th></tr></thead>
      <tbody>${rows.map((a) => `<tr><td>${esc(names[a.marketingActivityID] ?? a.marketingActivityID)} <span class="small muted">${a.marketingActivityType === "Automation" ? "· automation" : ""}</span></td>
        <td>${num(a.sent)}</td><td>${pct(a.openRate)}</td><td>${pct(a.clickRate)}</td><td>${pct(a.unsubscribeRate)}</td><td>${num(a.attributedOrders)}</td><td>${money(a.attributedRevenue)}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">Nothing sent in this period.</td></tr>`}</tbody>
    </table></div></div>`;
  view().querySelector("#iv").onchange = (e) => { resInterval = e.target.value; renderResults(); };
}

// ---------------------------------------------------------------- Editor
async function getCatalog() {
  if (catalog) return catalog;
  const r = await fn("mkt-generate", { action: "products" });
  catalog = Object.fromEntries((r.products ?? []).map((p) => [p.handle, p]));
  return catalog;
}

async function renderEditor(id) {
  frame("Email", `<button class="btn sm" id="back">← Back</button>`);
  const [{ data: c, error }, { data: events }] = await Promise.all([
    H.sb.from("mkt_campaigns").select("*").eq("id", id).single(),
    H.sb.from("mkt_events").select("action, detail, at").eq("campaign_id", id).order("at", { ascending: false }).limit(30),
  ]);
  if (error || !c) { openId = null; view().innerHTML = `<p>Couldn't find that email.</p>`; return; }
  ed = { c, events: events ?? [], device: ed?.c?.id === id ? ed.device : "desktop", busy: false, products: c.brief?._products ?? {} };
  paintEditor();
  getCatalog().then(() => { if (ed?.c.id === id) paintBlocks(); }).catch(() => {});
}

const frozen = () => ["scheduled", "sending", "sent"].includes(ed.c.status);
const q = (sel) => $root.querySelector(sel);

function paintEditor() {
  const c = ed.c;
  const themes = kit.themes ?? {};
  const personas = kit.personas ?? [];
  frame(c.kind === "flow" ? "Automation email" : "Email", `<button class="btn sm" id="back">← Back</button>`);
  q("#back").onclick = () => { openId = null; ed = null; if (c.kind === "flow" && sub === "today") sub = "flows"; paint(); };
  const dis = frozen() ? "disabled" : "";
  view().innerHTML = `
  <div class="statusbar">${badge(c.status)}
    ${c.approved_at ? `<span class="small muted">Approved ${esc(fmtDate(c.approved_at))}</span>` : ""}
    ${c.send_at ? `<span class="small muted">${c.status === "scheduled" ? "Goes out" : "Sent"} ${esc(fmtDate(c.send_at))}</span>` : ""}
    <span class="spacer"></span><span class="small muted" id="savestate"></span></div>
  <div class="editor">
    <div class="col-left">
      <div class="card stack">
        <h2>Brief</h2>
        <div><label>Name</label><input id="f-title" value="${esc(c.title)}" ${dis}></div>
        <div><label>What this email should do</label><textarea id="f-goal" rows="3" ${dis}>${esc(c.goal ?? "")}</textarea></div>
        <div class="row2">
          ${c.kind === "campaign" ? `<div><label>Send date (Mountain)</label><input id="f-date" type="datetime-local" value="${toLocalInput(c.planned_at)}" ${dis}></div>` : `<div><label>Trigger</label><input disabled value="${esc((c.brief?.trigger ?? "") + " · " + (c.brief?.delay ?? ""))}"></div>`}
          <div><label>Who it's for</label><select id="f-persona" ${dis}><option value="all">Everyone</option>${personas.map((p) => `<option value="${p.key}" ${c.persona === p.key ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
        </div>
        <div class="small muted">Design: the house template from the Black Walnut Friday email.</div>
        <div><label>Notes for Claude (optional)</label><textarea id="f-notes" rows="3" placeholder="e.g. Lead with the walnut Colossus. Mention we have 3 left. Keep it under 150 words." ${dis}></textarea></div>
        <div class="row wrap">
          <button class="btn primary" id="b-gen" ${dis}>${c.html ? "Rewrite from scratch" : "✍ Write it"}</button>
          ${c.html ? `<button class="btn" id="b-rev" ${dis}>Revise with my notes</button>` : ""}
        </div>
        ${c.brief?.rationale ? `<div class="small rationale"><b>Why this angle:</b> ${esc(c.brief.rationale)}</div>` : ""}
        ${c.brief?.needs_from_mitchell ? `<div class="small warn">Needs from you: ${esc(c.brief.needs_from_mitchell)}</div>` : ""}
      </div>
      ${c.html ? `<div class="card stack">
        <h2>Subject & preview</h2>
        ${(c.subject_options ?? []).length ? `<div class="subjects">${c.subject_options.map((s) => `<button class="subj-opt ${s === c.subject ? "on" : ""}" ${dis}>${esc(s)}</button>`).join("")}</div>` : ""}
        <div><label>Subject line <span class="muted" id="subjlen"></span></label><input id="f-subject" value="${esc(c.subject ?? "")}" ${dis}></div>
        <div><label>Preview text</label><input id="f-pre" value="${esc(c.preheader ?? "")}" ${dis}></div>
        <div><label>Audience</label><select id="f-aud" ${dis}></select><div class="small muted" id="audnote"></div></div>
      </div>
      <div class="card stack"><h2>Content</h2><div id="blocks"></div>
        <div class="row wrap"><select id="addtype" ${dis}><option value="">+ Add a block…</option>${["heading", "text", "callout", "product", "products", "button", "steps", "quote", "note", "divider", "signoff"].map((t) => `<option>${t}</option>`).join("")}</select></div>
      </div>` : ""}
      <div class="card stack"><h2>History</h2><div class="small">${ed.events.map((e) => `<div class="hist"><span>${esc(fmtDate(e.at))}</span> ${esc(e.action.replace(/_/g, " "))}${e.detail?.to ? " → " + esc(e.detail.to.join(", ")) : ""}${e.detail?.error ? ` <span class="bad">${esc(e.detail.error)}</span>` : ""}</div>`).join("") || "No activity yet."}</div></div>
    </div>
    <div class="col-right">
      <div class="preview-head"><div class="seg"><button data-dev="desktop" class="${ed.device === "desktop" ? "on" : ""}">Desktop</button><button data-dev="mobile" class="${ed.device === "mobile" ? "on" : ""}">Phone</button></div>
        </div>
      ${c.html ? `<div class="inbox"><div class="from">${esc(kit.sender_name || "Montana Block Co.")}</div><div class="isubj">${esc(c.subject ?? "")}</div><div class="ipre">${esc(c.preheader ?? "")}</div></div>` : ""}
      <div class="frame ${ed.device}">${c.html ? `<iframe id="pv" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Email preview"></iframe>` : `<div class="empty">No draft yet.<br>Fill in the brief and press <b>Write it</b>. Claude writes the copy and picks products from the live store; it lands in the Black Walnut Friday template.</div>`}</div>
      <div class="card stack approve-box" id="approvebox"></div>
    </div>
  </div>`;
  if (c.html) q("#pv").srcdoc = c.html;
  wireEditor();
  paintBlocks();
  paintApproveBox();
  paintAudience();
}

function wireEditor() {
  const c = ed.c;
  const onMeta = (id, field, conv = (x) => x) => q("#" + id)?.addEventListener("change", (e) => { c[field] = conv(e.target.value); save({ [field]: c[field] }); });
  onMeta("f-title", "title");
  onMeta("f-goal", "goal");
  onMeta("f-date", "planned_at", fromLocalInput);
  onMeta("f-persona", "persona");
  $root.querySelectorAll(".subj-opt").forEach((b) => (b.onclick = async () => { c.subject = b.textContent; await rerender(); paintEditor(); }));
  const subj = q("#f-subject");
  if (subj) {
    const len = () => (q("#subjlen").textContent = `(${subj.value.length} chars${subj.value.length > 50 ? " – long for phones" : ""})`);
    len(); subj.oninput = len;
    subj.onchange = () => { c.subject = subj.value; rerender(); };
    q("#f-pre").onchange = (e) => { c.preheader = e.target.value; rerender(); };
  }
  $root.querySelectorAll("[data-dev]").forEach((b) => (b.onclick = () => {
    ed.device = b.dataset.dev; q(".frame").className = "frame " + ed.device;
    $root.querySelectorAll("[data-dev]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  q("#b-gen")?.addEventListener("click", () => write("generate"));
  q("#b-rev")?.addEventListener("click", () => write("revise"));
  q("#addtype")?.addEventListener("change", (e) => {
    const t = e.target.value; e.target.value = ""; if (!t) return;
    const blank = { callout: { text: "Order by Dec 14" }, heading: { text: "Heading" }, text: { text: "Write something here." }, product: { handle: Object.keys(catalog ?? {})[0] ?? "", blurb: "" }, products: { handles: Object.keys(catalog ?? {}).slice(0, 2) }, button: { label: "Shop now", url: "https://mtblock.com/collections/all" }, steps: { items: ["Step one", "Step two"] }, quote: { text: "", cite: "" }, note: { text: "" }, divider: {}, signoff: { text: "— Mitchell and the crew at Montana Block" } }[t];
    for (const h of [blank.handle, ...(blank.handles ?? [])]) if (h && catalog?.[h]) ed.products[h] = catalog[h];
    const i = c.blocks.length - (c.blocks.at(-1)?.type === "signoff" ? 1 : 0);
    c.blocks.splice(i, 0, { type: t, ...blank });
    rerender(); paintBlocks();
  });
}

function guard() {
  if (frozen()) { toast("This one's already with Omnisend. Duplicate it to change anything."); return false; }
  return true;
}

// Re-render the HTML from blocks and save. Editing an approved email cancels its approval (the database enforces this too).
async function rerender() {
  if (!guard()) return;
  const c = ed.c;
  if (c.status === "approved") toast("You edited an approved email, so its approval was cancelled. Approve it again when you're happy.");
  c.html = renderEmail({ subject: c.subject, preheader: c.preheader, blocks: c.blocks, theme: themeOf(c.theme?.key), kit, heroUrl: c.hero_url, heroAlt: c.brief?.hero_alt, products: ed.products });
  const pv = q("#pv"); if (pv) pv.srcdoc = c.html;
  await save({ subject: c.subject, preheader: c.preheader, blocks: c.blocks, html: c.html, theme: c.theme, hero_url: c.hero_url, brief: { ...c.brief, _products: ed.products }, ...(c.status === "planned" ? { status: "draft" } : {}) });
}

async function save(patch) {
  const s = q("#savestate"); if (s) s.textContent = "Saving…";
  const { data, error } = await H.sb.from("mkt_campaigns").update(patch).eq("id", ed.c.id).select("*").single();
  if (error) { toast(error.message); if (s) s.textContent = "Not saved"; return; }
  const wasApproved = ed.c.status === "approved" && data.status !== "approved";
  // Keep what's on screen (it may be newer than the row), take the status fields from the database.
  ed.c = { ...data, ...patch, status: data.status, content_hash: data.content_hash, approved_hash: data.approved_hash, approved_at: data.approved_at };
  if (s) s.textContent = "Saved";
  if (wasApproved) paintEditor();
  else { paintApproveBox(); const b = $root.querySelector(".statusbar .sbadge"); if (b) b.outerHTML = badge(ed.c.status); }
}

// ------------------------------------------------ Claude writes
async function write(action) {
  if (!guard() || ed.busy) return;
  const c = ed.c;
  if (c.status === "approved" && !confirm("This email is approved. Rewriting it cancels the approval. Continue?")) return;
  const notes = q("#f-notes")?.value ?? "";
  ed.busy = true;
  const btns = $root.querySelectorAll("#b-gen,#b-rev,#b-art"); btns.forEach((b) => (b.disabled = true));
  const label = { generate: "Claude is writing and proofreading the email… (about a minute)", revise: "Claude is revising and proofreading…" }[action];
  q(".frame").insertAdjacentHTML("afterbegin", `<div class="working"><div class="spinner"></div>${label}</div>`);
  try {
    if (c.status === "approved") { await H.sb.rpc("mkt_unapprove", { p_id: c.id }); c.status = "draft"; }
    const r = await fn("mkt-generate", { action, id: c.id, instructions: notes });
    const d = r.draft;
    for (const p of r.products ?? []) ed.products[p.handle] = p;
    c.subject_options = d.subject_options; c.subject = d.subject; c.preheader = d.preheader; c.blocks = d.blocks;
    c.theme = { key: kit.default_theme || "black_walnut" };
    c.hero_svg = null; c.hero_url = null;
    c.brief = { ...(c.brief ?? {}), rationale: d.rationale };
    await save({ subject_options: c.subject_options, subject: c.subject, preheader: c.preheader, blocks: c.blocks, hero_svg: null, hero_url: null, brief: { ...c.brief, _products: ed.products }, theme: c.theme });
    await rerender();
    await H.sb.from("mkt_events").insert({ campaign_id: c.id, action: "generated", detail: { action } });
    toast("Draft is ready for review.");
    renderEditor(c.id);
  } catch (e) {
    toast(e.message);
    q(".working")?.remove();
  } finally {
    ed && (ed.busy = false); btns.forEach((b) => (b.disabled = false));
  }
}

// ------------------------------------------------ Block editor
function paintBlocks() {
  const el = q("#blocks"); if (!el || !ed) return;
  const c = ed.c, dis = frozen() ? "disabled" : "";
  const source = catalog ?? ed.products;
  const prodOpts = (sel) => Object.values(source).map((p) => `<option value="${esc(p.handle)}" ${p.handle === sel ? "selected" : ""}>${esc(p.title)} — $${p.price}${p.stock != null ? ` (${p.stock} in stock)` : ""}</option>`).join("");
  el.innerHTML = (c.blocks ?? []).map((b, i) => {
    let f = "";
    if (b.type === "hero") f = `<input data-k="headline" value="${esc(b.headline ?? "")}" placeholder="Headline" ${dis}><textarea data-k="sub" rows="2" placeholder="Intro line under the headline (optional)" ${dis}>${esc(b.sub ?? "")}</textarea>`;
    else if (["heading", "note", "signoff", "callout"].includes(b.type)) f = `<input data-k="text" value="${esc(b.text ?? "")}" ${dis}>`;
    else if (b.type === "text") f = `<textarea data-k="text" rows="${Math.min(10, 2 + Math.ceil((b.text ?? "").length / 70))}" ${dis}>${esc(b.text ?? "")}</textarea>`;
    else if (b.type === "quote") f = `<textarea data-k="text" rows="2" ${dis}>${esc(b.text ?? "")}</textarea><input data-k="cite" value="${esc(b.cite ?? "")}" placeholder="Who said it (real quotes only)" ${dis}>`;
    else if (b.type === "button") f = `<input data-k="label" value="${esc(b.label ?? "")}" ${dis}><input data-k="url" value="${esc(b.url ?? "")}" ${dis}>`;
    else if (b.type === "steps") f = `<textarea data-k="items" rows="${(b.items ?? []).length + 1}" ${dis}>${esc((b.items ?? []).join("\n"))}</textarea><div class="small muted">One step per line.</div>`;
    else if (b.type === "product") f = `<select data-k="handle" ${dis}>${prodOpts(b.handle)}</select><textarea data-k="blurb" rows="2" ${dis}>${esc(b.blurb ?? "")}</textarea>`;
    else if (b.type === "products") f = `<select data-k="handles" multiple size="5" ${dis}>${Object.values(source).map((p) => `<option value="${esc(p.handle)}" ${(b.handles ?? []).includes(p.handle) ? "selected" : ""}>${esc(p.title)} — $${p.price}</option>`).join("")}</select><div class="small muted">Pick 2–4 (Ctrl/Cmd-click).</div>`;
    return `<div class="blk" data-i="${i}"><div class="blk-head"><b>${esc(b.type)}</b><span class="spacer"></span>
      <button class="btn icon sm" data-act="up" ${dis} title="Move up">↑</button><button class="btn icon sm" data-act="down" ${dis} title="Move down">↓</button><button class="btn icon sm danger" data-act="del" ${dis} title="Remove">✕</button></div>${f}</div>`;
  }).join("");
  el.querySelectorAll(".blk").forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelectorAll("[data-k]").forEach((inp) => inp.addEventListener("change", () => {
      const k = inp.dataset.k; const b = c.blocks[i];
      if (k === "items") b.items = inp.value.split("\n").map((x) => x.trim()).filter(Boolean);
      else if (k === "handles") b.handles = [...inp.selectedOptions].map((o) => o.value).slice(0, 4);
      else b[k] = inp.value;
      if ((k === "handle" || k === "handles") && catalog) for (const h of [b.handle, ...(b.handles ?? [])]) if (h && catalog[h]) ed.products[h] = catalog[h];
      rerender();
    }));
    row.querySelectorAll("[data-act]").forEach((btn) => (btn.onclick = () => {
      const a = btn.dataset.act;
      if (a === "del") c.blocks.splice(i, 1);
      if (a === "up" && i > 0) [c.blocks[i - 1], c.blocks[i]] = [c.blocks[i], c.blocks[i - 1]];
      if (a === "down" && i < c.blocks.length - 1) [c.blocks[i + 1], c.blocks[i]] = [c.blocks[i], c.blocks[i + 1]];
      rerender(); paintBlocks();
    }));
  });
}

// ------------------------------------------------ Audience
async function paintAudience() {
  const sel = q("#f-aud"); if (!sel) return;
  const c = ed.c;
  espStatus ??= await fn("mkt-send", { action: "status" }).catch(() => ({ connected: false }));
  const segs = espStatus.segments ?? [];
  const cur = c.audience?.type === "segments" ? c.audience.include?.[0] : "all";
  sel.innerHTML = `<option value="all">All subscribers</option>${segs.map((s) => `<option value="${esc(s.id)}" ${cur === s.id ? "selected" : ""}>${esc(s.name)}${s.size != null ? ` (${s.size})` : ""}</option>`).join("")}`;
  q("#audnote").textContent = espStatus.connected ? (segs.length ? "Segments come from Omnisend." : "No segments in Omnisend yet. Make some there (e.g. Engaged 90 days, Past buyers) and they'll show here.") : "Connect Omnisend in Settings to target segments.";
  sel.onchange = () => {
    const s = segs.find((x) => x.id === sel.value);
    c.audience = s ? { type: "segments", include: [s.id], label: s.name } : { type: "all", label: "All subscribers" };
    save({ audience: c.audience });
  };
}

// ------------------------------------------------ Approve / proof / send
function paintApproveBox() {
  const box = q("#approvebox"); if (!box || !ed) return;
  const c = ed.c;
  const proof = `<button class="btn" id="b-proof" ${!c.html ? "disabled" : ""}>Email me a proof</button>`;
  const copy = c.status === "approved" || c.status === "sent" ? `<button class="btn" id="b-copy">Copy HTML</button>` : "";
  if (!c.html) { box.innerHTML = `<h2>Review</h2><p class="small muted">Write the email first.</p>`; return; }
  if (c.status === "draft" || c.status === "planned" || c.status === "rejected") {
    box.innerHTML = `<h2>Review</h2>
      <p class="small">Read it top to bottom in the preview. Check the subject, the products, prices and dates.</p>
      <div class="row wrap"><button class="btn primary" id="b-approve">Approve this email</button> ${proof}
      <button class="btn danger sm" id="b-reject">Reject</button><button class="btn sm" id="b-dup">Duplicate</button></div>`;
  } else if (c.status === "approved") {
    box.innerHTML = `<h2>Approved ✓</h2>
      <p class="small">Approved ${esc(fmtDate(c.approved_at))}. It's locked to this exact version — any edit cancels the approval.</p>
      <div class="small muted">Audience: <b>${esc(c.audience?.label ?? "All subscribers")}</b>${c.planned_at ? ` · Planned: <b>${esc(fmtDate(c.planned_at))}</b>` : ""}</div>
      <div class="row wrap">${c.kind === "campaign" ? `<button class="btn primary" id="b-send">Send…</button>` : ""}${proof}${copy}<button class="btn sm" id="b-unapprove">Un-approve</button><button class="btn sm" id="b-dup">Duplicate</button></div>
      ${c.kind === "flow" ? `<p class="small muted">Automation emails go live in Omnisend's automation editor: Copy HTML, paste into the matching step.</p>` : ""}`;
  } else {
    box.innerHTML = `<h2>${esc(STATUS[c.status]?.label)}</h2>
      <p class="small">${c.status === "scheduled" ? `Scheduled for ${esc(fmtDate(c.send_at))}.` : c.status === "sent" ? `Sent ${esc(fmtDate(c.sent_at ?? c.send_at))}.` : "Omnisend is sending it now."} Omnisend status: <b>${esc(c.esp_status ?? "—")}</b></p>
      <div class="row wrap"><button class="btn" id="b-refresh">Check status</button>${c.status === "scheduled" ? `<button class="btn danger" id="b-cancel">Cancel send</button>` : ""}${copy}<button class="btn sm" id="b-dup">Duplicate</button></div>`;
  }
  const on = (id, f) => box.querySelector("#" + id)?.addEventListener("click", f);
  on("b-approve", approveFlow);
  on("b-unapprove", async () => { await H.sb.rpc("mkt_unapprove", { p_id: c.id }); renderEditor(c.id); });
  on("b-reject", async () => { await save({ status: "rejected" }); await H.sb.from("mkt_events").insert({ campaign_id: c.id, action: "rejected" }); renderEditor(c.id); });
  on("b-dup", duplicate);
  on("b-proof", proofFlow);
  on("b-send", sendFlow);
  on("b-copy", async () => { try { await navigator.clipboard.writeText(c.html); toast("HTML copied."); } catch { toast("Couldn't copy here."); } });
  on("b-refresh", async () => { try { const r = await fn("mkt-send", { action: "refresh", id: c.id }); toast("Omnisend: " + r.esp_status); renderEditor(c.id); } catch (e) { toast(e.message); } });
  on("b-cancel", async () => { if (!confirm("Cancel this scheduled send?")) return; try { await fn("mkt-send", { action: "cancel", id: c.id }); toast("Cancelled. It's back to approved."); renderEditor(c.id); } catch (e) { toast(e.message); } });
}

function modal(html) {
  const m = document.createElement("div"); m.className = "es-modal";
  m.innerHTML = `<div class="es-modal-card card stack">${html}</div>`;
  document.body.appendChild(m);
  m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
  return m;
}

async function approveFlow() {
  const { data: fresh } = await H.sb.from("mkt_campaigns").select("*").eq("id", ed.c.id).single();
  ed.c = fresh;
  const c = fresh;
  const m = modal(`<h2>Approve this email?</h2>
    <div class="kv"><span>Subject</span><b>${esc(c.subject)}</b></div>
    <div class="kv"><span>Preview text</span><b>${esc(c.preheader ?? "")}</b></div>
    <div class="kv"><span>Audience</span><b>${esc(c.audience?.label ?? "All subscribers")}</b></div>
    ${c.kind === "campaign" ? `<div class="kv"><span>Planned send</span><b>${esc(fmtDate(c.planned_at) || "Not set")}</b></div>` : ""}
    <label class="check"><input type="checkbox" id="ok1"> I read the whole email, and the prices, products and dates are right.</label>
    <p class="small muted">Approving locks this exact version. It still won't go out until someone presses Send.</p>
    <div class="row"><button class="btn primary" id="yes" disabled>Approve</button><button class="btn" id="no">Not yet</button></div>`);
  m.querySelector("#ok1").onchange = (e) => (m.querySelector("#yes").disabled = !e.target.checked);
  m.querySelector("#no").onclick = () => m.remove();
  m.querySelector("#yes").onclick = async () => {
    const { error } = await H.sb.rpc("mkt_approve", { p_id: c.id, p_hash: c.content_hash });
    m.remove();
    if (error) return toast(error.message);
    toast("Approved. Nothing has been sent.");
    renderEditor(c.id);
  };
}

async function proofFlow() {
  const m = modal(`<h2>Email a proof</h2><p class="small">Sends a test copy only to Montana Block inboxes, never to customers. Goes through Omnisend so it looks exactly like what customers would get.</p>
    <div><label>Send to (up to 5, @mtblock.com only)</label><input id="to" value="${esc(meEmail())}"></div>
    <div class="row"><button class="btn primary" id="go">Send proof</button><button class="btn" id="no">Cancel</button></div>`);
  m.querySelector("#no").onclick = () => m.remove();
  m.querySelector("#go").onclick = async () => {
    const to = m.querySelector("#to").value.split(/[,\s]+/).filter(Boolean);
    m.querySelector("#go").disabled = true;
    try { await fn("mkt-send", { action: "test", id: ed.c.id, to }); toast("Proof sent to " + to.join(", ")); m.remove(); }
    catch (e) { toast(e.message); m.querySelector("#go").disabled = false; }
  };
}

async function sendFlow() {
  const c = ed.c;
  const st = espStatus ?? (await fn("mkt-send", { action: "status" }).catch(() => ({ connected: false })));
  if (!st.connected) return toast("Connect Omnisend in Settings first.");
  const planned = c.planned_at && new Date(c.planned_at).getTime() > Date.now() + 6 * 60 * 1000 ? toLocalInput(c.planned_at) : "";
  const m = modal(`<h2>Send to customers</h2>
    <div class="kv"><span>Subject</span><b>${esc(c.subject)}</b></div>
    <div class="kv"><span>Audience</span><b>${esc(c.audience?.label ?? "All subscribers")}</b></div>
    <div class="row2"><label class="check"><input type="radio" name="when" value="later" ${planned ? "checked" : ""}> Schedule</label><label class="check"><input type="radio" name="when" value="now" ${planned ? "" : "checked"}> Send now</label></div>
    <div><label>Send time (Mountain)</label><input type="datetime-local" id="at" value="${planned}"></div>
    <div><label>Type <b>SEND</b> to confirm</label><input id="confirm" autocomplete="off" placeholder="SEND"></div>
    <div class="row"><button class="btn primary" id="go" disabled>Send</button><button class="btn" id="no">Cancel</button></div>`);
  const go = m.querySelector("#go");
  m.querySelector("#confirm").oninput = (e) => (go.disabled = e.target.value.trim() !== "SEND");
  m.querySelector("#no").onclick = () => m.remove();
  go.onclick = async () => {
    const later = m.querySelector('input[name="when"]:checked').value === "later";
    const send_at = later ? fromLocalInput(m.querySelector("#at").value) : null;
    if (later && !send_at) return toast("Pick a send time.");
    go.disabled = true; go.textContent = "Handing to Omnisend…";
    try {
      const r = await fn("mkt-send", { action: "send", id: c.id, confirm: "SEND", send_at });
      m.remove(); library = null; toast(r.scheduled ? "Scheduled." : "Sending now."); renderEditor(c.id);
    } catch (e) { toast(e.message); go.disabled = false; go.textContent = "Send"; }
  };
}

async function duplicate() {
  const c = ed.c;
  const { data, error } = await H.sb.from("mkt_campaigns").insert({
    kind: c.kind, flow_name: c.flow_name, flow_step: c.flow_step, title: c.title + " (copy)", goal: c.goal, persona: c.persona,
    planned_at: c.planned_at, status: c.html ? "draft" : "planned", subject: c.subject, subject_options: c.subject_options, preheader: c.preheader,
    theme: c.theme, blocks: c.blocks, html: c.html, hero_svg: c.hero_svg, hero_url: c.hero_url, audience: c.audience, brief: c.brief,
  }).select("id").single();
  if (error) return toast(error.message);
  open(data.id);
}

// ---------------------------------------------------------------- Brand kit
function renderBrand() {
  frame("Brand kit", `<button class="btn primary sm" id="save">Save</button>`);
  const k = kit;
  const list = (arr) => (arr ?? []).join("\n");
  view().innerHTML = `
    <p class="muted small">Claude reads this before every email. Change it here and every new draft follows.</p>
    <div class="card stack"><h2>The basics</h2>
      <div class="row2"><div><label>Business name in emails</label><input id="k-name" value="${esc(k.name)}"></div><div><label>Sender name</label><input id="k-sender" value="${esc(k.sender_name)}"></div></div>
      <div><label>Mailing address (required by law in every marketing email)</label><input id="k-address" value="${esc(k.address)}"></div>
      <div class="row2"><div><label>Phone</label><input id="k-phone" value="${esc(k.phone)}"></div><div><label>Logo image link</label><input id="k-logo" value="${esc(k.logo_url)}"></div></div>
      <div><label>One-liner</label><input id="k-one" value="${esc(k.one_liner)}"></div>
      <div><label>Our story (Claude uses this)</label><textarea id="k-story" rows="4">${esc(k.story)}</textarea></div>
    </div>
    <div class="card stack"><h2>Voice</h2>
      <div><label>How we sound (one per line)</label><textarea id="k-voice" rows="4">${esc(list(k.voice))}</textarea></div>
      <div><label>Never do (one per line)</label><textarea id="k-never" rows="6">${esc(list(k.never))}</textarea></div>
      <div><label>Approved to mention by name (customers, partners, press). Leave blank until you have permission.</label><textarea id="k-mentions" rows="2">${esc(k.approved_mentions ?? "")}</textarea></div>
      <div><label>Other notes for the writer</label><textarea id="k-notes" rows="2">${esc(k.notes_for_writer ?? "")}</textarea></div>
    </div>
    <div class="card stack"><h2>Dates & deadlines Claude can use</h2>
      <textarea id="k-dates" rows="5">${esc(Object.values(k.deadlines_2026 ?? {}).join("\n"))}</textarea><div class="small muted">One per line. Claude only uses deadlines listed here.</div></div>
    <div class="card stack"><h2>Design</h2><p class="small">Every email uses the house template from the Black Walnut Friday email: charcoal background, Montserrat type, logo on top, green rule, white headline, tan accents, and white “Shop now” buttons under products.</p></div>
    <div class="card stack"><h2>Who we sell to</h2>${(k.personas ?? []).map((p) => `<div><b>${esc(p.name)}</b> <span class="small muted">— ${esc(p.wants)} <i>${esc(p.products)}</i></span></div>`).join("")}</div>`;
  q("#save").onclick = async () => {
    const v = (id) => q("#" + id).value.trim();
    const lines = (id) => v(id).split("\n").map((x) => x.trim()).filter(Boolean);
    const themes = k.themes ?? {};
    const next = { ...k, name: v("k-name"), sender_name: v("k-sender"), address: v("k-address"), phone: v("k-phone"), logo_url: v("k-logo"), one_liner: v("k-one"), story: v("k-story"),
      voice: lines("k-voice"), never: lines("k-never"), approved_mentions: v("k-mentions"), notes_for_writer: v("k-notes"),
      deadlines_2026: Object.fromEntries(lines("k-dates").map((d, i) => ["d" + (i + 1), d])), themes };
    const { error } = await H.sb.from("mkt_brand").update({ kit: next, updated_at: new Date().toISOString(), updated_by: H.state.profile.id }).eq("id", 1);
    if (error) return toast(error.message);
    kit = next; toast("Brand kit saved.");
  };
}

// ---------------------------------------------------------------- Plan
function renderPlan() {
  frame("The email plan");
  view().innerHTML = `<article class="plan card">
  <h2>Where things stand</h2>
  <ul><li><b>Sent:</b> Black Walnut Friday launch (Nov 26), 20% off with code BWF2026.</li>
    <li><b>Scheduled:</b> Black Walnut Friday reminder, Sun Nov 29 at 9 AM · Last call for Christmas delivery, Sat Dec 12 at 9 AM.</li>
    <li><b>Signup popup</b> on mtblock.com: “Get first pick of our shop drops.”</li></ul>
  <h2>Automations</h2>
  <ul><li><b>Welcome</b> — one email, 1 minute after someone signs up. Just this one.</li>
    <li><b>Thank you</b> — one email, 1 day after any order.</li>
    <li><b>Care routine</b> — 20 days after any order. Knife stands and rails have a hard finish and need no oil or wax. <i>To be written and approved.</i></li>
    <li><b>Abandoned checkout</b> — one email, 12 hours after an unfinished checkout.</li>
    <li><b>Engraving details</b> — 5 minutes after an engraving order; replies go to Mitchell.</li>
    <li><b>Win-back</b> — one email after 160 days with no purchase. <i>To be written and approved.</i></li>
    <li>No other post-purchase or welcome emails.</li></ul>
  <h2>The rules</h2>
  <ul><li>Nothing goes out without approval from Mitchell or Brittany.</li><li>Discounts only for Black Walnut Friday (once a year) or when Mitchell asks for one.</li>
    <li>Default design: the dark Black Walnut Friday look. Emails come from Montana Block Co. &lt;mitchell@mtblock.com&gt;.</li>
    <li>Real dates and real stock only. No made-up reviews, scarcity or hype.</li></ul>
  <h2>How this tab works</h2>
  <ol><li>Open an email and press <b>Write it</b>. Claude writes and proofreads the copy and picks products from the live store. It uses the Black Walnut Friday template.</li><li>Edit anything, or tell Claude what to change and press <b>Revise</b>.</li><li><b>Email me a proof</b> to see it in a real inbox.</li><li><b>Approve</b> (Mitchell or Brittany). This locks the exact version.</li><li>Campaigns: <b>Send…</b> now or on a schedule, typing SEND to confirm. Automations: approved emails get set up in Omnisend.</li></ol>
  </article>`;
}

// ---------------------------------------------------------------- Settings
async function renderSettings() {
  frame("Email settings");
  const [{ data: sec }, st, { data: usage }] = await Promise.all([
    H.sb.rpc("mkt_secret_status"),
    fn("mkt-send", { action: "status" }).catch((e) => ({ connected: false, error: e.message })),
    H.sb.from("mkt_ai_log").select("action, input_tokens, output_tokens, created_at").order("created_at", { ascending: false }).limit(200),
  ]);
  espStatus = st;
  const k = sec?.omnisend_api_key;
  const month = (usage ?? []).filter((u) => new Date(u.created_at).getMonth() === new Date().getMonth());
  view().innerHTML = `
    <div class="card stack"><h2>Omnisend</h2>
      <p class="small">${st.connected ? (st.ok ? `Connected ✓${k?.last4 ? ` (key ending ${esc(k.last4)})` : ""}. ${st.segments?.length ?? 0} segments.` : `Key saved, but Omnisend said: ${esc(st.error)}`) : "Not connected."}</p>
      <div class="row"><input id="okey" type="password" placeholder="Paste a new Omnisend API key" autocomplete="off"><button class="btn primary" id="savekey">Save</button>${k ? `<button class="btn danger" id="clearkey">Disconnect</button>` : ""}</div>
      <p class="small muted">The key is stored on the server and can't be read back by the app. Make keys in Omnisend → Store settings → API keys.</p>
    </div>
    <div class="card stack"><h2>Claude usage</h2><p class="small">${month.length} writing jobs this month · ${Math.round(month.reduce((a, u) => a + (u.input_tokens || 0) + (u.output_tokens || 0), 0) / 1000)}k tokens (billed to the Hub's Anthropic key).</p></div>`;
  q("#savekey").onclick = async () => {
    const val = q("#okey").value.trim(); if (!val) return;
    const { error } = await H.sb.rpc("mkt_set_secret", { p_key: "omnisend_api_key", p_value: val });
    if (error) return toast(error.message);
    library = null; toast("Saved. Checking the connection…"); renderSettings();
  };
  q("#clearkey")?.addEventListener("click", async () => {
    if (!confirm("Disconnect Omnisend? Sending and results stop until a key is saved again.")) return;
    await H.sb.rpc("mkt_set_secret", { p_key: "omnisend_api_key", p_value: "" }); library = null; renderSettings();
  });
}
