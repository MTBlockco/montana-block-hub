// Montana Block Email Studio — Claude writes the emails, Mitchell approves them, and only then can they go out.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "../config.js";
import { renderEmail } from "./email.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const $app = document.getElementById("app");
const LOGO = "https://mtblock.com/cdn/shop/files/MONTANA_BLOCK_CO-02.png?v=1747022409&width=600";
const TZ = "America/Denver";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d, opts = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) =>
  d ? new Date(d).toLocaleString("en-US", { timeZone: TZ, ...opts }) : "";
const toLocalInput = (d) => {
  if (!d) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
};
// Interpret a datetime-local value as Mountain time.
const fromLocalInput = (v) => {
  if (!v) return null;
  const guess = new Date(v + ":00Z");
  const offset = new Date(guess.toLocaleString("en-US", { timeZone: TZ })).getTime() - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(guess.getTime() - offset).toISOString();
};

let me = null;       // { id, email, role, full_name }
let kit = {};        // brand kit
let catalog = null;  // live Shopify retail products
const isOwner = () => me?.role === "owner";

function toast(msg, bad = false) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast" + (bad ? " bad" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 4200);
}

async function fn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
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
const badge = (s) => `<span class="sbadge ${STATUS[s]?.cls ?? ""}">${esc(STATUS[s]?.label ?? s)}</span>`;
const themeOf = (key) => kit.themes?.[key] ?? Object.values(kit.themes ?? {})[0] ?? { bg: "#1f1813", panel: "#2a2019", text: "#f3e9dc", muted: "#c4b2a0", accent: "#d39b5c", accent2: "#d6a85a", button_text: "#1a120c", dark: true };

// ---------------------------------------------------------------- boot
async function boot() {
  try { navigator.serviceWorker?.register("sw.js"); } catch {}
  const { data } = await sb.auth.getSession();
  sb.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_OUT") renderLogin(); });
  if (!data.session) return renderLogin();
  await start(data.session.user);
}

async function start(user) {
  const { data: prof } = await sb.from("profiles").select("role, full_name, active").eq("id", user.id).single();
  me = { id: user.id, email: user.email, role: prof?.role ?? "pending", full_name: prof?.full_name ?? "" };
  if (!prof?.active || !["admin", "owner"].includes(me.role)) {
    $app.innerHTML = `<div class="auth wood"><div class="card stack"><img class="logo" src="${LOGO}" alt="Montana Block Co.">
      <h2>Email Studio</h2><p>This app is for Mitchell and the office. Your login doesn't have access.</p>
      <a class="btn" href="../">Go to the Shop Hub</a><button class="btn" id="out">Sign out</button></div></div>`;
    document.getElementById("out").onclick = () => sb.auth.signOut();
    return;
  }
  const { data: b } = await sb.from("mkt_brand").select("kit").eq("id", 1).single();
  kit = b?.kit ?? {};
  window.addEventListener("hashchange", route);
  route();
}

function renderLogin(msg = "") {
  $app.innerHTML = `<div class="auth wood"><form class="card stack" id="login">
    <div style="background:var(--walnut-2);border-radius:12px;padding:14px"><img class="logo" src="${LOGO}" alt="Montana Block Co."></div>
    <h2 style="text-align:center;margin:4px 0 0">Email Studio</h2>
    <p class="small muted" style="margin:0;text-align:center">Same login as the Shop Hub.</p>
    <div><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
    <div><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
    <div class="error">${esc(msg)}</div>
    <button class="btn primary" type="submit">Sign in</button></form></div>`;
  document.getElementById("login").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
    if (error) return renderLogin("That email and password don't match.");
    start(data.user);
  };
}

// ---------------------------------------------------------------- shell + routing
const NAV = [
  ["home", "Today", "M3 12l9-8 9 8M5 10v10h14V10"],
  ["calendar", "Calendar", "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"],
  ["flows", "Automations", "M5 5h6v6H5zM13 13h6v6h-6zM8 11v5h5"],
  ["brand", "Brand Kit", "M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z"],
  ["plan", "The Plan", "M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3"],
  ["settings", "Settings", "M12 8a4 4 0 100 8 4 4 0 000-8zM3 12h3M18 12h3M12 3v3M12 18v3"],
];
const icon = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

function shell(active, title, inner, actions = "") {
  $app.innerHTML = `<div class="shell">
    <nav class="sidebar wood"><img class="logo" src="${LOGO}" alt="Montana Block Co."><div class="studio-tag">Email Studio</div>
      ${NAV.map(([k, l, d]) => `<a href="#${k}" class="${active === k ? "active" : ""}">${icon(d)}<span>${l}</span></a>`).join("")}
      <div class="spacer"></div><a href="../" class="small">← Shop Hub</a></nav>
    <main class="main"><div class="topbar"><div class="row"><span class="logo-chip"><img class="logo-sm" src="${LOGO}" alt=""></span><h1>${esc(title)}</h1></div><div class="row">${actions}</div></div>
      <div id="view">${inner}</div></main>
    <nav class="bottom-nav">${NAV.map(([k, l, d]) => `<a href="#${k}" class="${active === k ? "active" : ""}">${icon(d)}<span>${l}</span></a>`).join("")}</nav>
  </div>`;
}

function route() {
  const h = location.hash.replace("#", "") || "home";
  if (h.startsWith("email-")) return renderEditor(h.slice(6));
  ({ home: renderHome, calendar: renderCalendar, flows: renderFlows, brand: renderBrand, plan: renderPlan, settings: renderSettings }[h] ?? renderHome)();
}

async function loadCampaigns(kind) {
  let q = sb.from("mkt_campaigns").select("id, kind, title, goal, persona, planned_at, status, subject, preheader, flow_name, flow_step, brief, theme, hero_url, approved_at, send_at, sent_at, esp_status, updated_at").order("planned_at", { ascending: true, nullsFirst: false }).order("flow_name").order("flow_step");
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) toast(error.message, true);
  return data ?? [];
}

function card(c) {
  const t = themeOf(c.theme?.key);
  return `<a class="ecard" href="#email-${c.id}">
    <div class="swatch" style="background:${t.bg};border-color:${t.accent}">${c.hero_url ? `<img src="${esc(c.hero_url)}" alt="">` : `<span style="color:${t.accent2}">${esc((c.flow_name || "MB").slice(0, 2).toUpperCase())}</span>`}</div>
    <div class="ebody"><div class="row between"><b>${esc(c.title)}</b>${badge(c.status)}</div>
      <div class="small muted">${c.kind === "flow" ? esc(`${c.brief?.trigger ?? ""} · ${c.brief?.delay ?? ""}`) : esc(fmtDate(c.planned_at))}${c.persona && c.persona !== "all" ? " · " + esc(personaName(c.persona)) : ""}</div>
      ${c.subject ? `<div class="small subj">“${esc(c.subject)}”</div>` : `<div class="small muted">${esc(c.goal ?? "")}</div>`}
    </div></a>`;
}
const personaName = (k) => (kit.personas ?? []).find((p) => p.key === k)?.name ?? k;

// ---------------------------------------------------------------- Today
async function renderHome() {
  shell("home", "Today", `<p class="muted">Loading…</p>`, `<button class="btn primary sm" id="new">+ New email</button>`);
  document.getElementById("new").onclick = newEmail;
  const all = await loadCampaigns();
  const now = Date.now();
  const review = all.filter((c) => c.status === "draft");
  const ready = all.filter((c) => c.status === "approved");
  const upcoming = all.filter((c) => c.kind === "campaign" && c.planned_at && new Date(c.planned_at).getTime() > now - 864e5 && c.status === "planned").slice(0, 4);
  const scheduled = all.filter((c) => ["scheduled", "sending"].includes(c.status));
  const status = await fn("mkt-send", { action: "status" }).catch(() => ({ connected: false }));
  document.getElementById("view").innerHTML = `
    <div class="hero-note wood"><div><div class="eyebrow">The rule</div><b>Nothing goes out without your approval.</b>
      <div class="small">Claude writes and designs. You review, approve, then press Send. Any edit after approval cancels the approval.</div></div></div>
    ${!status.connected ? `<div class="card warn-card"><b>Sending isn't connected yet.</b> Drafting, design and approvals all work now. To send, connect Omnisend in <a href="#settings">Settings</a>.</div>` : ""}
    ${!isOwner() ? `<div class="card"><b>You can draft and edit.</b> Only Mitchell can approve and send.</div>` : ""}
    <div class="grid2">
      <section><h2>Needs your review <span class="count">${review.length}</span></h2>${review.map(card).join("") || `<p class="muted small">Nothing waiting. Open a planned email and press Write it.</p>`}</section>
      <section><h2>Approved, ready to send <span class="count">${ready.length}</span></h2>${ready.map(card).join("") || `<p class="muted small">None yet.</p>`}
        ${scheduled.length ? `<h2 style="margin-top:18px">Scheduled / going out</h2>${scheduled.map(card).join("")}` : ""}</section>
    </div>
    <section><h2>Coming up next</h2>${upcoming.map(card).join("") || `<p class="muted small">Calendar's clear.</p>`}</section>`;
}

async function newEmail() {
  const { data, error } = await sb.from("mkt_campaigns").insert({ kind: "campaign", title: "New email", status: "planned", theme: { key: Object.keys(kit.themes ?? {})[0] } }).select("id").single();
  if (error) return toast(error.message, true);
  location.hash = "email-" + data.id;
}

// ---------------------------------------------------------------- Calendar / flows
async function renderCalendar() {
  shell("calendar", "Calendar", `<p class="muted">Loading…</p>`, `<button class="btn primary sm" id="new">+ New email</button>`);
  document.getElementById("new").onclick = newEmail;
  const list = (await loadCampaigns("campaign")).filter((c) => c.status !== "archived");
  const byWeek = {};
  for (const c of list) {
    const d = c.planned_at ? new Date(c.planned_at) : null;
    const key = d ? fmtDate(new Date(d.getTime() - ((d.getDay() + 6) % 7) * 864e5), { month: "long", day: "numeric" }) : "Not scheduled";
    (byWeek[key] ??= []).push(c);
  }
  document.getElementById("view").innerHTML = Object.entries(byWeek).map(([wk, items]) =>
    `<section><h2>${wk === "Not scheduled" ? wk : "Week of " + esc(wk)}</h2>${items.map(card).join("")}</section>`).join("") || `<p class="muted">No emails yet.</p>`;
}

async function renderFlows() {
  shell("flows", "Automations", `<p class="muted">Loading…</p>`);
  const list = await loadCampaigns("flow");
  const groups = {};
  for (const c of list) (groups[c.flow_name || "Other"] ??= []).push(c);
  document.getElementById("view").innerHTML = `<div class="card small">These run on their own once they're live in Omnisend (welcome, abandoned cart, post-purchase, win-back). They're the highest-earning emails a store sends. Write and approve each one here; once approved, the <b>Copy HTML</b> button unlocks so it can be pasted into the Omnisend automation.</div>` +
    Object.entries(groups).map(([g, items]) => `<section><h2>${esc(g)}</h2>${items.map(card).join("")}</section>`).join("");
}

// ---------------------------------------------------------------- Editor
let ed = null; // editor state

async function getCatalog() {
  if (catalog) return catalog;
  const r = await fn("mkt-generate", { action: "products" });
  catalog = Object.fromEntries((r.products ?? []).map((p) => [p.handle, p]));
  return catalog;
}

async function renderEditor(id) {
  shell("calendar", "Email", `<p class="muted">Loading…</p>`);
  const [{ data: c, error }, { data: events }] = await Promise.all([
    sb.from("mkt_campaigns").select("*").eq("id", id).single(),
    sb.from("mkt_events").select("action, detail, at").eq("campaign_id", id).order("at", { ascending: false }).limit(30),
  ]);
  if (error || !c) { document.getElementById("view").innerHTML = `<p>Couldn't find that email.</p>`; return; }
  ed = { c, events: events ?? [], device: "desktop", dirty: false, busy: false, products: {} };
  // Products used in the saved blocks (snapshot kept in brief._products so the email renders the same later).
  ed.products = c.brief?._products ?? {};
  paintEditor();
  getCatalog().then(() => { if (ed?.c.id === id) paintProductsPicker(); }).catch(() => {});
}

const locked = () => ["approved", "scheduled", "sending", "sent"].includes(ed.c.status);
const frozen = () => ["scheduled", "sending", "sent"].includes(ed.c.status);

function paintEditor() {
  const c = ed.c;
  const themes = kit.themes ?? {};
  const personas = kit.personas ?? [];
  const actions = `<a class="btn sm" href="#${c.kind === "flow" ? "flows" : "calendar"}">← Back</a>`;
  shell(c.kind === "flow" ? "flows" : "calendar", c.kind === "flow" ? "Automation email" : "Email", "", actions);
  document.getElementById("view").innerHTML = `
  <div class="statusbar">${badge(c.status)}
    ${c.approved_at ? `<span class="small muted">Approved ${esc(fmtDate(c.approved_at))}</span>` : ""}
    ${c.send_at ? `<span class="small muted">${c.status === "scheduled" ? "Goes out" : "Sent"} ${esc(fmtDate(c.send_at))}</span>` : ""}
    <span class="spacer"></span><span class="small muted" id="savestate"></span></div>
  <div class="editor">
    <div class="col-left">
      <div class="card stack">
        <h2>Brief</h2>
        <div><label>Name</label><input id="f-title" value="${esc(c.title)}" ${frozen() ? "disabled" : ""}></div>
        <div><label>What this email should do</label><textarea id="f-goal" rows="3" ${frozen() ? "disabled" : ""}>${esc(c.goal ?? "")}</textarea></div>
        <div class="row2">
          ${c.kind === "campaign" ? `<div><label>Send date (Mountain)</label><input id="f-date" type="datetime-local" value="${toLocalInput(c.planned_at)}" ${frozen() ? "disabled" : ""}></div>` : `<div><label>Trigger</label><input disabled value="${esc((c.brief?.trigger ?? "") + " · " + (c.brief?.delay ?? ""))}"></div>`}
          <div><label>Who it's for</label><select id="f-persona" ${frozen() ? "disabled" : ""}><option value="all">Everyone</option>${personas.map((p) => `<option value="${p.key}" ${c.persona === p.key ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
        </div>
        <div><label>Theme</label><div class="themes">${Object.entries(themes).map(([k, t]) => `<button class="theme-dot ${c.theme?.key === k ? "on" : ""}" data-theme="${k}" title="${esc(t.name)}" style="background:${t.bg};border-color:${t.accent}" ${frozen() ? "disabled" : ""}><i style="background:${t.accent}"></i><i style="background:${t.accent2}"></i></button>`).join("")}</div>
          <div class="small muted" id="themename">${esc(themeOf(c.theme?.key).name ?? "")}</div></div>
        <div><label>Notes for Claude (optional)</label><textarea id="f-notes" rows="3" placeholder="e.g. Lead with the walnut Colossus. Mention we have 3 left. Keep it under 150 words." ${frozen() ? "disabled" : ""}></textarea></div>
        <div class="row wrap">
          <button class="btn primary" id="b-gen" ${frozen() ? "disabled" : ""}>${c.html ? "Rewrite from scratch" : "✍ Write it"}</button>
          ${c.html ? `<button class="btn" id="b-rev" ${frozen() ? "disabled" : ""}>Revise with my notes</button><button class="btn" id="b-art" ${frozen() ? "disabled" : ""}>New graphic</button>` : ""}
        </div>
        ${c.brief?.rationale ? `<div class="small rationale"><b>Why this angle:</b> ${esc(c.brief.rationale)}</div>` : ""}
        ${c.brief?.needs_from_mitchell ? `<div class="small warn">Needs from you: ${esc(c.brief.needs_from_mitchell)}</div>` : ""}
      </div>

      ${c.html ? `<div class="card stack">
        <h2>Subject & preview</h2>
        ${(c.subject_options ?? []).length ? `<div class="subjects">${c.subject_options.map((s) => `<button class="subj-opt ${s === c.subject ? "on" : ""}" ${frozen() ? "disabled" : ""}>${esc(s)}</button>`).join("")}</div>` : ""}
        <div><label>Subject line <span class="muted" id="subjlen"></span></label><input id="f-subject" value="${esc(c.subject ?? "")}" ${frozen() ? "disabled" : ""}></div>
        <div><label>Preview text</label><input id="f-pre" value="${esc(c.preheader ?? "")}" ${frozen() ? "disabled" : ""}></div>
        <div><label>Audience</label><select id="f-aud" ${frozen() ? "disabled" : ""}></select><div class="small muted" id="audnote"></div></div>
      </div>
      <div class="card stack"><h2>Content</h2><div id="blocks"></div>
        <div class="row wrap"><select id="addtype"><option value="">+ Add a block…</option>${["heading", "text", "product", "products", "button", "steps", "quote", "note", "divider", "signoff"].map((t) => `<option>${t}</option>`).join("")}</select></div>
      </div>` : ""}

      <div class="card stack"><h2>History</h2><div class="small">${ed.events.map((e) => `<div class="hist"><span>${esc(fmtDate(e.at))}</span> ${esc(e.action.replace(/_/g, " "))}${e.detail?.to ? " → " + esc(e.detail.to.join(", ")) : ""}${e.detail?.error ? ` <span class="bad">${esc(e.detail.error)}</span>` : ""}</div>`).join("") || "No activity yet."}</div></div>
    </div>

    <div class="col-right">
      <div class="preview-head"><div class="seg"><button data-dev="desktop" class="${ed.device === "desktop" ? "on" : ""}">Desktop</button><button data-dev="mobile" class="${ed.device === "mobile" ? "on" : ""}">Phone</button></div>
        ${c.hero_url ? `<a class="btn sm" href="${esc(c.hero_url)}" target="_blank">Graphic ↗</a>` : ""}</div>
      ${c.html ? `<div class="inbox"><div class="from">Montana Block Co.</div><div class="isubj">${esc(c.subject ?? "")}</div><div class="ipre">${esc(c.preheader ?? "")}</div></div>` : ""}
      <div class="frame ${ed.device}">${c.html ? `<iframe id="pv" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Email preview"></iframe>` : `<div class="empty">No draft yet.<br>Fill in the brief and press <b>Write it</b>. Claude writes the copy, picks products from the live store, and designs the header graphic in your brand.</div>`}</div>
      <div class="card stack approve-box" id="approvebox"></div>
    </div>
  </div>`;
  if (c.html) document.getElementById("pv").srcdoc = c.html;
  wireEditor();
  paintBlocks();
  paintApproveBox();
  paintAudience();
}

function wireEditor() {
  const c = ed.c;
  const v = (id) => document.getElementById(id);
  const onMeta = (id, field, conv = (x) => x) => v(id)?.addEventListener("change", (e) => { c[field] = conv(e.target.value); save({ [field]: c[field] }); });
  onMeta("f-title", "title");
  onMeta("f-goal", "goal");
  onMeta("f-date", "planned_at", fromLocalInput);
  onMeta("f-persona", "persona");
  document.querySelectorAll(".theme-dot").forEach((b) => b.onclick = async () => {
    c.theme = { ...(c.theme ?? {}), key: b.dataset.theme };
    if (c.html) { await rerender(); toast("Theme changed. Press New graphic to redraw the header in these colors."); } else await save({ theme: c.theme });
    paintEditor();
  });
  document.querySelectorAll(".subj-opt").forEach((b) => b.onclick = () => { c.subject = b.textContent; rerender(); paintEditor(); });
  const subj = v("f-subject");
  if (subj) {
    const len = () => v("subjlen").textContent = `(${subj.value.length} chars${subj.value.length > 50 ? " – long for phones" : ""})`;
    len(); subj.oninput = len;
    subj.onchange = () => { c.subject = subj.value; rerender(); };
    v("f-pre").onchange = (e) => { c.preheader = e.target.value; rerender(); };
  }
  document.querySelectorAll("[data-dev]").forEach((b) => b.onclick = () => { ed.device = b.dataset.dev; document.querySelector(".frame").className = "frame " + ed.device; document.querySelectorAll("[data-dev]").forEach((x) => x.classList.toggle("on", x === b)); });
  v("b-gen")?.addEventListener("click", () => write("generate"));
  v("b-rev")?.addEventListener("click", () => write("revise"));
  v("b-art")?.addEventListener("click", () => write("graphic"));
  v("addtype")?.addEventListener("change", (e) => {
    const t = e.target.value; e.target.value = ""; if (!t) return;
    const blank = { heading: { text: "Heading" }, text: { text: "Write something here." }, product: { handle: Object.keys(catalog ?? {})[0] ?? "", blurb: "" }, products: { handles: Object.keys(catalog ?? {}).slice(0, 2) }, button: { label: "Shop now", url: "https://mtblock.com/collections/all" }, steps: { items: ["Step one", "Step two"] }, quote: { text: "", cite: "" }, note: { text: "" }, divider: {}, signoff: { text: "— Mitchell and the crew at Montana Block" } }[t];
    const i = c.blocks.length - (c.blocks.at(-1)?.type === "signoff" ? 1 : 0);
    c.blocks.splice(i, 0, { type: t, ...blank });
    rerender(); paintBlocks();
  });
}

function guard() {
  if (frozen()) { toast("This one's already with the email service. Duplicate it to change anything.", true); return false; }
  return true;
}

// Re-render HTML from blocks and save. Editing an approved email cancels its approval (the database enforces this too).
async function rerender({ regraphic = false } = {}) {
  if (!guard()) return;
  const c = ed.c;
  if (c.status === "approved") toast("You edited an approved email, so its approval was cancelled. Approve it again when you're happy.");
  if (regraphic && c.hero_svg) {
    const url = await uploadHero(c.id, c.hero_svg, themeOf(c.theme?.key)).catch((e) => { toast("Graphic upload failed: " + e.message, true); return c.hero_url; });
    c.hero_url = url;
  }
  c.html = renderEmail({ subject: c.subject, preheader: c.preheader, blocks: c.blocks, theme: themeOf(c.theme?.key), kit, heroUrl: c.hero_url, heroAlt: c.brief?.hero_alt, products: ed.products });
  const pv = document.getElementById("pv"); if (pv) pv.srcdoc = c.html;
  await save({ subject: c.subject, preheader: c.preheader, blocks: c.blocks, html: c.html, theme: c.theme, hero_url: c.hero_url, brief: { ...c.brief, _products: ed.products }, ...(c.status === "planned" ? { status: "draft" } : {}) });
}

async function save(patch) {
  const s = document.getElementById("savestate"); if (s) s.textContent = "Saving…";
  const { data, error } = await sb.from("mkt_campaigns").update(patch).eq("id", ed.c.id).select("*").single();
  if (error) { toast(error.message, true); if (s) s.textContent = "Not saved"; return; }
  const wasApproved = ed.c.status === "approved" && data.status !== "approved";
  ed.c = { ...ed.c, ...data };
  if (s) s.textContent = "Saved";
  if (wasApproved) paintEditor(); else { paintApproveBox(); const sb2 = document.querySelector(".statusbar .sbadge"); if (sb2) sb2.outerHTML = badge(ed.c.status); }
}

// ------------------------------------------------ Claude writes
async function write(action) {
  if (!guard() || ed.busy) return;
  const c = ed.c;
  if (c.status === "approved" && !confirm2("This email is approved. Rewriting it cancels the approval. Continue?")) return;
  const notes = document.getElementById("f-notes")?.value ?? "";
  ed.busy = true;
  const btns = document.querySelectorAll("#b-gen,#b-rev,#b-art"); btns.forEach((b) => b.disabled = true);
  const label = { generate: "Claude is writing the email and drawing the graphic… (about 30–60 seconds)", revise: "Claude is revising…", graphic: "Claude is drawing a new graphic…" }[action];
  document.querySelector(".frame").insertAdjacentHTML("afterbegin", `<div class="working"><div class="spinner"></div>${label}</div>`);
  try {
    if (c.status === "approved") { await sb.rpc("mkt_unapprove", { p_id: c.id }); c.status = "draft"; }
    const r = await fn("mkt-generate", { action, id: c.id, instructions: notes });
    const d = r.draft;
    for (const p of r.products ?? []) ed.products[p.handle] = p;
    if (action !== "graphic") {
      c.subject_options = d.subject_options; c.subject = d.subject; c.preheader = d.preheader; c.blocks = d.blocks;
      c.theme = { ...(c.theme ?? {}), key: d.theme_key || c.theme?.key };
    }
    c.hero_svg = d.hero_svg;
    c.brief = { ...(c.brief ?? {}), rationale: action === "graphic" ? c.brief?.rationale : d.rationale, hero_alt: d.hero_alt };
    await save({ subject_options: c.subject_options, hero_svg: c.hero_svg, brief: c.brief, theme: c.theme });
    await rerender({ regraphic: true });
    await sb.from("mkt_events").insert({ campaign_id: c.id, action: "generated", detail: { action } });
    toast(action === "graphic" ? "New graphic is in." : "Draft is ready for your review.");
    renderEditor(c.id);
  } catch (e) {
    toast(e.message, true);
    document.querySelector(".working")?.remove();
  } finally {
    ed.busy = false; btns.forEach((b) => b.disabled = false);
  }
}

// ------------------------------------------------ Hero graphic → PNG (emails can't show SVG)
let fontCss = null;
// Embed Oswald + Lora into the SVG so the PNG uses the real brand fonts.
async function embeddedFonts() {
  if (fontCss != null) return fontCss;
  const css = await (await fetch("https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Lora:ital@1&display=swap")).text();
  const faces = css.split("/*").filter((chunk) => chunk.startsWith(" latin */")).map((chunk) => chunk.slice(chunk.indexOf("@font-face")));
  const out = [];
  for (const face of faces) {
    const url = face.match(/url\(([^)]+)\)/)?.[1];
    if (!url) continue;
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.push(face.replace(/url\([^)]+\)/, `url(data:font/woff2;base64,${btoa(bin)})`));
  }
  fontCss = out.join("\n");
  return fontCss;
}

async function svgToPng(svg) {
  let s = svg;
  try {
    const fonts = await embeddedFonts();
    s = s.replace(/<svg([^>]*)>/, `<svg$1><style>${fonts}</style>`);
  } catch {}
  const blob = new Blob([s], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("The graphic couldn't be drawn. Try New graphic.")); img.src = url; });
  await new Promise((r) => setTimeout(r, 150));
  const cv = document.createElement("canvas"); cv.width = 1200; cv.height = 600;
  const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0, 1200, 600);
  URL.revokeObjectURL(url);
  return await new Promise((ok) => cv.toBlob(ok, "image/png"));
}

async function uploadHero(id, svg) { // theme colors are already in the SVG
  const png = await svgToPng(svg);
  const path = `${id}/hero-${Date.now()}.png`;
  const { error } = await sb.storage.from("mkt-assets").upload(path, png, { contentType: "image/png", upsert: false, cacheControl: "31536000" });
  if (error) throw error;
  return sb.storage.from("mkt-assets").getPublicUrl(path).data.publicUrl;
}

// ------------------------------------------------ Block editor
function paintBlocks() {
  const el = document.getElementById("blocks"); if (!el) return;
  const c = ed.c, dis = frozen() ? "disabled" : "";
  const prodOpts = (sel) => Object.values(catalog ?? ed.products).map((p) => `<option value="${esc(p.handle)}" ${p.handle === sel ? "selected" : ""}>${esc(p.title)} — $${p.price}${p.stock != null ? ` (${p.stock} in stock)` : ""}</option>`).join("");
  el.innerHTML = c.blocks.map((b, i) => {
    let f = "";
    if (b.type === "hero") f = `<input data-k="eyebrow" value="${esc(b.eyebrow ?? "")}" placeholder="Small line above" ${dis}><input data-k="headline" value="${esc(b.headline ?? "")}" placeholder="Headline (in the graphic)" ${dis}><input data-k="sub" value="${esc(b.sub ?? "")}" placeholder="Line under the graphic" ${dis}><div class="small muted">Headline words live in the graphic. Changing them here? Press “New graphic” to redraw.</div>`;
    else if (["heading", "note", "signoff"].includes(b.type)) f = `<input data-k="text" value="${esc(b.text ?? "")}" ${dis}>`;
    else if (b.type === "text") f = `<textarea data-k="text" rows="${Math.min(10, 2 + Math.ceil((b.text ?? "").length / 70))}" ${dis}>${esc(b.text ?? "")}</textarea>`;
    else if (b.type === "quote") f = `<textarea data-k="text" rows="2" ${dis}>${esc(b.text ?? "")}</textarea><input data-k="cite" value="${esc(b.cite ?? "")}" placeholder="Who said it (real quotes only)" ${dis}>`;
    else if (b.type === "button") f = `<input data-k="label" value="${esc(b.label ?? "")}" ${dis}><input data-k="url" value="${esc(b.url ?? "")}" ${dis}>`;
    else if (b.type === "steps") f = `<textarea data-k="items" rows="${(b.items ?? []).length + 1}" ${dis}>${esc((b.items ?? []).join("\n"))}</textarea><div class="small muted">One step per line.</div>`;
    else if (b.type === "product") f = `<select data-k="handle" ${dis}>${prodOpts(b.handle)}</select><textarea data-k="blurb" rows="2" ${dis}>${esc(b.blurb ?? "")}</textarea>`;
    else if (b.type === "products") f = `<select data-k="handles" multiple size="5" ${dis}>${Object.values(catalog ?? ed.products).map((p) => `<option value="${esc(p.handle)}" ${(b.handles ?? []).includes(p.handle) ? "selected" : ""}>${esc(p.title)} — $${p.price}</option>`).join("")}</select><div class="small muted">Pick 2–4 (Ctrl/Cmd-click).</div>`;
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
    row.querySelectorAll("[data-act]").forEach((btn) => btn.onclick = () => {
      const a = btn.dataset.act;
      if (a === "del") c.blocks.splice(i, 1);
      if (a === "up" && i > 0) [c.blocks[i - 1], c.blocks[i]] = [c.blocks[i], c.blocks[i - 1]];
      if (a === "down" && i < c.blocks.length - 1) [c.blocks[i + 1], c.blocks[i]] = [c.blocks[i], c.blocks[i + 1]];
      rerender(); paintBlocks();
    });
  });
}
function paintProductsPicker() { paintBlocks(); }

// ------------------------------------------------ Audience
let espStatus = null;
async function paintAudience() {
  const sel = document.getElementById("f-aud"); if (!sel) return;
  const c = ed.c;
  espStatus ??= await fn("mkt-send", { action: "status" }).catch(() => ({ connected: false }));
  const segs = espStatus.segments ?? [];
  const cur = c.audience?.type === "segments" ? c.audience.include?.[0] : "all";
  sel.innerHTML = `<option value="all">All subscribers</option>${segs.map((s) => `<option value="${esc(s.id)}" ${cur === s.id ? "selected" : ""}>${esc(s.name)}${s.size != null ? ` (${s.size})` : ""}</option>`).join("")}`;
  document.getElementById("audnote").textContent = espStatus.connected ? (segs.length ? "Segments come from Omnisend." : "Make segments in Omnisend (e.g. Engaged 90 days, Past buyers) and they'll show here.") : "Connect Omnisend in Settings to target segments.";
  sel.onchange = () => {
    const s = segs.find((x) => x.id === sel.value);
    c.audience = s ? { type: "segments", include: [s.id], label: s.name } : { type: "all", label: "All subscribers" };
    save({ audience: c.audience });
  };
}

// ------------------------------------------------ Approve / proof / send
function paintApproveBox() {
  const box = document.getElementById("approvebox"); if (!box) return;
  const c = ed.c;
  const proof = `<button class="btn" id="b-proof" ${!c.html ? "disabled" : ""}>Email me a proof</button>`;
  const copy = c.status === "approved" || c.status === "sent" ? `<button class="btn" id="b-copy">Copy HTML</button>` : "";
  if (!c.html) { box.innerHTML = `<h2>Review</h2><p class="small muted">Write the email first.</p>`; return; }
  if (c.status === "draft" || c.status === "planned") {
    box.innerHTML = `<h2>Review</h2>
      <p class="small">Read it top to bottom in the preview. Check the subject, the products, prices and dates.</p>
      <div class="row wrap">${isOwner() ? `<button class="btn primary" id="b-approve">Approve this email</button>` : `<span class="small muted">Only Mitchell can approve.</span>`} ${proof}
      <button class="btn danger sm" id="b-reject">Reject</button><button class="btn sm" id="b-dup">Duplicate</button></div>`;
  } else if (c.status === "approved") {
    box.innerHTML = `<h2>Approved ✓</h2>
      <p class="small">Approved by you ${esc(fmtDate(c.approved_at))}. It's locked to this exact version — any edit cancels the approval.</p>
      <div class="small muted">Audience: <b>${esc(c.audience?.label ?? "All subscribers")}</b>${c.planned_at ? ` · Planned: <b>${esc(fmtDate(c.planned_at))}</b>` : ""}</div>
      <div class="row wrap">${isOwner() && c.kind === "campaign" ? `<button class="btn primary" id="b-send">Send…</button>` : ""}${proof}${copy}<button class="btn sm" id="b-unapprove">Un-approve</button><button class="btn sm" id="b-dup">Duplicate</button></div>
      ${c.kind === "flow" ? `<p class="small muted">Automation emails go live in Omnisend's automation editor: Copy HTML, paste into the matching step.</p>` : ""}`;
  } else {
    box.innerHTML = `<h2>${esc(STATUS[c.status]?.label)}</h2>
      <p class="small">${c.status === "scheduled" ? `Scheduled for ${esc(fmtDate(c.send_at))}.` : c.status === "sent" ? `Sent ${esc(fmtDate(c.sent_at ?? c.send_at))}.` : "Omnisend is sending it now."} Omnisend status: <b>${esc(c.esp_status ?? "—")}</b></p>
      <div class="row wrap"><button class="btn" id="b-refresh">Check status</button>${c.status === "scheduled" && isOwner() ? `<button class="btn danger" id="b-cancel">Cancel send</button>` : ""}${copy}<button class="btn sm" id="b-dup">Duplicate</button></div>`;
  }
  const on = (id, f) => document.getElementById(id)?.addEventListener("click", f);
  on("b-approve", approveFlow);
  on("b-unapprove", async () => { await sb.rpc("mkt_unapprove", { p_id: c.id }); renderEditor(c.id); });
  on("b-reject", async () => { await save({ status: "rejected" }); await sb.from("mkt_events").insert({ campaign_id: c.id, action: "rejected" }); renderEditor(c.id); });
  on("b-dup", duplicate);
  on("b-proof", proofFlow);
  on("b-send", sendFlow);
  on("b-copy", async () => { try { await navigator.clipboard.writeText(c.html); toast("HTML copied."); } catch { toast("Couldn't copy here.", true); } });
  on("b-refresh", async () => { try { const r = await fn("mkt-send", { action: "refresh", id: c.id }); toast("Omnisend: " + r.esp_status); renderEditor(c.id); } catch (e) { toast(e.message, true); } });
  on("b-cancel", async () => { if (!confirm2("Cancel this scheduled send?")) return; try { await fn("mkt-send", { action: "cancel", id: c.id }); toast("Cancelled. It's back to approved."); renderEditor(c.id); } catch (e) { toast(e.message, true); } });
}

function confirm2(msg) { return window.confirm(msg); }

function modal(html) {
  const m = document.createElement("div"); m.className = "modal";
  m.innerHTML = `<div class="modal-card card stack">${html}</div>`;
  document.body.appendChild(m);
  m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
  return m;
}

async function approveFlow() {
  const { data: fresh } = await sb.from("mkt_campaigns").select("*").eq("id", ed.c.id).single();
  ed.c = fresh;
  const c = fresh;
  const m = modal(`<h2>Approve this email?</h2>
    <div class="kv"><span>Subject</span><b>${esc(c.subject)}</b></div>
    <div class="kv"><span>Preview text</span><b>${esc(c.preheader ?? "")}</b></div>
    <div class="kv"><span>Audience</span><b>${esc(c.audience?.label ?? "All subscribers")}</b></div>
    ${c.kind === "campaign" ? `<div class="kv"><span>Planned send</span><b>${esc(fmtDate(c.planned_at) || "Not set")}</b></div>` : ""}
    <label class="check"><input type="checkbox" id="ok1"> I read the whole email, and the prices, products and dates are right.</label>
    <p class="small muted">Approving locks this exact version. It still won't go out until you press Send.</p>
    <div class="row"><button class="btn primary" id="yes" disabled>Approve</button><button class="btn" id="no">Not yet</button></div>`);
  m.querySelector("#ok1").onchange = (e) => m.querySelector("#yes").disabled = !e.target.checked;
  m.querySelector("#no").onclick = () => m.remove();
  m.querySelector("#yes").onclick = async () => {
    const { error } = await sb.rpc("mkt_approve", { p_id: c.id, p_hash: c.content_hash });
    m.remove();
    if (error) return toast(error.message, true);
    toast("Approved. Nothing has been sent.");
    renderEditor(c.id);
  };
}

async function proofFlow() {
  const m = modal(`<h2>Email a proof</h2><p class="small">Sends a test copy only to Montana Block inboxes, never to customers. Uses Omnisend so you see exactly what customers would.</p>
    <div><label>Send to (up to 5, @mtblock.com only)</label><input id="to" value="${esc(me.email)}"></div>
    <div class="row"><button class="btn primary" id="go">Send proof</button><button class="btn" id="no">Cancel</button></div>`);
  m.querySelector("#no").onclick = () => m.remove();
  m.querySelector("#go").onclick = async () => {
    const to = m.querySelector("#to").value.split(/[,\s]+/).filter(Boolean);
    m.querySelector("#go").disabled = true;
    try { await fn("mkt-send", { action: "test", id: ed.c.id, to }); toast("Proof sent to " + to.join(", ")); m.remove(); }
    catch (e) { toast(e.message, true); m.querySelector("#go").disabled = false; }
  };
}

async function sendFlow() {
  const c = ed.c;
  const st = espStatus ?? await fn("mkt-send", { action: "status" }).catch(() => ({ connected: false }));
  if (!st.connected) return toast("Connect Omnisend in Settings first.", true);
  const planned = c.planned_at && new Date(c.planned_at).getTime() > Date.now() + 6 * 60 * 1000 ? toLocalInput(c.planned_at) : "";
  const m = modal(`<h2>Send to customers</h2>
    <div class="kv"><span>Subject</span><b>${esc(c.subject)}</b></div>
    <div class="kv"><span>Audience</span><b>${esc(c.audience?.label ?? "All subscribers")}</b></div>
    <div class="row2"><label class="check"><input type="radio" name="when" value="later" ${planned ? "checked" : ""}> Schedule</label><label class="check"><input type="radio" name="when" value="now" ${planned ? "" : "checked"}> Send now</label></div>
    <div><label>Send time (Mountain)</label><input type="datetime-local" id="at" value="${planned}"></div>
    <div><label>Type <b>SEND</b> to confirm</label><input id="confirm" autocomplete="off" placeholder="SEND"></div>
    <div class="row"><button class="btn primary" id="go" disabled>Send</button><button class="btn" id="no">Cancel</button></div>`);
  const go = m.querySelector("#go");
  m.querySelector("#confirm").oninput = (e) => go.disabled = e.target.value.trim() !== "SEND";
  m.querySelector("#no").onclick = () => m.remove();
  go.onclick = async () => {
    const later = m.querySelector('input[name="when"]:checked').value === "later";
    const send_at = later ? fromLocalInput(m.querySelector("#at").value) : null;
    if (later && !send_at) return toast("Pick a send time.", true);
    go.disabled = true; go.textContent = "Handing to Omnisend…";
    try {
      const r = await fn("mkt-send", { action: "send", id: c.id, confirm: "SEND", send_at });
      m.remove(); toast(r.scheduled ? "Scheduled." : "Sending now."); renderEditor(c.id);
    } catch (e) { toast(e.message, true); go.disabled = false; go.textContent = "Send"; }
  };
}

async function duplicate() {
  const c = ed.c;
  const { data, error } = await sb.from("mkt_campaigns").insert({
    kind: c.kind, flow_name: c.flow_name, flow_step: c.flow_step, title: c.title + " (copy)", goal: c.goal, persona: c.persona,
    planned_at: c.planned_at, status: c.html ? "draft" : "planned", subject: c.subject, subject_options: c.subject_options, preheader: c.preheader,
    theme: c.theme, blocks: c.blocks, html: c.html, hero_svg: c.hero_svg, hero_url: c.hero_url, audience: c.audience, brief: c.brief,
  }).select("id").single();
  if (error) return toast(error.message, true);
  location.hash = "email-" + data.id;
}

// ---------------------------------------------------------------- Brand kit
async function renderBrand() {
  shell("brand", "Brand Kit", "", `<button class="btn primary sm" id="save">Save</button>`);
  const k = kit;
  const list = (arr) => (arr ?? []).join("\n");
  document.getElementById("view").innerHTML = `
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
    <div class="card stack"><h2>Themes</h2><div class="theme-grid">${Object.entries(k.themes ?? {}).map(([key, t]) => `
      <div class="theme-card" style="background:${t.bg};color:${t.text};border-color:${t.accent}"><div style="font-family:Oswald;letter-spacing:.1em;text-transform:uppercase">${esc(t.name)}</div>
      <div style="font-family:Lora;font-style:italic;color:${t.accent2}">Handmade in Billings</div>
      <div class="row">${["bg", "panel", "text", "accent", "accent2"].map((f) => `<label class="sw"><input type="color" data-theme="${key}" data-f="${f}" value="${t[f]}"><small>${f}</small></label>`).join("")}</div></div>`).join("")}</div></div>
    <div class="card stack"><h2>Who we sell to</h2>${(k.personas ?? []).map((p) => `<div><b>${esc(p.name)}</b> <span class="small muted">— ${esc(p.wants)} <i>${esc(p.products)}</i></span></div>`).join("")}</div>`;
  document.getElementById("save").onclick = async () => {
    const v = (id) => document.getElementById(id).value.trim();
    const lines = (id) => v(id).split("\n").map((x) => x.trim()).filter(Boolean);
    const themes = structuredClone(k.themes ?? {});
    document.querySelectorAll("input[type=color]").forEach((i) => themes[i.dataset.theme][i.dataset.f] = i.value);
    const next = { ...k, name: v("k-name"), sender_name: v("k-sender"), address: v("k-address"), phone: v("k-phone"), logo_url: v("k-logo"), one_liner: v("k-one"), story: v("k-story"),
      voice: lines("k-voice"), never: lines("k-never"), approved_mentions: v("k-mentions"), notes_for_writer: v("k-notes"),
      deadlines_2026: Object.fromEntries(lines("k-dates").map((d, i) => ["d" + (i + 1), d])), themes };
    const { error } = await sb.from("mkt_brand").update({ kit: next, updated_at: new Date().toISOString(), updated_by: me.id }).eq("id", 1);
    if (error) return toast(error.message, true);
    kit = next; toast("Brand kit saved.");
  };
}

// ---------------------------------------------------------------- Plan
function renderPlan() {
  shell("plan", "The Plan", `<article class="plan card">
  <h2>What we're building</h2>
  <p>An email program that sells boards at full price by making people trust the shop: real wood, real people, real deadlines. No coupon habit. This is the same playbook Montana Knife Company used to grow from a garage to eight figures: own the list, tell the maker's story, release in small batches, and treat best customers like VIPs. Their 2025 Black Friday did $1.7M without discounting a knife, using five drops aimed at five kinds of customer.</p>
  <h2>The five pillars</h2>
  <ol><li><b>Built in Billings</b> — the shop, the crew, the process.</li><li><b>Wood school</b> — end grain vs edge grain, species, why it's easy on knives.</li><li><b>Gifts that last</b> — one board for each person on the list, engraving, bundles, gift cards.</li><li><b>Shop drops</b> — small runs and one-offs, announced ahead, VIPs first.</li><li><b>Built for generations</b> — care, our house-made wax, how a board ages.</li></ol>
  <h2>The automations (set up once, earn every day)</h2>
  <p>Automated emails earn far more per send than one-off blasts; abandoned cart is the single best earner, then welcome. Build these first: <b>Welcome (3)</b>, <b>Abandoned cart (3)</b>, <b>Post-purchase (3)</b>, <b>Win-back (1)</b>. All are drafted in the Automations tab.</p>
  <h2>The rhythm</h2>
  <ul><li>Holiday season (now–Dec 15): 2 emails a week, built around real deadlines.</li><li>January–October: 1–2 a week. One story or teaching email, one product or drop email.</li><li>A small-batch “shop drop” once a month, announced to engaged subscribers 48 hours early.</li><li>Keep sending only to people who opened or clicked in the last 90 days (MKC's rule) to protect deliverability; win-back the rest.</li></ul>
  <h2>Growing the list</h2>
  <ul><li>Site sign-up form: “Get first pick of shop drops” instead of “10% off.”</li><li>Checkout opt-in box on, and a sign-up card in every box that ships.</li><li>Past customers who never opted in: one permission email asking if they want to hear from us. Don't add them to marketing without a yes.</li></ul>
  <h2>How this app works</h2>
  <ol><li>Open a planned email (Calendar or Automations) and press <b>Write it</b>. Claude writes the copy, picks products from the live store, and draws a header graphic in a brand theme.</li><li>Edit anything, or tell Claude what to change and press <b>Revise</b>.</li><li><b>Email me a proof</b> to see it in a real inbox.</li><li><b>Approve</b> (only Mitchell). This locks the exact version. Any edit cancels the approval.</li><li><b>Send…</b> now or on a schedule, typing SEND to confirm. The server re-checks the approval before anything goes out.</li></ol>
  <h2>Decisions for Mitchell</h2>
  <ul><li>Newsie (Dalton Davis) vs doing it here. This app covers what an agency writes and designs; Newsie's strength is hands-on strategy and Klaviyo setup.</li><li>OK to mention that we build for Montana Knife Company? It's strong proof, but only with their written permission. Add it to Brand Kit → Approved mentions when you have it.</li><li>What's in the Black Friday drop, and how many of each.</li><li>Engraving order cutoff for Christmas.</li></ul>
  </article>`);
}

// ---------------------------------------------------------------- Settings
async function renderSettings() {
  shell("settings", "Settings", `<p class="muted">Loading…</p>`);
  const [{ data: sec }, st, { data: usage }] = await Promise.all([
    sb.rpc("mkt_secret_status"),
    fn("mkt-send", { action: "status" }).catch((e) => ({ connected: false, error: e.message })),
    sb.from("mkt_ai_log").select("action, input_tokens, output_tokens, created_at").order("created_at", { ascending: false }).limit(200),
  ]);
  espStatus = st;
  const k = sec?.omnisend_api_key;
  const month = (usage ?? []).filter((u) => new Date(u.created_at).getMonth() === new Date().getMonth());
  document.getElementById("view").innerHTML = `
    <div class="card stack"><h2>Email service: Omnisend</h2>
      <p class="small">${st.connected ? (st.ok ? `Connected ✓ (key ending ${esc(k?.last4 ?? "")}). ${st.segments?.length ?? 0} segments found.` : `Key saved, but Omnisend said: ${esc(st.error)}`) : "Not connected yet."}</p>
      ${isOwner() ? `<ol class="small"><li>Sign up at omnisend.com and connect the Shopify store (it syncs customers, consent and products).</li><li>In Omnisend: Store settings → API keys → Create API key. Give it access to Campaigns, Email templates and Segments.</li><li>In Omnisend: verify a sender address (e.g. hello@mtblock.com).</li><li>Paste the key here.</li></ol>
      <div class="row"><input id="okey" type="password" placeholder="Paste Omnisend API key" autocomplete="off"><button class="btn primary" id="savekey">Save</button>${k ? `<button class="btn danger" id="clearkey">Disconnect</button>` : ""}</div>
      <p class="small muted">The key is stored on the server and can't be read back by the app or anyone using it.</p>` : `<p class="small muted">Only Mitchell can connect services.</p>`}
    </div>
    <div class="card stack"><h2>Claude usage</h2><p class="small">${month.length} writing jobs this month · ${Math.round(month.reduce((a, u) => a + u.input_tokens + u.output_tokens, 0) / 1000)}k tokens (Claude Sonnet, billed to the hub's Anthropic key).</p></div>
    <div class="card stack"><h2>Install on your phone</h2><p class="small">Open this page in Safari (iPhone) or Chrome (Android), tap Share → Add to Home Screen. It installs as its own app, separate from the Shop Hub.</p></div>
    <div class="card"><button class="btn" id="out">Sign out</button></div>`;
  document.getElementById("out").onclick = () => sb.auth.signOut();
  document.getElementById("savekey")?.addEventListener("click", async () => {
    const val = document.getElementById("okey").value.trim(); if (!val) return;
    const { error } = await sb.rpc("mkt_set_secret", { p_key: "omnisend_api_key", p_value: val });
    if (error) return toast(error.message, true);
    toast("Saved. Checking the connection…"); renderSettings();
  });
  document.getElementById("clearkey")?.addEventListener("click", async () => {
    if (!confirm2("Disconnect Omnisend?")) return;
    await sb.rpc("mkt_set_secret", { p_key: "omnisend_api_key", p_value: "" }); renderSettings();
  });
}

boot();
