import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { sayingFor } from "./sayings.js";

const LOGO = "https://mtblock.com/cdn/shop/files/MONTANA_BLOCK_CO-02.png?v=1747022409&width=600";
const logoImg = (cls) => `<img class="${cls}" src="${LOGO}" alt="Montana Block Co." onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${cls}',textContent:'MONTANA BLOCK CO.',style:'font-family:Oswald,sans-serif;font-size:1.4rem;letter-spacing:.08em;text-align:center'}))">`;
const MTNS = `<svg class="mtns" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden="true"><path d="M0 26 L0 18 L40 8 L70 16 L110 2 L150 14 L185 6 L220 15 L260 4 L300 13 L335 7 L370 15 L400 9 L400 26 Z" fill="var(--bg)"/></svg>`;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// ---------------------------------------------------------------- helpers
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ROLES = ["pending", "shop", "lead", "admin", "owner"];
const ROLE_LABEL = { pending: "Pending", shop: "Shop", lead: "Lead", admin: "Admin", owner: "Owner" };
const can = (min) => state.profile && ROLES.indexOf(state.profile.role) >= ROLES.indexOf(min);
const canInv = () => state.profile && (state.profile.role === "owner" || state.profile.can_edit_inventory);
const hm = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
async function fnCall(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) { let msg = "Something went wrong"; try { msg = (await error.context.json()).error; } catch {} return { error: msg }; }
  return data;
}
const CHANNELS = ["Web", "Retail", "Commercial", "Government", "Custom"];
const INV_CATS = ["Finished goods", "Board care", "Merch"];
const SUPPLY_CATS = ["Abrasives", "Finish & oil", "Glue & epoxy", "Magnets", "Fasteners & hardware", "Blades & bits", "Packaging & shipping", "Engraving & branding", "PPE & safety", "Cleaning & shop", "Lumber", "Other"];
const ORDER_METHODS = ["Website", "Phone", "Email", "Sales rep", "In person"];
const fmtDate = (d) => (d ? new Date(d + (String(d).length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
const daysUntil = (d) => Math.round((new Date(d + "T12:00:00") - new Date(today() + "T12:00:00")) / 864e5);
const isLow = (i) => i.reorder_point != null && Number(i.quantity) <= Number(i.reorder_point);

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

function sheet(html, onMount) {
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  onMount?.(bg.querySelector(".sheet"), close);
  return close;
}

function formData(root) {
  const out = {};
  root.querySelectorAll("[name]").forEach((el) => {
    out[el.name] = el.type === "checkbox" ? el.checked : el.value.trim();
  });
  return out;
}

// Very small, safe Markdown renderer for SOPs (headings, lists, bold, italics, links)
function md(src) {
  const lines = esc(src).split(/\r?\n/);
  let html = "", list = null;
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // list: null | "ul" | "ol" | "ol+ul" (bullets nested under the current numbered step)
  const closeList = () => {
    if (list === "ol+ul") html += "</ul></li></ol>";
    else if (list === "ol") html += "</li></ol>";
    else if (list === "ul") html += "</ul>";
    list = null;
  };
  for (const line of lines) {
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { closeList(); const n = m[1].length + 1; html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list === "ol") { html += "<ul>"; list = "ol+ul"; }
      else if (list !== "ul" && list !== "ol+ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    }
    else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/))) {
      if (list === "ol+ul") { html += "</ul></li>"; list = "ol"; }
      else if (list === "ol") html += "</li>";
      else { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li value="${m[1]}">${inline(m[2])}`;
    }
    else if (!line.trim()) closeList();
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

async function log(action, entity, entity_id, detail) {
  try { await sb.from("activity_log").insert({ action, entity, entity_id: entity_id ? String(entity_id) : null, detail: detail ?? null }); } catch {}
}

// ---------------------------------------------------------------- icons
const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>',
  jobs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  inv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/></svg>',
  sop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5M8 13h8M8 17h8"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};

// ---------------------------------------------------------------- state & routing
const state = { session: null, profile: null, view: "home", cache: {}, chat: [] };

const VIEWS = {
  home: { label: "Home", icon: I.home, render: renderHome },
  jobs: { label: "Jobs", icon: I.jobs, render: renderJobs },
  inventory: { label: "Products", icon: I.inv, render: renderInventory },
  supplies: { label: "Supplies", icon: I.box, render: renderSupplies },
  sops: { label: "SOPs", icon: I.sop, render: renderSops },
  ask: { label: "Ask", icon: I.ask, render: renderAsk },
  more: { label: "More", icon: I.more, render: renderMore },
};

function go(view) {
  state.view = view;
  history.replaceState(null, "", "#" + view);
  renderShell();
}

async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  addEventListener("hashchange", () => { const h = location.hash.slice(1); if (state.profile && VIEWS[h] && h !== state.view) { state.view = h; renderShell(); } });
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  sb.auth.onAuthStateChange((_e, session) => {
    const changed = !!session !== !!state.session;
    state.session = session;
    if (changed) setTimeout(start, 0); // never call Supabase inside this callback directly
  });
  start();
}

async function start() {
  if (!state.session) return renderLogin();
  const { data: profile } = await sb.from("profiles").select("*").eq("id", state.session.user.id).single();
  state.profile = profile;
  if (!profile || !profile.active || profile.role === "pending") return renderPending();
  if (profile.must_change_password) return renderChangePassword(true);
  const hash = location.hash.slice(1);
  state.view = VIEWS[hash] ? hash : "home";
  renderShell();
}

// ---------------------------------------------------------------- auth screens
function renderLogin(msg = "") {
  $app.innerHTML = `
  <div class="auth wood"><form class="card stack" id="login">
    <div style="background:var(--walnut-2);border-radius:12px;padding:14px">${logoImg("logo")}</div>
    <h2 style="text-align:center;margin:4px 0 0">Shop Hub</h2>
    <div><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div>
    <div><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
    <div class="error" id="err">${esc(msg)}</div>
    <button class="btn primary" type="submit">Sign in</button>
    <p class="small muted" style="margin:0">Forgot your password? Ask Mitchell or an admin to reset it.</p>
  </form></div>`;
  document.getElementById("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
    btn.disabled = false;
    if (error) document.getElementById("err").textContent = "That email and password don't match.";
    else log("login");
  });
}

function renderPending() {
  $app.innerHTML = `
  <div class="auth wood"><div class="card stack">
    <div style="background:var(--walnut-2);border-radius:12px;padding:14px">${logoImg("logo")}</div>
    <p>Your account is set up, but it doesn't have access yet. Ask Mitchell to assign your role.</p>
    <button class="btn" id="out">Sign out</button>
  </div></div>`;
  document.getElementById("out").onclick = () => sb.auth.signOut();
}

function renderChangePassword(forced) {
  const html = `
    <form class="stack" id="pw">
      <h2>${forced ? "Choose your own password" : "Change password"}</h2>
      ${forced ? '<p class="muted small" style="margin:0">You signed in with a temporary password. Pick a new one only you know (at least 10 characters).</p>' : ""}
      <div><label>New password</label><input name="p1" type="password" autocomplete="new-password" minlength="10" required></div>
      <div><label>Type it again</label><input name="p2" type="password" autocomplete="new-password" minlength="10" required></div>
      <div class="error" id="pwerr"></div>
      <div class="row"><button class="btn primary" type="submit">Save password</button>${forced ? "" : '<button class="btn" type="button" data-close>Cancel</button>'}</div>
    </form>`;
  const wire = (root, close) => {
    root.querySelector("#pw").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const err = root.querySelector("#pwerr");
      if (f.p1.length < 10) return (err.textContent = "Use at least 10 characters.");
      if (f.p1 !== f.p2) return (err.textContent = "Those don't match.");
      const { error } = await sb.auth.updateUser({ password: f.p1 });
      if (error) return (err.textContent = error.message);
      await sb.rpc("password_changed");
      log("password_changed");
      toast("Password saved");
      if (forced) start(); else close();
    });
  };
  if (forced) {
    $app.innerHTML = `<div class="auth wood"><div class="card">${html}</div></div>`;
    wire($app, () => {});
  } else sheet(html, wire);
}

// ---------------------------------------------------------------- shell
function renderShell() {
  const nav = (cls) => Object.entries(VIEWS)
    .map(([k, v]) => `<button data-go="${k}" class="${state.view === k ? "active" : ""}" aria-label="${v.label}">${v.icon}<span>${v.label}</span></button>`)
    .join("");
  $app.innerHTML = `
  <div class="shell">
    <nav class="sidebar wood">${logoImg("logo")}${nav("sidebar")}<div class="spacer"></div>
      <div class="small who">${esc(state.profile.full_name || state.profile.email)}<br>${ROLE_LABEL[state.profile.role]}</div></nav>
    <main class="main" id="view"><div class="empty">Loading…</div></main>
    <nav class="tabbar">${Object.entries(VIEWS).filter(([k]) => k !== "more").map(([k, v]) =>
      `<button data-go="${k}" class="${state.view === k ? "active" : ""}">${v.icon}<span>${v.label}</span></button>`).join("")}</nav>
  </div>`;
  $app.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  const view = document.getElementById("view");
  VIEWS[state.view].render(view).catch((err) => {
    console.error(err);
    view.innerHTML = `<div class="empty">Something went wrong loading this page.<br><span class="small">${esc(err.message)}</span></div>`;
  });
}

function topbar(title, actions = "") {
  return `<div class="topbar"><div class="row"><span class="logo-chip">${logoImg("logo-sm")}</span><h1>${esc(title)}</h1></div>
    <div class="row">${actions}<button class="btn icon sm" data-go-more aria-label="Account and team" title="Account">${I.more.replace("<svg", '<svg width="20" height="20"')}</button></div></div>`;
}
function wireTopbar(root) {
  root.querySelector("[data-go-more]")?.addEventListener("click", () => go("more"));
}

// ---------------------------------------------------------------- data loaders
async function loadProfiles() {
  const { data } = await sb.from("profiles").select("id, full_name, email, title, role, active, daily_ai_limit, can_edit_inventory, extra_clock").order("full_name");
  state.cache.profiles = data ?? [];
  return state.cache.profiles;
}
const nameOf = (id) => state.cache.profiles?.find((p) => p.id === id)?.full_name || "";

// ---------------------------------------------------------------- Home
async function renderHome(root) {
  const [ann, jobs] = await Promise.all([
    sb.from("announcements").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(20),
    sb.from("jobs").select("*").neq("status", "Complete").order("due_date", { ascending: true, nullsFirst: false }),
  ]);
  await loadProfiles();
  const first = (state.profile.full_name || "").split(" ")[0];
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/Denver", hour: "numeric", hour12: false }));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const myJobs = (jobs.data ?? []).filter((j) => j.assigned_to === state.profile.id);
  const dueSoon = (jobs.data ?? []).filter((j) => j.due_date && daysUntil(j.due_date) <= 7);

  root.innerHTML = `
    <section class="hero wood">
      ${can("admin") ? '<div class="hero-actions"><button class="btn sm acct" id="addAnn" style="position:static">+ Note</button></div>' : ""}
      <button class="btn icon sm acct" data-go-more aria-label="Account">${I.more.replace("<svg", '<svg width="20" height="20"')}</button>
      ${logoImg("logo")}
      <div class="greet">${greet}${first ? ", " + esc(first) : ""}</div>
      <div class="rule"></div>
      <p class="saying">${esc(sayingFor())}</p>
      ${MTNS}
    </section>
    <div class="card accent clock" id="clock"><div class="muted small">Loading time clock…</div></div>
    <div id="mytimer" class="section"></div>
    <div id="reqalert"></div>
    ${state.profile.extra_clock ? '<div class="card clock section" id="xclock"><div class="muted small">Loading extra hours…</div></div>' : ""}
    <div class="stack section">
      ${(ann.data ?? []).map((a) => `
        <div class="card">
          <div class="row between"><h3 style="margin:0">${a.pinned ? "📌 " : ""}${esc(a.title)}</h3>
            ${a.due_at ? `<span class="badge ${new Date(a.due_at) < new Date() ? "bad" : "warn"}">${fmtDate(a.due_at)}</span>` : ""}</div>
          ${a.body ? `<div class="prose small">${md(a.body)}</div>` : ""}
          ${can("admin") ? `<div class="row" style="margin-top:8px"><button class="btn sm" data-edit-ann="${a.id}">Edit</button></div>` : ""}
        </div>`).join("") || ""}
    </div>

    <div class="grid2 section">
      <div class="card"><div class="row between"><h2>My jobs</h2><span class="badge">${myJobs.length}</span></div>
        ${jobRows(myJobs) || '<p class="muted small">Nothing assigned to you.</p>'}</div>
      <div class="card"><div class="row between"><h2>Due this week</h2><span class="badge ${dueSoon.some((j) => daysUntil(j.due_date) < 0) ? "bad" : ""}">${dueSoon.length}</span></div>
        ${jobRows(dueSoon) || '<p class="muted small">Nothing due in the next 7 days.</p>'}</div>
    </div>`;
  wireTopbar(root);
  renderClock(root.querySelector("#clock"));
  if (state.profile.extra_clock) renderExtraClock(root.querySelector("#xclock"));
  root.querySelector("#addAnn")?.addEventListener("click", () => editAnnouncement());
  root.querySelectorAll("[data-edit-ann]").forEach((b) => (b.onclick = () => editAnnouncement((ann.data ?? []).find((a) => a.id === b.dataset.editAnn))));
  root.querySelectorAll("[data-job]").forEach((b) => (b.onclick = () => viewJob((jobs.data ?? []).find((j) => j.id === b.dataset.job), () => renderShell())));
  renderMyTimer(root.querySelector("#mytimer"), () => renderShell());
  if (can("admin")) sb.from("timecard_requests").select("id", { count: "exact", head: true }).eq("status", "open").then(({ count }) => {
    const el = root.querySelector("#reqalert"); if (!el || !count) return;
    el.innerHTML = `<div class="card section row between" style="cursor:pointer" id="goreq"><span>🕑 <strong>${count}</strong> time card edit request${count > 1 ? "s" : ""} waiting</span><span class="badge warn">Review</span></div>`;
    el.querySelector("#goreq").onclick = () => { state.moreOpen = "requests"; go("more"); };
  });
}

let clockTimer = null;
async function renderClock(el, preset) {
  const res = preset ?? await fnCall("timeclock", { action: "status" });
  if (res.error) { el.innerHTML = `<div class="small error">${esc(res.error)}</div>`; return; }
  const open = res.open;
  if (res.note && !preset) toast(res.note);
  clearInterval(clockTimer);
  el.classList.toggle("on", !!open);
  el.innerHTML = `
    <div>
      <div class="state"><span class="dot"></span>${open ? "On the clock" : "Off the clock"}</div>
      ${open ? `<div class="timer" id="tmr">${hm(Date.now() - new Date(open.clock_in))}</div><div class="small muted">since ${timeOf(open.clock_in)}</div>`
             : `<div class="small muted">${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>`}
    </div>
    <button class="btn punch ${open ? "out" : "in"}" id="punch">${open ? "Clock out" : "Clock in"}</button>`;
  if (open) clockTimer = setInterval(() => { const t = document.getElementById("tmr"); if (!t) return clearInterval(clockTimer); t.textContent = hm(Date.now() - new Date(open.clock_in)); }, 30000);
  el.querySelector("#punch").onclick = async (e) => {
    if (open && !confirm(`Clock out now? You've been on ${hm(Date.now() - new Date(open.clock_in))}.`)) return;
    e.target.disabled = true; e.target.textContent = open ? "Clocking out…" : "Clocking in…";
    const r = await fnCall("timeclock", { action: open ? "clock_out" : "clock_in" });
    if (r.error) { toast(r.error); return renderClock(el); }
    toast(r.note || (open ? "Clocked out. Have a good one!" : "Clocked in. Let's build something."));
    renderClock(el, { open: r.open });
  };
}

// Second clock for hours outside someone's normal shift. App only, never sent to Square.
let xclockTimer = null;
async function renderExtraClock(el) {
  const since = weekStart(0);
  const { data } = await sb.from("extra_time_entries").select("*").eq("user_id", state.profile.id).gte("clock_in", weekStart(-1).toISOString()).order("clock_in", { ascending: false });
  const open = (data ?? []).find((e) => !e.clock_out);
  const week = (data ?? []).filter((e) => new Date(e.clock_in) >= since).reduce((a, e) => a + entryMs(e), 0);
  clearInterval(xclockTimer);
  el.classList.toggle("on", !!open);
  el.innerHTML = `
    <div>
      <div class="state"><span class="dot"></span>Extra hours: ${open ? "on" : "off"}</div>
      ${open ? `<div class="timer" id="xtmr">${hm(Date.now() - new Date(open.clock_in))}</div><div class="small muted">since ${timeOf(open.clock_in)}${open.note ? " · " + esc(open.note) : ""}</div>`
             : `<div class="small muted">This week: ${hm(week)}</div>`}
    </div>
    <button class="btn punch ${open ? "out" : "in"}" id="xpunch">${open ? "Stop extra" : "Start extra"}</button>`;
  if (open) xclockTimer = setInterval(() => { const t = document.getElementById("xtmr"); if (!t) return clearInterval(xclockTimer); t.textContent = hm(Date.now() - new Date(open.clock_in)); }, 30000);
  el.querySelector("#xpunch").onclick = async (e) => {
    let note = null;
    if (open) { if (!confirm(`Stop extra hours? You've logged ${hm(Date.now() - new Date(open.clock_in))}.`)) return; }
    else { note = prompt("What are the extra hours for? (optional)", ""); if (note === null) return; }
    e.target.disabled = true;
    const { error } = await sb.rpc("extra_clock_punch", { p_note: note });
    if (error) toast(error.message); else toast(open ? "Extra hours stopped." : "Extra hours started.");
    renderExtraClock(el);
  };
}


function editAnnouncement(a = {}) {
  sheet(`
    <form class="stack" id="f">
      <h2>${a.id ? "Edit note" : "New note or reminder"}</h2>
      <div><label>Title</label><input name="title" value="${esc(a.title)}" required></div>
      <div><label>Details</label><textarea name="body">${esc(a.body)}</textarea></div>
      <div class="grid2">
        <div><label>Due (optional)</label><input name="due_at" type="date" value="${a.due_at ? a.due_at.slice(0, 10) : ""}"></div>
        <div><label>Who sees it</label><select name="min_role">${["shop", "lead", "admin"].map((r) => `<option value="${r}" ${a.min_role === r ? "selected" : ""}>${r === "shop" ? "Everyone" : ROLE_LABEL[r] + "s and up"}</option>`).join("")}</select></div>
      </div>
      <label class="row" style="color:var(--text)"><input type="checkbox" name="pinned" style="width:auto;min-height:0" ${a.pinned ? "checked" : ""}> Pin to top</label>
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>
        ${a.id ? '<button type="button" class="btn danger" id="del">Delete</button>' : ""}</div>
    </form>`, (root, close) => {
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const row = { title: f.title, body: f.body || null, due_at: f.due_at ? f.due_at + "T12:00:00-07:00" : null, min_role: f.min_role, pinned: f.pinned };
      const { error } = a.id ? await sb.from("announcements").update(row).eq("id", a.id) : await sb.from("announcements").insert(row);
      if (error) return toast(error.message);
      close(); renderShell();
    };
    root.querySelector("#del")?.addEventListener("click", async () => {
      if (!confirm("Delete this note?")) return;
      await sb.from("announcements").delete().eq("id", a.id);
      close(); renderShell();
    });
  });
}

// ---------------------------------------------------------------- Jobs
// A job moves through steps (processes). Guys time themselves on a step and log how many pieces they
// finished; that builds the "minutes per 10 pieces" database for each product and process.
const DEFAULT_STEPS = ["Mill", "Glue-up", "Flatten", "Cut to size", "CNC / Route", "Sand", "Finish", "Engrave", "Pack"];
let jobFilter = "Active";
async function renderJobs(root) {
  const [{ data: jobs }, { data: steps }] = await Promise.all([
    sb.from("jobs").select("*").order("due_date", { ascending: true, nullsFirst: false }).order("created_at"),
    sb.from("job_steps").select("id, job_id, name, position, done_qty").order("position"),
    loadProfiles(),
  ]);
  state.cache.jobs = jobs ?? [];
  const byJob = {};
  (steps ?? []).forEach((st) => (byJob[st.job_id] ??= []).push(st));
  const list = (jobs ?? []).filter((j) => (jobFilter === "Complete" ? j.status === "Complete" : j.status !== "Complete"));
  if (jobFilter === "Complete") list.sort((a, b) => new Date(b.completed_at ?? b.updated_at) - new Date(a.completed_at ?? a.updated_at));
  const counts = { Active: (jobs ?? []).filter((j) => j.status !== "Complete").length, Complete: (jobs ?? []).filter((j) => j.status === "Complete").length };
  root.innerHTML = `
    ${topbar("Jobs", can("lead") && jobFilter === "Active" ? '<button class="btn sm primary" id="new">+ Job</button>' : "")}
    <div class="chips">${["Active", "Complete"].map((f) => `<button class="chip ${f === jobFilter ? "active" : ""}" data-f="${f}">${f.toUpperCase()} <span class="small">${counts[f]}</span></button>`).join("")}</div>
    <div id="mytimer" style="margin-top:12px"></div>
    <div class="list" style="margin-top:12px">${list.map((j) => jobCard(j, byJob[j.id] ?? [])).join("") || `<div class="empty">${jobFilter === "Active" ? "No active jobs. Tap + Job to add one." : "Nothing completed yet."}</div>`}</div>`;
  wireTopbar(root);
  renderMyTimer(root.querySelector("#mytimer"), () => renderJobs(root));
  root.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { jobFilter = b.dataset.f; renderJobs(root); }));
  root.querySelector("#new")?.addEventListener("click", () => editJob({}, () => renderJobs(root)));
  root.querySelectorAll("[data-job]").forEach((b) => (b.onclick = () => viewJob(jobs.find((j) => j.id === b.dataset.job), () => renderJobs(root))));
}

// Progress = pieces through all steps / (pieces x steps).
function jobProgress(j, steps) {
  if (!steps.length) return 0;
  const total = steps.length * j.quantity;
  return Math.round((steps.reduce((a, st) => a + Math.min(st.done_qty, j.quantity), 0) / total) * 100);
}
function currentStep(j, steps) { return steps.find((st) => st.done_qty < j.quantity); }

function jobCard(j, steps) {
  const d = j.due_date ? daysUntil(j.due_date) : null;
  const dueCls = d === null ? "" : d < 0 ? "bad" : d <= 2 ? "warn" : "";
  const pct = jobProgress(j, steps), cur = currentStep(j, steps);
  return `<div class="item" data-job="${j.id}">
    <div class="row between"><span class="title">${esc(j.title)}</span>
      ${j.status === "Complete" ? '<span class="badge ok">Complete</span>' : j.due_date ? `<span class="badge ${dueCls}">Due ${fmtDate(j.due_date)}</span>` : ""}</div>
    <div class="small muted">${[j.quantity + " pc", j.product, j.customer, j.assigned_to ? nameOf(j.assigned_to) : ""].filter(Boolean).map(esc).join(" · ")}${j.priority === "Rush" ? ' · <span class="badge bad">Rush</span>' : ""}</div>
    ${j.status !== "Complete" && steps.length ? `<div class="progress" style="margin-top:6px"><span style="width:${pct}%"></span></div>
      <div class="small muted" style="margin-top:2px">${pct}%${cur ? ` · Now: ${esc(cur.name)} (${cur.done_qty}/${j.quantity})` : " · All steps done"}</div>` : ""}
  </div>`;
}

// Kept for the Home screen lists.
function jobRows(list) {
  if (!list.length) return "";
  return `<div class="list" style="margin-top:6px">${list.map((j) => {
    const d = j.due_date ? daysUntil(j.due_date) : null;
    const dueCls = d === null ? "" : d < 0 ? "bad" : d <= 2 ? "warn" : "";
    return `<div class="item" data-job="${j.id}"><div class="row between"><span class="title">${esc(j.title)}</span>
      <span class="badge">${j.quantity ?? 1} pc</span></div>
      <div class="small muted">${esc(j.customer ?? "")}${j.due_date ? ` · <span class="badge ${dueCls}">Due ${fmtDate(j.due_date)}</span>` : ""}${j.priority === "Rush" ? ' · <span class="badge bad">Rush</span>' : ""}</div></div>`;
  }).join("")}</div>`;
}

const fmtMin = (m) => { m = Math.round(m); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };

// Banner for whoever has a process timer running (Jobs tab and Home).
let myTimerTick = null;
async function renderMyTimer(el, after) {
  if (!el) return;
  const { data } = await sb.from("job_timers").select("*, job_steps(name), jobs(title, quantity)").eq("user_id", state.profile.id).is("ended_at", null).maybeSingle();
  clearInterval(myTimerTick);
  if (!data) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="card clock on" style="margin:0">
    <div><div class="state"><span class="dot"></span>Timing: ${esc(data.job_steps?.name ?? "step")}</div>
      <div class="timer" id="jt">${hm(Date.now() - new Date(data.started_at))}</div>
      <div class="small muted">${esc(data.jobs?.title ?? "")} · since ${timeOf(data.started_at)}</div></div>
    <div class="stack" style="gap:6px;align-items:stretch"><button class="btn punch out" id="jstop">Stop</button><button class="btn sm" id="jcancel">Cancel timer</button></div></div>`;
  myTimerTick = setInterval(() => { const t = document.getElementById("jt"); if (!t) return clearInterval(myTimerTick); t.textContent = hm(Date.now() - new Date(data.started_at)); }, 30000);
  el.querySelector("#jstop").onclick = () => stopTimer(data, after);
  el.querySelector("#jcancel").onclick = () => cancelTimer(data, after);
}

function stopTimer(t, after) {
  sheet(`
    <form class="stack" id="f">
      <h2>Stop timer</h2>
      <p class="small muted" style="margin:0">${esc(t.job_steps?.name ?? "")} · ${esc(t.jobs?.title ?? "")} · ${hm(Date.now() - new Date(t.started_at))}</p>
      <div><label>How many pieces did you finish on this step?</label><input name="pieces" type="number" min="0" step="1" inputmode="numeric" required autofocus></div>
      <div><label>Note (optional)</label><input name="note" placeholder="Interrupted, machine down, extra defects…"></div>
      <div class="row wrap"><button class="btn primary">Save time</button><button type="button" class="btn" data-close>Keep timing</button><button type="button" class="btn danger" id="cancelt">Cancel timer</button></div>
    </form>`, (root, close) => {
    root.querySelector("#cancelt").onclick = () => { close(); cancelTimer(t, after); };
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const { error } = await sb.rpc("job_timer_stop", { p_pieces: Number(f.pieces), p_note: f.note || null });
      if (error) return toast(error.message);
      toast(`Logged ${f.pieces} piece${f.pieces === "1" ? "" : "s"}. Nice work.`);
      close(); after?.();
    };
  });
}

// Started by accident? Throw it away: no time logged, no pieces counted.
async function cancelTimer(t, after) {
  const mins = Math.round((Date.now() - new Date(t.started_at)) / 60000);
  if (!confirm(`Cancel this timer${t.job_steps?.name ? ` on ${t.job_steps.name}` : ""}? The ${mins} min won't be saved.`)) return;
  const { error } = await sb.rpc("job_timer_cancel");
  if (error) return toast(error.message);
  toast("Timer canceled. Nothing was logged."); after?.();
}

async function viewJob(j, done) {
  const [{ data: steps }, { data: timers }, { data: notes }] = await Promise.all([
    sb.from("job_steps").select("*").eq("job_id", j.id).order("position"),
    sb.from("job_timers").select("*").eq("job_id", j.id).order("started_at", { ascending: false }),
    sb.from("job_notes").select("*").eq("job_id", j.id).order("created_at"),
  ]);
  const notesFor = (stepId) => (notes ?? []).filter((n) => (n.step_id ?? null) === stepId);
  const noteList = (list) => list.map((n) => `<div class="note"><div class="small"><strong>${esc(nameOf(n.user_id))}</strong> <span class="muted">${new Date(n.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      ${n.user_id === state.profile.id || can("admin") ? `<button class="linkbtn" data-delnote="${n.id}" aria-label="Delete note">×</button>` : ""}</div><div style="white-space:pre-wrap">${esc(n.body)}</div></div>`).join("");
  const noteForm = (stepId) => `<form class="row" data-noteform="${stepId ?? ""}" style="gap:6px;margin-top:6px"><input name="body" placeholder="Add a note…" autocomplete="off" style="flex:1"><button class="btn sm">Post</button></form>`;
  const products = [j.product || j.title];
  const { data: stats } = await sb.from("process_stats").select("*").in("product", products);
  const statFor = (name) => (stats ?? []).find((x) => x.step === name);
  const mine = (timers ?? []).find((t) => t.user_id === state.profile.id && !t.ended_at);
  const mins = (t) => ((t.ended_at ? new Date(t.ended_at) : new Date()) - new Date(t.started_at)) / 60000;
  const stepMin = (id) => (timers ?? []).filter((t) => t.step_id === id).reduce((a, t) => a + mins(t), 0);
  const totalMin = (timers ?? []).reduce((a, t) => a + mins(t), 0);
  const running = (timers ?? []).filter((t) => !t.ended_at);
  const pct = jobProgress(j, steps ?? []);
  sheet(`
    <div class="row between"><span class="badge ${j.status === "Complete" ? "ok" : ""}">${j.status === "Complete" ? "Complete" : "Active"}</span><button class="btn sm" data-close>Close</button></div>
    <h2 style="margin:10px 0 2px">${esc(j.title)}</h2>
    <p class="small muted" style="margin:0">${[j.quantity + " pieces", j.product, j.customer, j.channel, j.due_date ? "Due " + fmtDate(j.due_date) : "", j.assigned_to ? "Lead: " + nameOf(j.assigned_to) : ""].filter(Boolean).map(esc).join(" · ")}</p>
    ${j.notes ? `<p class="small" style="white-space:pre-wrap">${esc(j.notes)}</p>` : ""}
    <div class="progress" style="margin:10px 0 4px"><span style="width:${pct}%"></span></div>
    <div class="row between small muted"><span>${pct}% done</span><span>Total time logged: ${fmtMin(totalMin)}</span></div>
    ${running.length ? `<p class="small" style="margin:6px 0 0">⏱ On it now: ${running.map((t) => esc(nameOf(t.user_id)) + " (" + esc((steps ?? []).find((s) => s.id === t.step_id)?.name ?? "") + ")").join(", ")}</p>` : ""}
    <h3 class="section" style="margin-bottom:4px">Steps</h3>
    <div class="list">${(steps ?? []).map((st) => {
      const s10 = statFor(st.name);
      return `<div class="item" style="cursor:default">
        <div class="row between"><span class="title">${esc(st.name)}</span><span class="badge ${st.done_qty >= j.quantity ? "ok" : ""}">${st.done_qty}/${j.quantity}</span></div>
        <div class="progress thin" style="margin:6px 0"><span style="width:${Math.min(100, Math.round(st.done_qty / j.quantity * 100))}%"></span></div>
        <div class="row between" style="gap:6px;flex-wrap:wrap">
          <span class="small muted">This job: ${fmtMin(stepMin(st.id))}${s10?.minutes_per_10 ? ` · Avg ${fmtMin(s10.minutes_per_10)} per 10 pcs` : ""}</span>
          <span class="row" style="gap:6px">
            ${j.status !== "Complete" ? (mine?.step_id === st.id ? '<button class="btn sm danger" data-stop>Stop</button><button class="btn sm" data-cancelt>Cancel</button>' : `<button class="btn sm primary" data-start="${st.id}" ${mine ? "disabled" : ""}>Start timer</button>`) : ""}
            <button class="btn sm" data-notes="${st.id}">💬 ${notesFor(st.id).length || ""}</button>
            ${can("lead") && j.status !== "Complete" ? `<button class="btn icon sm" data-fix="${st.id}" aria-label="Adjust count">✎</button>` : ""}
          </span></div>
        <div class="notes" id="notes-${st.id}" style="display:none">${noteList(notesFor(st.id))}${noteForm(st.id)}</div></div>`;
    }).join("") || '<div class="empty">No steps on this job.</div>'}</div>
    <h3 class="section" style="margin-bottom:4px">Job notes</h3>
    <div class="notes">${noteList(notesFor(null)) || '<p class="small muted" style="margin:0">No notes yet. Anything the next guy should know goes here.</p>'}${noteForm(null)}</div>
    ${(timers ?? []).length ? `<details class="section"><summary class="small">Time log (${timers.length})</summary>
      <table style="margin-top:6px"><tr><th>Who</th><th>Step</th><th>Time</th><th>Pcs</th></tr>${timers.map((t) => `<tr>
        <td>${esc(nameOf(t.user_id))}</td><td>${esc((steps ?? []).find((s) => s.id === t.step_id)?.name ?? "")}</td>
        <td>${t.ended_at ? fmtMin(mins(t)) : '<span class="badge ok">Running</span>'}</td><td>${t.pieces ?? ""}</td></tr>`).join("")}</table></details>` : ""}
    <div class="row wrap" style="margin-top:14px">
      ${can("lead") ? '<button class="btn" id="edit">Edit job</button>' : ""}
      ${can("lead") && j.status !== "Complete" ? '<button class="btn primary" id="complete">Mark complete</button>' : ""}
      ${can("lead") && j.status === "Complete" ? '<button class="btn" id="reopen">Reopen</button>' : ""}
    </div>`, (root, close) => {
    root.querySelectorAll("[data-start]").forEach((b) => (b.onclick = async () => {
      const { error } = await sb.rpc("job_timer_start", { p_step: b.dataset.start });
      if (error) return toast(error.message);
      toast("Timer started. Stop it when you finish the batch."); close(); done?.();
    }));
    root.querySelector("[data-stop]")?.addEventListener("click", () => {
      close(); stopTimer({ ...mine, job_steps: { name: (steps ?? []).find((s) => s.id === mine.step_id)?.name }, jobs: { title: j.title } }, done);
    });
    root.querySelectorAll("[data-notes]").forEach((b) => (b.onclick = () => {
      const box = root.querySelector("#notes-" + b.dataset.notes); box.style.display = box.style.display === "none" ? "" : "none";
      if (box.style.display === "") box.querySelector("input")?.focus();
    }));
    root.querySelectorAll("[data-noteform]").forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const body = f.querySelector("input").value.trim(); if (!body) return;
      const { error } = await sb.from("job_notes").insert({ job_id: j.id, step_id: f.dataset.noteform || null, body });
      if (error) return toast(error.message);
      close(); viewJob(j, done);
    }));
    root.querySelectorAll("[data-delnote]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Delete this note?")) return;
      await sb.from("job_notes").delete().eq("id", b.dataset.delnote); close(); viewJob(j, done);
    }));
    root.querySelector("[data-cancelt]")?.addEventListener("click", () => {
      close(); cancelTimer({ ...mine, job_steps: { name: (steps ?? []).find((s) => s.id === mine.step_id)?.name } }, done);
    });
    root.querySelectorAll("[data-fix]").forEach((b) => (b.onclick = async () => {
      const st = steps.find((s) => s.id === b.dataset.fix);
      const v = prompt(`Pieces done on ${st.name} (out of ${j.quantity}):`, st.done_qty);
      if (v === null || v.trim() === "" || isNaN(Number(v))) return;
      const { error } = await sb.from("job_steps").update({ done_qty: Math.max(0, Math.round(Number(v))) }).eq("id", st.id);
      if (error) return toast(error.message);
      close(); viewJob(j, done);
    }));
    root.querySelector("#edit")?.addEventListener("click", () => { close(); editJob(j, done, steps ?? []); });
    root.querySelector("#complete")?.addEventListener("click", async () => {
      if (running.length && !confirm("Someone still has a timer running on this job. Complete it anyway?")) return;
      const { error } = await sb.from("jobs").update({ status: "Complete", completed_at: new Date().toISOString() }).eq("id", j.id);
      if (error) return toast(error.message);
      log("update_job", "job", j.id, { to: "Complete" }); toast("Job complete. Moved to COMPLETE."); close(); done?.();
    });
    root.querySelector("#reopen")?.addEventListener("click", async () => {
      await sb.from("jobs").update({ status: "Active", completed_at: null }).eq("id", j.id); close(); done?.();
    });
  });
}

async function editJob(j = {}, done, steps = null) {
  const people = (state.cache.profiles ?? []).filter((p) => p.active && p.role !== "pending");
  const { data: past } = await sb.from("jobs").select("product").not("product", "is", null).limit(200);
  const productOpts = [...new Set([...(past ?? []).map((p) => p.product), ...((state.cache.sopTitles) ?? [])])].filter(Boolean).sort();
  sheet(`
    <form class="stack" id="f">
      <h2>${j.id ? "Edit job" : "New job"}</h2>
      <div><label>Job</label><input name="title" value="${esc(j.title)}" required placeholder="e.g. MKC order #1042"></div>
      <div class="grid2">
        <div><label>Product</label><input name="product" value="${esc(j.product)}" list="prods" placeholder="MKC Cutting Board"><datalist id="prods">${productOpts.map((p) => `<option>${esc(p)}</option>`).join("")}</datalist></div>
        <div><label>Pieces</label><input name="quantity" type="number" min="1" step="1" inputmode="numeric" value="${esc(j.quantity ?? 10)}" required></div>
        <div><label>Customer</label><input name="customer" value="${esc(j.customer)}"></div>
        <div><label>Channel</label><select name="channel">${CHANNELS.map((c) => `<option ${j.channel === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div><label>Due date</label><input type="date" name="due_date" value="${esc(j.due_date)}"></div>
        <div><label>Priority</label><select name="priority">${["Low", "Normal", "Rush"].map((p) => `<option ${(j.priority ?? "Normal") === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
        <div><label>Lead on this job</label><select name="assigned_to"><option value="">—</option>${people.map((p) => `<option value="${p.id}" ${j.assigned_to === p.id ? "selected" : ""}>${esc(p.full_name || p.email)}</option>`).join("")}</select></div>
      </div>
      ${j.id ? "" : `<div><label>Steps (one per line, in order)</label><textarea name="steps" style="min-height:170px">${DEFAULT_STEPS.join("\n")}</textarea>
        <p class="small muted" style="margin:4px 0 0">Use the same step names every time so the timing averages line up.</p></div>`}
      <div><label>Notes</label><textarea name="notes" style="min-height:70px">${esc(j.notes)}</textarea></div>
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>
        ${j.id && can("admin") ? '<button type="button" class="btn danger" id="del">Delete</button>' : ""}</div>
    </form>`, (root, close) => {
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const row = { title: f.title, product: f.product || null, quantity: Math.max(1, Math.round(Number(f.quantity))), customer: f.customer || null,
        channel: f.channel, due_date: f.due_date || null, priority: f.priority, assigned_to: f.assigned_to || null, notes: f.notes || null };
      if (!j.id) row.status = "Active";
      const res = j.id ? await sb.from("jobs").update(row).eq("id", j.id).select().single() : await sb.from("jobs").insert(row).select().single();
      if (res.error) return toast(res.error.message);
      if (!j.id) {
        const names = String(f.steps ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
        if (names.length) {
          const r2 = await sb.from("job_steps").insert(names.map((name, position) => ({ job_id: res.data.id, name, position })));
          if (r2.error) toast("Job saved, but steps didn't: " + r2.error.message);
        }
      }
      log(j.id ? "update_job" : "create_job", "job", res.data.id, { title: row.title });
      close(); done ? done() : renderShell();
    };
    root.querySelector("#del")?.addEventListener("click", async () => {
      if (!confirm("Delete this job and its time log? This can't be undone.")) return;
      await sb.from("jobs").delete().eq("id", j.id);
      log("delete_job", "job", j.id, { title: j.title });
      close(); done ? done() : renderShell();
    });
  });
}

// ---------------------------------------------------------------- Inventory
let invCat = "All", invQ = "", invTab = "Website";
async function renderInventory(root) {
  if (invTab === "Wholesale") return renderWholesale(root);
  const { data: items } = await sb.from("inventory_items").select("*").eq("source", "shopify").order("category").order("name");
  state.cache.inventory = items ?? [];
  let suppliers = [];
  if (can("lead")) suppliers = (await sb.from("suppliers").select("id, name").order("name")).data ?? [];
  state.cache.suppliers = suppliers;
  const q = invQ.toLowerCase();
  const list = (items ?? []).filter((i) =>
    (invCat === "All" || (invCat === "Low" ? isLow(i) : i.category === invCat)) &&
    (!q || [i.name, i.sku, i.species, i.thickness, i.location].join(" ").toLowerCase().includes(q)));
  const lastSync = (items ?? []).filter((i) => i.synced_at).map((i) => i.synced_at).sort().pop();
  root.innerHTML = `
    ${topbar("Products", canInv() ? '<button class="btn sm" id="sync">Sync Shopify</button>' : "")}
    ${productTabs()}
    <input id="q" placeholder="Search boards, SKU…" value="${esc(invQ)}" style="margin-bottom:10px">
    ${lastSync ? `<p class="small muted" style="margin:0 0 8px">Product counts come from Shopify · last synced ${new Date(lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>` : ""}
    <div class="chips">${["All", "Low", ...INV_CATS].map((c) => `<button class="chip ${c === invCat ? "active" : ""}" data-c="${c}">${c}</button>`).join("")}</div>
    <div class="list" style="margin-top:12px">${list.map((i) => `
      <div class="item" data-id="${i.id}">
        <div class="row between">
          <div style="min-width:0" data-open="${i.id}"><div class="title">${esc(i.name)} ${isLow(i) ? '<span class="badge warn">Low</span>' : ""}</div>
            <div class="small muted">${i.source === "shopify" ? `<span class="badge">Shopify</span> ${esc(i.sku ?? "")}` : [i.species, i.thickness, i.location].filter(Boolean).map(esc).join(" · ") || esc(i.category)}</div></div>
          ${i.source === "shopify" ? `<div class="qty"><span class="n ${Number(i.quantity) <= 0 ? "error" : ""}">${Number(i.quantity)} <span class="small muted">${esc(i.unit)}</span></span>${canInv() ? '<button class="btn sm" data-set>Count</button>' : ""}</div>` : !canInv() ? `<div class="qty"><span class="n">${Number(i.quantity)} <span class="small muted">${esc(i.unit)}</span></span></div>` : `
          <div class="qty">
            <button class="btn icon sm" data-adj="-1" aria-label="Decrease">−</button>
            <span class="n">${Number(i.quantity)} <span class="small muted">${esc(i.unit)}</span></span>
            <button class="btn icon sm" data-adj="1" aria-label="Increase">+</button>
          </div>`}
        </div>
      </div>`).join("") || '<div class="empty">No items yet.</div>'}</div>`;
  wireTopbar(root);
  const qEl = root.querySelector("#q");
  qEl.oninput = () => { invQ = qEl.value; clearTimeout(qEl._t); qEl._t = setTimeout(() => { renderInventory(root).then(() => { const n = root.querySelector("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 250); };
  root.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { invCat = b.dataset.c; renderInventory(root); }));
  wireProductTabs(root);
  root.querySelector("#new")?.addEventListener("click", () => editItem());
  root.querySelector("#sync")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Syncing…";
    const r = await fnCall("shopify-inventory", { action: "sync" });
    if (r.error) { toast(r.error); e.target.disabled = false; e.target.textContent = "Sync Shopify"; return; }
    toast(`Synced ${r.synced} products from Shopify${r.removed ? `, removed ${r.removed}` : ""}`);
    renderInventory(root);
  });
  root.querySelectorAll("[data-set]").forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    setShopifyCount(items.find((i) => i.id === b.closest("[data-id]").dataset.id), root);
  }));
  root.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => {
    const it = items.find((i) => i.id === b.dataset.open);
    if (it.source === "shopify") return canInv() ? setShopifyCount(it, root) : toast("Product counts come from Shopify. Ask Mitchell, Brittany or one of the Nates to correct it.");
    if (!canInv()) return toast("Only people Mitchell has given inventory access can change inventory.");
    editItem(it);
  }));
  root.querySelectorAll("[data-adj]").forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const id = b.closest("[data-id]").dataset.id;
    const item = items.find((i) => i.id === id);
    const next = Math.max(0, Number(item.quantity) + Number(b.dataset.adj));
    const { error } = await sb.from("inventory_items").update({ quantity: next }).eq("id", id);
    if (error) return toast(error.message);
    log("adjust_inventory", "inventory", id, { name: item.name, from: Number(item.quantity), to: next });
    item.quantity = next;
    b.parentElement.querySelector(".n").innerHTML = `${next} <span class="small muted">${esc(item.unit)}</span>`;
  }));
}

function productTabs() {
  return `<div class="seg" style="margin-bottom:10px">${["Website", "Wholesale"].map((t) => `<button class="${invTab === t ? "active" : ""}" data-tab="${t}">${t === "Website" ? "WEBSITE INVENTORY" : "WHOLESALE"}</button>`).join("")}</div>`;
}
function wireProductTabs(root) {
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { invTab = b.dataset.tab; renderInventory(root); }));
}

// Wholesale / show / distributor stock: random-pattern pieces that aren't on the website. Database only, never Shopify.
let whQ = "";
async function renderWholesale(root) {
  const { data: items } = await sb.from("inventory_items").select("*").eq("source", "wholesale").order("category").order("name");
  const q = whQ.toLowerCase();
  const list = (items ?? []).filter((i) => !q || [i.name, i.category, i.species, i.location, i.notes].join(" ").toLowerCase().includes(q));
  const groups = {}; list.forEach((i) => (groups[i.category || "Other"] ??= []).push(i));
  const totalPcs = (items ?? []).reduce((a, i) => a + Number(i.quantity), 0);
  const totalVal = (items ?? []).reduce((a, i) => a + Number(i.quantity) * Number(i.wholesale_price ?? 0), 0);
  root.innerHTML = `
    ${topbar("Products", canInv() ? '<button class="btn sm primary" id="new">+ Item</button>' : "")}
    ${productTabs()}
    <input id="q" placeholder="Search patterns, species, bins…" value="${esc(whQ)}" style="margin-bottom:6px">
    <p class="small muted" style="margin:0 0 8px">Show and distributor stock. Tracked here only, not on Shopify. ${totalPcs} pieces on hand${totalVal && canInv() ? ` · ${money(totalVal)} at wholesale` : ""}.</p>
    ${Object.entries(groups).map(([cat, its]) => `<h2 class="section">${esc(cat)}</h2>
      <div class="list">${its.map((i) => `
        <div class="item hold" data-id="${i.id}"><div class="row between">
          ${i.photo_url ? `<img src="${esc(i.photo_url)}" alt="" data-open="${i.id}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0">` : ""}
          <div style="min-width:0;flex:1" data-open="${i.id}"><div class="title">${esc(i.name)}</div>
            <div class="small muted">${[i.species, i.location, i.wholesale_price != null ? money(i.wholesale_price) + " ea" : ""].filter(Boolean).map(esc).join(" · ")}</div></div>
          <div class="qty">${canInv() ? '<button class="btn icon sm" data-adj="-1" aria-label="Sold one">−</button>' : ""}
            <span class="n ${Number(i.quantity) <= 0 ? "error" : ""}">${Number(i.quantity)}</span>
            ${canInv() ? '<button class="btn icon sm" data-adj="1" aria-label="Add one">+</button>' : ""}</div>
        </div></div>`).join("")}</div>`).join("") || `<div class="empty">${(items ?? []).length ? "Nothing matches." : "No wholesale items yet. Tap + Item to add your random-pattern stock."}</div>`}`;
  wireTopbar(root); wireProductTabs(root);
  const qEl = root.querySelector("#q");
  qEl.oninput = () => { whQ = qEl.value; clearTimeout(qEl._t); qEl._t = setTimeout(() => renderWholesale(root).then(() => { const n = root.querySelector("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 250); };
  const again = () => renderWholesale(root);
  root.querySelector("#new")?.addEventListener("click", () => editWholesale({}, items ?? [], again));
  root.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { const it = items.find((i) => i.id === b.dataset.open); canInv() ? editWholesale(it, items, again) : toast(`${it.name}: ${Number(it.quantity)} on hand`); }));
  root.querySelectorAll("[data-adj]").forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const item = items.find((i) => i.id === b.closest("[data-id]").dataset.id);
    const next = Math.max(0, Number(item.quantity) + Number(b.dataset.adj));
    const { error } = await sb.from("inventory_items").update({ quantity: next }).eq("id", item.id);
    if (error) return toast(error.message);
    log("adjust_inventory", "inventory", item.id, { name: item.name, from: Number(item.quantity), to: next, wholesale: true });
    item.quantity = next; b.parentElement.querySelector(".n").textContent = next;
  }));
  if (canInv()) root.querySelectorAll(".item.hold").forEach((el) => onHold(el, () => {
    const it = items.find((i) => i.id === el.dataset.id);
    sheet(`<div class="row between"><h2 style="margin:0">${esc(it.name)}</h2><button class="btn sm" data-close>Close</button></div>
      <p class="small muted" style="margin:4px 0 12px">${Number(it.quantity)} on hand</p>
      <div class="stack"><button class="btn" id="count">Set count…</button><button class="btn" id="edit">Edit details</button><button class="btn danger" id="del">Delete</button></div>`, (r, close) => {
      r.querySelector("#count").onclick = async () => {
        const v = prompt(`How many ${it.name} on hand?`, Number(it.quantity)); if (v === null || v.trim() === "" || isNaN(Number(v))) return;
        const { error } = await sb.from("inventory_items").update({ quantity: Math.max(0, Number(v)) }).eq("id", it.id);
        if (error) return toast(error.message); close(); again();
      };
      r.querySelector("#edit").onclick = () => { close(); editWholesale(it, items, again); };
      r.querySelector("#del").onclick = async () => {
        if (!confirm(`Delete ${it.name}? This can't be undone.`)) return;
        const { error } = await sb.from("inventory_items").delete().eq("id", it.id);
        if (error) return toast(error.message); log("delete_inventory", "inventory", it.id, { name: it.name }); close(); again();
      };
    });
  }));
}

function editWholesale(i, all, done) {
  const cats = [...new Set(["Cutting boards", "Butcher blocks", "Charcuterie", "Knife blocks & rails", "Coasters & small goods", ...all.map((x) => x.category).filter(Boolean)])];
  sheet(`
    <form class="stack" id="f"><h2>${i.id ? "Edit wholesale item" : "New wholesale item"}</h2>
      <div><label>Item</label><input name="name" value="${esc(i.name)}" required placeholder="Random pattern end grain 12x16"></div>
      <div class="row" style="align-items:center">
        <img id="ph" src="${esc(i.photo_url ?? "")}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:10px;background:var(--surface-2);${i.photo_url ? "" : "display:none"}">
        <label class="btn sm" style="margin:0;color:var(--text)">${i.photo_url ? "Change photo" : "Add photo"}<input type="file" accept="image/*" capture="environment" id="photo" style="display:none"></label></div>
      <div class="grid2">
        <div><label>Category</label><input name="category" value="${esc(i.category)}" list="whcats" required><datalist id="whcats">${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></div>
        <div><label>Species / pattern</label><input name="species" value="${esc(i.species)}" placeholder="Walnut & maple, random"></div>
        <div><label>On hand</label><input name="quantity" type="number" min="0" step="1" value="${esc(i.quantity ?? 0)}" required></div>
        <div><label>Wholesale price (each)</label><input name="wholesale_price" type="number" step="0.01" value="${esc(i.wholesale_price)}"></div>
        <div><label>Where it's kept</label><input name="location" value="${esc(i.location)}" placeholder="Show bins, rack C"></div>
        <div><label>Low at</label><input name="reorder_point" type="number" step="1" value="${esc(i.reorder_point)}"></div>
      </div>
      <div><label>Notes</label><textarea name="notes" style="min-height:70px">${esc(i.notes)}</textarea></div>
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button></div>
    </form>`, (root, close) => {
    let photoFile = null;
    root.querySelector("#photo").onchange = (e) => { photoFile = e.target.files[0] ?? null; if (photoFile) { const ph = root.querySelector("#ph"); ph.src = URL.createObjectURL(photoFile); ph.style.display = ""; } };
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target), num = (x) => (x === "" ? null : Number(x));
      const row = { name: f.name, category: f.category, species: f.species || null, quantity: Number(f.quantity), unit: "ea", wholesale_price: num(f.wholesale_price),
        location: f.location || null, reorder_point: num(f.reorder_point), notes: f.notes || null, source: "wholesale" };
      if (photoFile) {
        const path = `wholesale/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from("supplies").upload(path, await shrinkImage(photoFile, 1200), { contentType: "image/jpeg" });
        if (up.error) return toast("Photo upload failed: " + up.error.message);
        row.photo_url = sb.storage.from("supplies").getPublicUrl(path).data.publicUrl;
      }
      const res = i.id ? await sb.from("inventory_items").update(row).eq("id", i.id).select().single() : await sb.from("inventory_items").insert(row).select().single();
      if (res.error) return toast(res.error.message);
      log(i.id ? "update_inventory" : "create_inventory", "inventory", res.data.id, { name: row.name, quantity: row.quantity, wholesale: true });
      close(); done();
    };
  });
}

function setShopifyCount(item, listRoot) {
  sheet(`
    <form class="stack" id="f">
      <h2>Correct count</h2>
      <div><strong>${esc(item.name)}</strong>${item.sku ? ` <span class="badge">${esc(item.sku)}</span>` : ""}</div>
      <p class="small muted" style="margin:0">The hub shows <strong>${Number(item.quantity)}</strong> available. Enter what's actually on the shelf. This updates Shopify right away and is logged under your name.</p>
      <div><label>Counted on hand</label><input name="q" type="number" step="1" inputmode="numeric" value="${Number(item.quantity)}" required></div>
      <div class="row"><button class="btn primary">Update Shopify</button><button type="button" class="btn" data-close>Cancel</button></div>
    </form>`, (root, close) => {
    const inp = root.querySelector("input"); inp.focus(); inp.select();
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector(".primary"); btn.disabled = true; btn.textContent = "Updating…";
      const r = await fnCall("shopify-inventory", { action: "set", id: item.id, quantity: Number(inp.value), expected: Number(item.quantity) });
      if (r.error) { toast(r.error); btn.disabled = false; btn.textContent = "Update Shopify"; if (r.current !== undefined) { close(); renderInventory(listRoot); } return; }
      toast(`Shopify updated: ${item.name} = ${r.quantity}`);
      close(); renderInventory(listRoot);
    };
  });
}

function editItem(i = {}) {
  const full = canInv();
  sheet(`
    <form class="stack" id="f">
      <h2>${i.id ? esc(i.name) : "New inventory item"}</h2>
      ${full ? `
      <div><label>Name</label><input name="name" value="${esc(i.name)}" required placeholder="e.g. Black walnut 8/4 FAS"></div>
      <div class="grid2">
        <div><label>Category</label><select name="category">${INV_CATS.map((c) => `<option ${i.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div><label>Species</label><input name="species" value="${esc(i.species)}"></div>
        <div><label>Thickness</label><input name="thickness" value="${esc(i.thickness)}" placeholder="4/4, 8/4…"></div>
        <div><label>Unit</label><input name="unit" value="${esc(i.unit ?? "bf")}" placeholder="bf, ea, gal"></div>
        <div><label>Reorder when at or below</label><input name="reorder_point" type="number" step="any" value="${esc(i.reorder_point)}"></div>
        <div><label>Supplier</label><select name="supplier_id"><option value="">—</option>${(state.cache.suppliers ?? []).map((s) => `<option value="${s.id}" ${i.supplier_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      </div>` : ""}
      <div class="grid2">
        <div><label>On hand${i.unit ? ` (${esc(i.unit)})` : ""}</label><input name="quantity" type="number" step="any" value="${esc(i.quantity ?? 0)}" required></div>
        <div><label>Location</label><input name="location" value="${esc(i.location)}" placeholder="Rack B, top"></div>
      </div>
      <div><label>Notes</label><textarea name="notes" style="min-height:70px">${esc(i.notes)}</textarea></div>
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>
        ${i.id && can("admin") ? '<button type="button" class="btn danger" id="del">Delete</button>' : ""}</div>
    </form>`, (root, close) => {
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const row = { quantity: Number(f.quantity), location: f.location || null, notes: f.notes || null };
      if (full) Object.assign(row, { name: f.name, category: f.category, species: f.species || null, thickness: f.thickness || null, unit: f.unit || "ea",
        reorder_point: f.reorder_point === "" ? null : Number(f.reorder_point), supplier_id: f.supplier_id || null });
      const res = i.id ? await sb.from("inventory_items").update(row).eq("id", i.id).select().single() : await sb.from("inventory_items").insert(row).select().single();
      if (res.error) return toast(res.error.message);
      log(i.id ? "update_inventory" : "create_inventory", "inventory", res.data.id, { name: res.data.name, quantity: res.data.quantity });
      close(); renderShell();
    };
    root.querySelector("#del")?.addEventListener("click", async () => {
      if (!confirm("Delete this item?")) return;
      await sb.from("inventory_items").delete().eq("id", i.id);
      log("delete_inventory", "inventory", i.id, { name: i.name });
      close(); renderShell();
    });
  });
}

// ---------------------------------------------------------------- Supplies (shop consumables + vendors)
let supCat = "All", supQ = "";
// Short vendor names for tight spaces on a phone ("Elevated Industrial Solutions" -> "Elevated").
const VENDOR_SHORT = { "Elevated Industrial Solutions": "Elevated", "Intermountain Wood Products": "IWP", "Montana Container Corporation": "MT Container" };
function shortVendor(n) {
  if (!n) return "";
  if (VENDOR_SHORT[n]) return VENDOR_SHORT[n];
  let s = n.replace(/\s*\(.*?\)\s*/g, " ").replace(/,?\s*\b(LLC|L\.L\.C\.|Inc\.?|Co\.|Corp\.?|Corporation|Company|Products|Solutions)\b\.?/gi, "").replace(/\s+/g, " ").trim();
  if (s.length > 18) s = s.split(" ").slice(0, 2).join(" ");
  return s || n;
}
const money = (n) => (n == null || n === "" ? "" : "$" + Number(n).toFixed(2));
async function renderSupplies(root) {
  const [{ data: items }, { data: vendors }] = await Promise.all([
    sb.from("inventory_items").select("*").eq("source", "hub").order("category").order("name"),
    sb.from("suppliers").select("*").order("name"),
  ]);
  state.cache.suppliers = vendors ?? [];
  const vName = (id) => shortVendor((vendors ?? []).find((v) => v.id === id)?.name ?? "");
  const q = supQ.toLowerCase();
  const list = (items ?? []).filter((i) =>
    (supCat === "All" || (supCat === "Low" ? isLow(i) : supCat === "Vendors" ? false : i.category === supCat)) &&
    (!q || [i.name, i.category, i.location, i.vendor_sku, vName(i.supplier_id)].join(" ").toLowerCase().includes(q)));
  const lowCount = (items ?? []).filter(isLow).length;
  const groups = {};
  list.forEach((i) => (groups[i.category] ??= []).push(i));
  const usedCats = SUPPLY_CATS.filter((c) => (items ?? []).some((i) => i.category === c));

  root.innerHTML = `
    ${topbar("Supplies", canInv() ? '<button class="btn sm primary" id="new">+ Supply</button>' : "")}
    <input id="q" placeholder="Search sandpaper, glue, vendor…" value="${esc(supQ)}" style="margin-bottom:10px">
    <div class="chips">${["All", "Low", "Vendors", ...usedCats].map((c) => `<button class="chip ${c === supCat ? "active" : ""}" data-c="${c}">${c === "Low" && lowCount ? `Low (${lowCount})` : c}</button>`).join("")}</div>
    <div id="body" style="margin-top:12px"></div>`;
  const body = root.querySelector("#body");

  if (supCat === "Vendors") {
    body.innerHTML = `${canInv() ? '<div class="row" style="margin-bottom:10px"><button class="btn sm primary" id="newv">+ Vendor</button></div>' : ""}
      <div class="list">${(vendors ?? []).map((v) => {
        const n = (items ?? []).filter((i) => i.supplier_id === v.id);
        return `<div class="item" data-v="${v.id}"><div class="row between"><span class="title">${esc(v.name)}</span><span class="badge">${n.length} item${n.length === 1 ? "" : "s"}</span></div>
          <div class="small muted">${[v.order_method, v.contact_name, v.phone, v.email, v.website, v.lead_time_days ? v.lead_time_days + "-day lead time" : ""].filter(Boolean).map(esc).join(" · ")}</div>
          ${n.length ? `<div class="small" style="margin-top:4px">${n.map((i) => esc(i.name)).join(", ")}</div>` : ""}</div>`;
      }).join("") || '<div class="empty">No vendors yet.</div>'}</div>`;
    body.querySelector("#newv")?.addEventListener("click", () => editVendor({}, () => renderSupplies(root)));
    body.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => canInv() ? editVendor(vendors.find((v) => v.id === b.dataset.v), () => renderSupplies(root)) : null));
  } else {
    const lowItems = (items ?? []).filter(isLow);
    let reorderOpen = true; try { reorderOpen = localStorage.getItem("mb_reorder_open") !== "0"; } catch {}
    const reorderCard = supCat === "All" && !q && lowItems.length ? `
      <details class="card collapse" id="reorder" style="margin-bottom:6px" ${reorderOpen ? "open" : ""}>
        <summary class="row between"><h2 style="margin:0">Needs reorder</h2><span class="row" style="gap:8px"><span class="badge warn">${lowItems.length}</span><span class="chev" aria-hidden="true">▾</span></span></summary>
        <table style="margin-top:6px"><tr><th>Item</th><th>Have</th><th>At</th><th>Vendor</th></tr>${lowItems.map((i) =>
          `<tr data-open="${i.id}" style="cursor:pointer"><td>${esc(i.name)}</td><td>${Number(i.quantity)} ${esc(i.unit)}</td><td>${i.reorder_point}</td><td class="small">${esc(vName(i.supplier_id))}</td></tr>`).join("")}</table></details>` : "";
    body.innerHTML = reorderCard + Object.entries(groups).map(([cat, its]) => `
      <h2 class="section">${esc(cat)}</h2>
      <div class="list">${its.map((i) => `
        <div class="item hold" data-id="${i.id}">
          <div class="row between">
            ${i.photo_url ? `<img src="${esc(i.photo_url)}" alt="" data-open="${i.id}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0">` : ""}
            <div style="min-width:0;flex:1" data-open="${i.id}">
              <div class="title">${esc(i.name)} ${isLow(i) ? '<span class="badge warn">Reorder</span>' : ""}</div>
              <div class="small muted">${[vName(i.supplier_id), i.vendor_sku ? "#" + i.vendor_sku : "", i.location].filter(Boolean).map(esc).join(" · ") || "No vendor set"}</div>
            </div>
            <div class="qty">
              ${canInv() ? '<button class="btn icon sm" data-adj="-1" aria-label="Use one">−</button>' : ""}
              <span class="n">${Number(i.quantity)} <span class="small muted">${esc(i.unit)}</span></span>
              ${canInv() ? '<button class="btn icon sm" data-adj="1" aria-label="Add one">+</button>' : ""}
            </div>
          </div>
        </div>`).join("")}</div>`).join("") || `<div class="empty">${(items ?? []).length ? "Nothing matches." : "No supplies tracked yet."}</div>`;
    body.querySelector("#reorder")?.addEventListener("toggle", (e) => { try { localStorage.setItem("mb_reorder_open", e.target.open ? "1" : "0"); } catch {} });
    body.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => supplyDetail(items.find((i) => i.id === b.dataset.open), vendors ?? [], () => renderSupplies(root))));
    if (canInv()) body.querySelectorAll(".item.hold").forEach((el) => onHold(el, () => supplyActions(items.find((i) => i.id === el.dataset.id), vendors ?? [], () => renderSupplies(root))));
    body.querySelectorAll("[data-adj]").forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      const id = b.closest("[data-id]").dataset.id;
      const item = items.find((i) => i.id === id);
      const next = Math.max(0, Number(item.quantity) + Number(b.dataset.adj));
      const { error } = await sb.from("inventory_items").update({ quantity: next }).eq("id", id);
      if (error) return toast(error.message);
      log("adjust_inventory", "inventory", id, { name: item.name, from: Number(item.quantity), to: next });
      item.quantity = next;
      b.parentElement.querySelector(".n").innerHTML = `${next} <span class="small muted">${esc(item.unit)}</span>`;
      if (isLow(item)) toast(`${item.name} is at or below its reorder point`);
    }));
  }
  wireTopbar(root);
  const qEl = root.querySelector("#q");
  qEl.oninput = () => { supQ = qEl.value; clearTimeout(qEl._t); qEl._t = setTimeout(() => renderSupplies(root).then(() => { const n = root.querySelector("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 250); };
  root.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { supCat = b.dataset.c; renderSupplies(root); }));
  root.querySelector("#new")?.addEventListener("click", () => editSupply({}, vendors ?? [], () => renderSupplies(root)));
}

// Press and hold (or right-click on a computer) to open a quick-action menu.
function onHold(el, fn, ms = 550) {
  let t = null, held = false, x0 = 0, y0 = 0;
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener("pointerdown", (e) => {
    if (e.button && e.button !== 0) return;
    held = false; x0 = e.clientX; y0 = e.clientY;
    t = setTimeout(() => { held = true; navigator.vibrate?.(25); fn(); }, ms);
  });
  el.addEventListener("pointermove", (e) => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => el.addEventListener(ev, cancel));
  el.addEventListener("click", (e) => { if (held) { e.stopPropagation(); e.preventDefault(); held = false; } }, true);
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!held) fn(); });
}

function supplyActions(i, vendors, done) {
  sheet(`
    <div class="row between"><h2 style="margin:0">${esc(i.name)}</h2><button class="btn sm" data-close>Close</button></div>
    <p class="small muted" style="margin:4px 0 12px">${Number(i.quantity)} ${esc(i.unit)} on hand</p>
    <div class="stack">
      <button class="btn" id="count">Set count…</button>
      <button class="btn" id="ordered">Mark ordered today</button>
      <button class="btn" id="edit">Edit details</button>
      <button class="btn danger" id="del">Delete</button>
    </div>`, (root, close) => {
    root.querySelector("#count").onclick = async () => {
      const v = prompt(`How many ${i.unit} of ${i.name} are on hand?`, Number(i.quantity));
      if (v === null || v.trim() === "" || isNaN(Number(v))) return;
      const next = Math.max(0, Number(v));
      const { error } = await sb.from("inventory_items").update({ quantity: next }).eq("id", i.id);
      if (error) return toast(error.message);
      log("adjust_inventory", "inventory", i.id, { name: i.name, from: Number(i.quantity), to: next });
      toast("Count saved"); close(); done();
    };
    root.querySelector("#ordered").onclick = async () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
      const { error } = await sb.from("inventory_items").update({ last_ordered: today }).eq("id", i.id);
      if (error) return toast(error.message);
      log("update_inventory", "inventory", i.id, { name: i.name, last_ordered: today });
      toast("Marked as ordered"); close(); done();
    };
    root.querySelector("#edit").onclick = () => { close(); editSupply(i, vendors, done); };
    root.querySelector("#del").onclick = async () => {
      if (!confirm(`Delete ${i.name} from Supplies? This can't be undone.`)) return;
      const { error } = await sb.from("inventory_items").delete().eq("id", i.id);
      if (error) return toast(error.message);
      log("delete_inventory", "inventory", i.id, { name: i.name });
      toast("Deleted"); close(); done();
    };
  });
}

// Phone photos are huge; shrink to a reasonable JPEG before uploading.
async function shrinkImage(file, max) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
}

function supplyDetail(i, vendors, done) {
  const v = vendors.find((x) => x.id === i.supplier_id);
  sheet(`
    <div class="row between"><span class="badge">${esc(i.category)}</span><button class="btn sm" data-close>Close</button></div>
    <h2 style="margin-top:10px">${esc(i.name)}</h2>
    ${i.photo_url ? `<img src="${esc(i.photo_url)}" alt="${esc(i.name)}" style="width:100%;max-height:320px;object-fit:contain;border-radius:12px;background:var(--surface-2);margin-bottom:10px">` : ""}
    <table>
      <tr><th>On hand</th><td>${Number(i.quantity)} ${esc(i.unit)} ${isLow(i) ? '<span class="badge warn">Reorder</span>' : ""}</td></tr>
      ${i.reorder_point != null ? `<tr><th>Reorder at</th><td>${i.reorder_point} ${esc(i.unit)}${i.reorder_qty ? ` · order ${i.reorder_qty}` : ""}</td></tr>` : ""}
      ${i.location ? `<tr><th>Where</th><td>${esc(i.location)}</td></tr>` : ""}
      ${v ? `<tr><th>Vendor</th><td><strong>${esc(v.name)}</strong>${i.vendor_sku ? ` · #${esc(i.vendor_sku)}` : ""}<br><span class="small muted">${[v.order_method, v.phone, v.email].filter(Boolean).map(esc).join(" · ")}</span>${v.website ? `<br><a href="${esc(v.website.startsWith("http") ? v.website : "https://" + v.website)}" target="_blank" rel="noopener">${esc(v.website)}</a>` : ""}</td></tr>` : ""}
      ${i.pack_size ? `<tr><th>Comes in</th><td>${esc(i.pack_size)}</td></tr>` : ""}
      ${i.unit_cost != null && canInv() ? `<tr><th>Last price</th><td>${money(i.unit_cost)} / ${esc(i.unit)}</td></tr>` : ""}
      ${i.last_ordered ? `<tr><th>Last ordered</th><td>${fmtDate(i.last_ordered)}</td></tr>` : ""}
      ${i.notes ? `<tr><th>Notes</th><td>${esc(i.notes)}</td></tr>` : ""}
    </table>
    ${canInv() ? '<div class="row" style="margin-top:12px"><button class="btn" id="edit">Edit</button></div>' : ""}`,
  (root, close) => root.querySelector("#edit")?.addEventListener("click", () => { close(); editSupply(i, vendors, done); }));
}

function editSupply(i, vendors, done) {
  sheet(`
    <form class="stack" id="f">
      <h2>${i.id ? "Edit supply" : "New supply"}</h2>
      <div><label>Item</label><input name="name" value="${esc(i.name)}" required placeholder="e.g. 120 grit 5&quot; hook &amp; loop discs"></div>
      <div class="row" style="align-items:center">
        <img id="ph" src="${esc(i.photo_url ?? "")}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:10px;background:var(--surface-2);${i.photo_url ? "" : "display:none"}">
        <label class="btn sm" style="margin:0;color:var(--text)">${i.photo_url ? "Change photo" : "Add photo"}<input type="file" accept="image/*" capture="environment" id="photo" style="display:none"></label>
      </div>
      <div class="grid2">
        <div><label>Category</label><select name="category">${SUPPLY_CATS.map((c) => `<option ${i.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div><label>Where it's kept</label><input name="location" value="${esc(i.location)}" placeholder="Finish room, shelf 2"></div>
        <div><label>On hand</label><input name="quantity" type="number" step="any" value="${esc(i.quantity ?? 0)}" required></div>
        <div><label>Counted in</label><input name="unit" value="${esc(i.unit ?? "ea")}" placeholder="box, gal, roll, ea"></div>
        <div><label>Reorder when at or below</label><input name="reorder_point" type="number" step="any" value="${esc(i.reorder_point)}"></div>
        <div><label>How many to order</label><input name="reorder_qty" type="number" step="any" value="${esc(i.reorder_qty)}"></div>
      </div>
      <h3 class="section" style="margin-bottom:0">Where it comes from</h3>
      <div class="grid2">
        <div><label>Vendor</label><select name="supplier_id"><option value="">—</option>${vendors.map((v) => `<option value="${v.id}" ${i.supplier_id === v.id ? "selected" : ""}>${esc(v.name)}</option>`).join("")}<option value="__new">+ New vendor…</option></select></div>
        <div><label>Vendor item #</label><input name="vendor_sku" value="${esc(i.vendor_sku)}"></div>
        <div><label>Comes in</label><input name="pack_size" value="${esc(i.pack_size)}" placeholder="box of 50, 5 gal pail"></div>
        <div><label>Last price per unit</label><input name="unit_cost" type="number" step="0.01" value="${esc(i.unit_cost)}"></div>
        <div><label>Last ordered</label><input name="last_ordered" type="date" value="${esc(i.last_ordered)}"></div>
      </div>
      <div><label>Notes</label><textarea name="notes" style="min-height:70px">${esc(i.notes)}</textarea></div>
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>
        ${i.id ? '<button type="button" class="btn danger" id="del">Delete</button>' : ""}</div>
    </form>`, (root, close) => {
    let photoFile = null;
    root.querySelector("#photo").onchange = (e) => {
      photoFile = e.target.files[0] ?? null;
      if (photoFile) { const ph = root.querySelector("#ph"); ph.src = URL.createObjectURL(photoFile); ph.style.display = ""; }
    };
    root.querySelector('[name="supplier_id"]').onchange = (e) => {
      if (e.target.value !== "__new") return;
      e.target.value = "";
      editVendor({}, (v) => { if (!v) return; vendors.push(v); const o = new Option(v.name, v.id, true, true); e.target.add(o, e.target.options.length - 1); });
    };
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const num = (x) => (x === "" ? null : Number(x));
      const row = { name: f.name, category: f.category, location: f.location || null, quantity: Number(f.quantity), unit: f.unit || "ea",
        reorder_point: num(f.reorder_point), reorder_qty: num(f.reorder_qty), supplier_id: f.supplier_id || null, vendor_sku: f.vendor_sku || null,
        pack_size: f.pack_size || null, unit_cost: num(f.unit_cost), last_ordered: f.last_ordered || null, notes: f.notes || null, source: "hub" };
      if (photoFile) {
        const btn = e.target.querySelector(".primary"); btn.disabled = true; btn.textContent = "Uploading photo…";
        const small = await shrinkImage(photoFile, 1200);
        const path = `${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from("supplies").upload(path, small, { contentType: "image/jpeg" });
        if (up.error) { btn.disabled = false; btn.textContent = "Save"; return toast("Photo upload failed: " + up.error.message); }
        row.photo_url = sb.storage.from("supplies").getPublicUrl(path).data.publicUrl;
      }
      const res = i.id ? await sb.from("inventory_items").update(row).eq("id", i.id).select().single() : await sb.from("inventory_items").insert(row).select().single();
      if (res.error) return toast(res.error.message);
      log(i.id ? "update_inventory" : "create_inventory", "inventory", res.data.id, { name: row.name, quantity: row.quantity });
      close(); done();
    };
    root.querySelector("#del")?.addEventListener("click", async () => {
      if (!confirm(`Delete ${i.name}?`)) return;
      await sb.from("inventory_items").delete().eq("id", i.id);
      log("delete_inventory", "inventory", i.id, { name: i.name });
      close(); done();
    });
  });
}

function editVendor(v = {}, done) {
  sheet(`
    <form class="stack" id="f"><h2>${v.id ? "Edit vendor" : "New vendor"}</h2>
      <div><label>Vendor name</label><input name="name" value="${esc(v.name)}" required></div>
      <div class="grid2">
        <div><label>How we order</label><select name="order_method"><option value="">—</option>${ORDER_METHODS.map((m) => `<option ${v.order_method === m ? "selected" : ""}>${m}</option>`).join("")}</select></div>
        <div><label>Website</label><input name="website" value="${esc(v.website)}"></div>
        <div><label>Contact / rep</label><input name="contact_name" value="${esc(v.contact_name)}"></div>
        <div><label>Phone</label><input name="phone" type="tel" value="${esc(v.phone)}"></div>
        <div><label>Email</label><input name="email" type="email" value="${esc(v.email)}"></div>
        <div><label>Our account #</label><input name="account_number" value="${esc(v.account_number)}"></div>
        <div><label>Lead time (days)</label><input name="lead_time_days" type="number" value="${esc(v.lead_time_days)}"></div>
      </div>
      <div><label>Notes</label><textarea name="notes" style="min-height:70px">${esc(v.notes)}</textarea></div>
      <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button></div>
    </form>`, (root, close) => {
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const row = { ...f, lead_time_days: f.lead_time_days ? Number(f.lead_time_days) : null };
      Object.keys(row).forEach((k) => row[k] === "" && (row[k] = null));
      const res = v.id ? await sb.from("suppliers").update(row).eq("id", v.id).select().single() : await sb.from("suppliers").insert(row).select().single();
      if (res.error) return toast(res.error.message);
      close(); done(res.data);
    };
  });
}

// ---------------------------------------------------------------- SOPs
let sopQ = "";
async function renderSops(root) {
  const { data: sops } = await sb.from("sops").select("*").order("category").order("title");
  const q = sopQ.toLowerCase();
  const list = (sops ?? []).filter((s) => !q || (s.title + " " + s.category + " " + s.body).toLowerCase().includes(q));
  const groups = {};
  list.forEach((s) => (groups[s.category] ??= []).push(s));
  root.innerHTML = `
    ${topbar("SOPs", can("admin") ? '<button class="btn sm primary" id="new">+ SOP</button>' : "")}
    <input id="q" placeholder="Search procedures…" value="${esc(sopQ)}" style="margin-bottom:6px">
    ${Object.entries(groups).map(([cat, items]) => `
      <h2 class="section">${esc(cat)}</h2>
      <div class="list">${items.map((s) => `<div class="item" data-sop="${s.id}"><div class="title">${esc(s.title)}</div>
        <div class="small muted">Updated ${fmtDate(s.updated_at)}${(s.photos ?? []).length ? ` · 📷 ${s.photos.length}` : ""}${s.min_role !== "shop" ? ` · ${ROLE_LABEL[s.min_role]}s+` : ""}</div></div>`).join("")}</div>`).join("")
      || '<div class="empty">No SOPs yet.</div>'}`;
  wireTopbar(root);
  const qEl = root.querySelector("#q");
  qEl.oninput = () => { sopQ = qEl.value; clearTimeout(qEl._t); qEl._t = setTimeout(() => renderSops(root).then(() => { const n = root.querySelector("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 250); };
  root.querySelector("#new")?.addEventListener("click", () => editSop());
  root.querySelectorAll("[data-sop]").forEach((b) => (b.onclick = () => viewSop(sops.find((s) => s.id === b.dataset.sop))));
}

// SOP photos live in a private bucket; turn stored paths into links that expire after an hour.
async function sopPhotoUrls(photos) {
  const list = (photos ?? []).map((p) => ({ ...p }));
  const paths = list.filter((p) => p.path).map((p) => p.path);
  if (paths.length) {
    const { data } = await sb.storage.from("sops").createSignedUrls(paths, 3600);
    (data ?? []).forEach((d) => { const p = list.find((x) => x.path === d.path); if (p && d.signedUrl) p.url = d.signedUrl; });
  }
  return list.filter((p) => p.url);
}

async function viewSop(s) {
  log("view_sop", "sop", s.id, { title: s.title });
  s = { ...s, photos: await sopPhotoUrls(s.photos) };
  sheet(`
    <div class="row between"><span class="badge">${esc(s.category)}</span><button class="btn sm" data-close>Close</button></div>
    <h1 style="margin-top:10px">${esc(s.title)}</h1>
    <div class="prose">${md(s.body)}</div>
    ${(s.photos ?? []).length ? `<h2 class="section">Photos &amp; diagrams</h2>
      <div class="sop-photos">${s.photos.map((p, n) => `<figure data-ph="${n}"><img src="${esc(p.url)}" alt="${esc(p.caption || s.title)}" loading="lazy">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : ""}
    ${can("admin") ? '<div class="row" style="margin-top:14px"><button class="btn" id="edit">Edit</button></div>' : ""}`,
  (root, close) => {
    root.querySelector("#edit")?.addEventListener("click", () => { close(); editSop(s); });
    root.querySelectorAll("[data-ph]").forEach((f) => (f.onclick = () => photoViewer(s.photos[Number(f.dataset.ph)], s.photos)));
  });
}

// Full-screen viewer: pinch or double-tap to zoom, drag to pan, scroll wheel on a computer.
function photoViewer(p, list = [p]) {
  let idx = Math.max(0, list.indexOf(p));
  const d = document.createElement("div");
  d.className = "viewer";
  d.innerHTML = `
    <div class="vbar"><span class="cap" id="vcap"></span><span class="row" style="gap:6px">
      ${list.length > 1 ? '<button class="btn sm" id="vprev">‹</button><button class="btn sm" id="vnext">›</button>' : ""}
      <button class="btn sm" id="vreset">Fit</button><button class="btn sm" id="vclose">Close</button></span></div>
    <div class="vstage" id="vstage"><img id="vimg" alt="" draggable="false"></div>
    <div class="vhint small">Pinch or double-tap to zoom · drag to move</div>`;
  document.body.appendChild(d);
  const stage = d.querySelector("#vstage"), img = d.querySelector("#vimg");
  let s = 1, x = 0, y = 0;
  const apply = () => (img.style.transform = `translate(${x}px, ${y}px) scale(${s})`);
  const reset = () => { s = 1; x = 0; y = 0; apply(); };
  const show = () => { const cur = list[idx]; img.src = cur.url; d.querySelector("#vcap").textContent = cur.caption ?? ""; reset(); };
  // Zoom toward a point so the spot under your fingers stays put.
  const zoomAt = (ns, cx, cy) => {
    ns = Math.min(8, Math.max(1, ns));
    const r = stage.getBoundingClientRect(), px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2;
    x = px - (px - x) * (ns / s); y = py - (py - y) * (ns / s); s = ns;
    if (s === 1) { x = 0; y = 0; }
    apply();
  };
  const pts = new Map(); let startDist = 0, startS = 1, lastTap = 0, last = null;
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; startDist = Math.hypot(a.x - b.x, a.y - b.y); startS = s; }
    if (pts.size === 1) {
      const now = Date.now();
      if (now - lastTap < 300) { zoomAt(s > 1.5 ? 1 : 3, e.clientX, e.clientY); lastTap = 0; } else lastTap = now;
      last = { x: e.clientX, y: e.clientY };
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      zoomAt(startS * Math.hypot(a.x - b.x, a.y - b.y) / startDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pts.size === 1 && last && s > 1) {
      x += e.clientX - last.x; y += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; apply();
    }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size === 1) last = { ...[...pts.values()][0] }; if (!pts.size) last = null; };
  ["pointerup", "pointercancel"].forEach((ev) => stage.addEventListener(ev, up));
  stage.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
  const close = () => { d.remove(); document.removeEventListener("keydown", key); };
  const key = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowRight" && list.length > 1) { idx = (idx + 1) % list.length; show(); } if (e.key === "ArrowLeft" && list.length > 1) { idx = (idx - 1 + list.length) % list.length; show(); } };
  document.addEventListener("keydown", key);
  d.querySelector("#vclose").onclick = close;
  d.querySelector("#vreset").onclick = reset;
  d.querySelector("#vprev")?.addEventListener("click", () => { idx = (idx - 1 + list.length) % list.length; show(); });
  d.querySelector("#vnext")?.addEventListener("click", () => { idx = (idx + 1) % list.length; show(); });
  show();
}

function editSop(s = {}) {
  sheet(`
    <form class="stack" id="f">
      <h2>${s.id ? "Edit SOP" : "New SOP"}</h2>
      <div><label>Title</label><input name="title" value="${esc(s.title)}" required></div>
      <div class="grid2">
        <div><label>Category</label><input name="category" value="${esc(s.category ?? "General")}" list="cats"></div>
        <div><label>Who can see it</label><select name="min_role">${["shop", "lead", "admin"].map((r) => `<option value="${r}" ${s.min_role === r ? "selected" : ""}>${r === "shop" ? "Everyone" : ROLE_LABEL[r] + "s and up"}</option>`).join("")}</select></div>
      </div>
      <datalist id="cats">${["Safety", "Milling", "Glue-up", "Machining", "Sanding", "Finishing", "Packing & shipping", "Orders", "Cleaning", "General"].map((c) => `<option>${c}</option>`).join("")}</datalist>
      <div><label>Procedure</label><textarea name="body" style="min-height:280px" placeholder="1. Step one&#10;2. Step two&#10;- Use **bold** for warnings">${esc(s.body)}</textarea></div>
      <div><label>Photos &amp; diagrams</label><div id="phs" class="stack"></div>
        <label class="btn sm" style="margin-top:6px;color:var(--text)">+ Add photos<input type="file" accept="image/*" multiple id="addph" style="display:none"></label></div>
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>
        ${s.id ? '<button type="button" class="btn danger" id="del">Delete</button>' : ""}</div>
    </form>`, (root, close) => {
    // Existing photos keep their storage path; new ones hold a File until Save.
    const photos = (s.photos ?? []).map((p) => ({ ...p }));
    sopPhotoUrls(photos).then((signed) => { signed.forEach((x) => { const p = photos.find((y) => y.path === x.path); if (p) p.preview = x.url; }); drawPhotos(); });
    const drawPhotos = () => {
      root.querySelector("#phs").innerHTML = photos.map((p, n) => `
        <div class="row" style="align-items:center;gap:8px">
          <img src="${esc(p.preview ?? p.url)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;background:var(--surface-2)">
          <input data-cap="${n}" value="${esc(p.caption ?? "")}" placeholder="Caption (optional)" style="flex:1">
          <button type="button" class="btn icon sm" data-up="${n}" aria-label="Move up" ${n ? "" : "disabled"}>↑</button>
          <button type="button" class="btn icon sm danger" data-rm="${n}" aria-label="Remove">×</button>
        </div>`).join("") || '<p class="small muted" style="margin:0">No photos yet.</p>';
      root.querySelectorAll("[data-cap]").forEach((el) => (el.oninput = () => (photos[Number(el.dataset.cap)].caption = el.value)));
      root.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { photos.splice(Number(b.dataset.rm), 1); drawPhotos(); }));
      root.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => { const n = Number(b.dataset.up); [photos[n - 1], photos[n]] = [photos[n], photos[n - 1]]; drawPhotos(); }));
    };
    drawPhotos();
    root.querySelector("#addph").onchange = (e) => {
      [...e.target.files].forEach((file) => photos.push({ file, preview: URL.createObjectURL(file), caption: "" }));
      e.target.value = ""; drawPhotos();
    };
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const btn = e.target.querySelector(".primary");
      for (const p of photos.filter((x) => x.file)) {
        btn.disabled = true; btn.textContent = "Uploading photos…";
        const path = `${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from("sops").upload(path, await shrinkImage(p.file, 1600), { contentType: "image/jpeg" });
        if (up.error) { btn.disabled = false; btn.textContent = "Save"; return toast("Photo upload failed: " + up.error.message); }
        p.path = path; delete p.file;
      }
      const row = { title: f.title, category: f.category || "General", min_role: f.min_role, body: f.body,
        photos: photos.map((p) => ({ path: p.path, caption: (p.caption ?? "").trim() || null })) };
      const res = s.id ? await sb.from("sops").update(row).eq("id", s.id).select().single() : await sb.from("sops").insert(row).select().single();
      if (res.error) return toast(res.error.message);
      log(s.id ? "update_sop" : "create_sop", "sop", res.data.id, { title: f.title });
      close(); renderShell();
    };
    root.querySelector("#del")?.addEventListener("click", async () => {
      if (!confirm("Delete this SOP?")) return;
      await sb.from("sops").delete().eq("id", s.id);
      log("delete_sop", "sop", s.id, { title: s.title });
      close(); renderShell();
    });
  });
}

// ---------------------------------------------------------------- Ask Claude
async function renderAsk(root) {
  const bubbles = () => state.chat.map((m) => `<div class="bubble ${m.role === "user" ? "me" : "ai"}">${esc(m.content)}</div>`).join("");
  root.innerHTML = `
    ${topbar("Ask Claude", state.chat.length ? '<button class="btn sm" id="clear">New chat</button>' : "")}
    ${state.chat.length ? "" : `<div class="card"><p style="margin-top:0">Ask about procedures, inventory, jobs or reminders. Answers come from the hub's own records.</p>
      <div class="chips" style="flex-wrap:wrap">${["What's the finish schedule for walnut?", "How much 8/4 maple do we have?", "Which jobs are due this week?"].map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`}
    <div class="chat" id="chat">${bubbles()}</div>
    <form class="composer" id="f"><input name="q" placeholder="Ask a question…" autocomplete="off" required><button class="btn primary">Ask</button></form>
    <p class="small muted" id="left"></p>`;
  wireTopbar(root);
  const form = root.querySelector("#f");
  const input = form.querySelector("input");
  root.querySelector("#clear")?.addEventListener("click", () => { state.chat = []; renderAsk(root); });
  root.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { input.value = b.dataset.s; form.requestSubmit(); }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    const history = state.chat.slice(-6);
    state.chat.push({ role: "user", content: question });
    input.value = "";
    const chat = root.querySelector("#chat");
    chat.innerHTML = bubbles() + '<div class="bubble ai muted">Thinking…</div>';
    root.querySelector(".card")?.remove();
    form.querySelector("button").disabled = true;
    const { data, error } = await sb.functions.invoke("ask", { body: { question, history } });
    form.querySelector("button").disabled = false;
    let answer;
    if (error) {
      try { answer = (await error.context.json()).error; } catch { answer = "Couldn't reach Claude. Try again in a minute."; }
      state.chat.pop();
      chat.innerHTML = bubbles() + `<div class="bubble ai">${esc(answer)}</div>`;
      return;
    }
    state.chat.push({ role: "assistant", content: data.answer });
    chat.innerHTML = bubbles();
    root.querySelector("#left").textContent = `${data.remaining} questions left today`;
    chat.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
  };
}

// ---------------------------------------------------------------- More: account, team, suppliers, activity
async function renderMore(root) {
  const sections = [
    { k: "account", label: "My account" },
    { k: "hours", label: "My hours" },
    ...(can("admin") ? [{ k: "timeclock", label: "Time clock (everyone)" }, { k: "requests", label: "Time card edit requests" }, { k: "admininfo", label: "Admin info (passwords & logins)" }, { k: "team", label: "Team & logins" }, { k: "activity", label: "Activity & usage" }] : []),
  ];
  const openReq = can("admin") ? (await sb.from("timecard_requests").select("id", { count: "exact", head: true }).eq("status", "open")).count ?? 0 : 0;
  root.innerHTML = `${topbar("More")}
    <div class="list">${sections.map((s) => `<div class="item" data-sec="${s.k}"><div class="row between"><span class="title">${s.label}</span>${s.k === "requests" && openReq ? `<span class="badge warn">${openReq} open</span>` : ""}</div></div>`).join("")}</div>
    <div id="sec" class="section"></div>`;
  wireTopbar(root);
  const sec = root.querySelector("#sec");
  const open = async (k) => {
    root.querySelectorAll("[data-sec]").forEach((el) => (el.style.borderColor = el.dataset.sec === k ? "var(--accent)" : ""));
    sec.innerHTML = '<div class="empty">Loading…</div>';
    await ({ account: renderAccount, hours: renderMyHours, timeclock: renderTimeclockAdmin, requests: renderTimecardRequests, admininfo: renderAdminInfo, suppliers: renderSuppliers, team: renderTeam, activity: renderActivity }[k])(sec);
  };
  root.querySelectorAll("[data-sec]").forEach((b) => (b.onclick = () => open(b.dataset.sec)));
  open(state.moreOpen || "account"); state.moreOpen = null;
}

async function renderAccount(root) {
  const p = state.profile;
  root.innerHTML = `<div class="card stack">
    <div><div class="title" style="font-weight:700">${esc(p.full_name || p.email)}</div>
      <div class="small muted">${esc(p.email)} · ${ROLE_LABEL[p.role]}${p.title ? " · " + esc(p.title) : ""}</div></div>
    <div class="row wrap"><button class="btn" id="pw">Change password</button><button class="btn" id="out">Sign out</button></div>
    <p class="small muted" style="margin:0">To install: on iPhone, tap Share → Add to Home Screen. On Android or desktop Chrome, use the install icon in the address bar.</p>
  </div>`;
  root.querySelector("#pw").onclick = () => renderChangePassword(false);
  root.querySelector("#out").onclick = () => sb.auth.signOut();
}

// Week starts Monday, shop time
function weekStart(offsetWeeks = 0) {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Denver" }));
  d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offsetWeeks * 7);
  return d;
}
const entryMs = (e) => (e.clock_out ? new Date(e.clock_out) : new Date()) - new Date(e.clock_in);
const sqBadge = (e) => e.square_status === "synced" ? '<span class="badge ok">Square ✓</span>' : e.square_status === "error" ? `<span class="badge bad" title="${esc(e.square_error)}">Square ✗</span>` : '<span class="badge">Not in Square yet</span>';

async function renderMyHours(root) {
  await renderMyHoursInner(root);
  const { data: reqs } = await sb.from("timecard_requests").select("*").eq("user_id", state.profile.id).order("created_at", { ascending: false }).limit(10);
  root.insertAdjacentHTML("afterbegin", `<div class="card stack" style="margin-bottom:12px">
    <div class="row between"><h2 style="margin:0">Something wrong on your time card?</h2><button class="btn sm primary" id="reqedit">Request time card edit</button></div>
    ${(reqs ?? []).length ? `<table><tr><th>Day</th><th>Request</th><th>Status</th></tr>${reqs.map((r) => `<tr><td>${fmtDate(r.work_date)}</td><td class="small">${esc(r.details)}${r.resolution_note ? `<br><span class="muted">↳ ${esc(r.resolution_note)}</span>` : ""}</td>
      <td>${r.status === "open" ? '<span class="badge warn">Waiting</span>' : r.status === "done" ? '<span class="badge ok">Fixed</span>' : '<span class="badge bad">Declined</span>'}</td></tr>`).join("")}</table>` : '<p class="small muted" style="margin:0">Forgot to clock out, wrong time, missed a punch? Send it here and Brittany will fix it in Square.</p>'}
  </div>`);
  root.querySelector("#reqedit").onclick = () => sheet(`
    <form class="stack" id="f"><h2>Request time card edit</h2>
      <div><label>Which day?</label><input type="date" name="work_date" required value="${new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" })}"></div>
      <div><label>What needs fixing?</label><textarea name="details" required placeholder="Forgot to clock out. I left at 4:30 pm." style="min-height:100px"></textarea></div>
      <div class="row"><button class="btn primary">Send request</button><button type="button" class="btn" data-close>Cancel</button></div>
    </form>`, (r, close) => {
    r.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const { error } = await sb.from("timecard_requests").insert({ user_id: state.profile.id, work_date: f.work_date, details: f.details });
      if (error) return toast(error.message);
      log("timecard_request", "timecard", null, { date: f.work_date });
      toast("Sent. Brittany will take care of it."); close(); renderMyHours(root);
    };
  });
}

async function renderTimecardRequests(root) {
  await loadProfiles();
  const { data } = await sb.from("timecard_requests").select("*").order("status").order("created_at", { ascending: false }).limit(60);
  const open = (data ?? []).filter((r) => r.status === "open"), closed = (data ?? []).filter((r) => r.status !== "open");
  const card = (r) => `<div class="item" style="cursor:default"><div class="row between"><span class="title">${esc(nameOf(r.user_id))} · ${fmtDate(r.work_date)}</span>
      ${r.status === "open" ? '<span class="badge warn">Open</span>' : r.status === "done" ? '<span class="badge ok">Done</span>' : '<span class="badge bad">Declined</span>'}</div>
    <div style="white-space:pre-wrap;margin:4px 0">${esc(r.details)}</div>
    <div class="small muted">Sent ${new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${r.resolved_by ? ` · ${r.status === "done" ? "Fixed" : "Declined"} by ${esc(nameOf(r.resolved_by))} ${new Date(r.resolved_at).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}${r.resolution_note ? ` · ${esc(r.resolution_note)}` : ""}</div>
    ${r.status === "open" ? `<div class="row" style="margin-top:8px;gap:6px"><button class="btn sm primary" data-done="${r.id}">✓ Done, fixed in Square</button><button class="btn sm" data-decline="${r.id}">Decline</button></div>` : ""}</div>`;
  root.innerHTML = `<div class="card stack"><div class="row between"><h2 style="margin:0">Time card edit requests</h2><span class="badge ${open.length ? "warn" : "ok"}">${open.length} open</span></div>
    <p class="small muted" style="margin:0">Make the change in Square Team, then tap Done. The employee sees it marked fixed.</p></div>
    <div class="list section">${open.map(card).join("") || '<div class="empty">Nothing waiting. 🎉</div>'}</div>
    ${closed.length ? `<details class="section"><summary class="small">Finished (${closed.length})</summary><div class="list" style="margin-top:8px">${closed.map(card).join("")}</div></details>` : ""}`;
  const resolve = async (id, status) => {
    const note = prompt(status === "done" ? "Note for the employee (optional):" : "Why is it declined? (they'll see this)", "");
    if (note === null) return;
    const { error } = await sb.from("timecard_requests").update({ status, resolved_by: state.profile.id, resolved_at: new Date().toISOString(), resolution_note: note.trim() || null }).eq("id", id);
    if (error) return toast(error.message);
    toast(status === "done" ? "Marked done" : "Declined"); renderTimecardRequests(root);
  };
  root.querySelectorAll("[data-done]").forEach((b) => (b.onclick = () => resolve(b.dataset.done, "done")));
  root.querySelectorAll("[data-decline]").forEach((b) => (b.onclick = () => resolve(b.dataset.decline, "declined")));
}

// Admin-only reference info: CNC logins, vendor portals, codes. Hidden from everyone else by the database.
async function renderAdminInfo(root) {
  const { data } = await sb.from("admin_info").select("*").order("category").order("title");
  const groups = {}; (data ?? []).forEach((x) => (groups[x.category] ??= []).push(x));
  root.innerHTML = `<div class="card stack"><div class="row between"><h2 style="margin:0">Admin info</h2><button class="btn sm primary" id="new">+ Add</button></div>
      <p class="small muted" style="margin:0">Only admins can see this page. Tap an entry to show it, tap a line to copy it.</p></div>
    ${Object.entries(groups).map(([cat, list]) => `<h3 class="section">${esc(cat)}</h3><div class="list">${list.map((x) => `
      <div class="item" data-ai="${x.id}"><div class="row between"><span class="title">${esc(x.title)}</span><span class="small muted">Show ▾</span></div>
        <div class="secret" style="display:none">${x.body.split("\n").map((ln) => `<div class="copyline" data-copy="${esc(ln)}">${esc(ln) || "&nbsp;"}</div>`).join("")}
          <div class="row" style="margin-top:8px"><button class="btn sm" data-edit="${x.id}">Edit</button></div></div></div>`).join("")}</div>`).join("") || '<div class="empty section">Nothing saved yet. Add CNC logins, vendor portals, Wi-Fi and alarm codes here.</div>'}`;
  const edit = (x = {}) => sheet(`
    <form class="stack" id="f"><h2>${x.id ? "Edit" : "Add admin info"}</h2>
      <div class="grid2"><div><label>Title</label><input name="title" value="${esc(x.title)}" required placeholder="CNC controller login"></div>
        <div><label>Group</label><input name="category" value="${esc(x.category ?? "General")}" list="aicats"><datalist id="aicats">${["Machines", "Vendor portals", "Shop", "Software", "General"].map((c) => `<option>${c}</option>`).join("")}</datalist></div></div>
      <div><label>Details</label><textarea name="body" style="min-height:140px;font-family:ui-monospace,monospace" placeholder="User: shop&#10;Password: …&#10;Notes">${esc(x.body)}</textarea></div>
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>${x.id ? '<button type="button" class="btn danger" id="del">Delete</button>' : ""}</div>
    </form>`, (r, close) => {
    r.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const row = { title: f.title, category: f.category || "General", body: f.body, updated_by: state.profile.id, updated_at: new Date().toISOString() };
      const res = x.id ? await sb.from("admin_info").update(row).eq("id", x.id) : await sb.from("admin_info").insert(row);
      if (res.error) return toast(res.error.message);
      close(); renderAdminInfo(root);
    };
    r.querySelector("#del")?.addEventListener("click", async () => { if (!confirm("Delete this entry?")) return; await sb.from("admin_info").delete().eq("id", x.id); close(); renderAdminInfo(root); });
  });
  root.querySelector("#new").onclick = () => edit();
  root.querySelectorAll("[data-ai]").forEach((el) => (el.onclick = (e) => {
    if (e.target.closest("[data-edit]") || e.target.closest("[data-copy]")) return;
    const box = el.querySelector(".secret"); box.style.display = box.style.display === "none" ? "" : "none";
  }));
  root.querySelectorAll("[data-copy]").forEach((el) => (el.onclick = async (e) => {
    e.stopPropagation();
    const v = el.dataset.copy.includes(":") ? el.dataset.copy.split(":").slice(1).join(":").trim() : el.dataset.copy;
    try { await navigator.clipboard.writeText(v); toast("Copied"); } catch { toast("Couldn't copy on this device"); }
  }));
  root.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); edit(data.find((x) => x.id === b.dataset.edit)); }));
}

async function renderMyHoursInner(root) {
  const since = weekStart(-1);
  const { data } = await sb.from("time_entries").select("*").eq("user_id", state.profile.id).gte("clock_in", since.toISOString()).order("clock_in", { ascending: false });
  const thisWk = weekStart(0);
  const tot = (list) => list.reduce((a, e) => a + entryMs(e), 0);
  const cur = (data ?? []).filter((e) => new Date(e.clock_in) >= thisWk), prev = (data ?? []).filter((e) => new Date(e.clock_in) < thisWk);
  root.innerHTML = `<div class="card stack">
    <div class="row between"><h2 style="margin:0">My hours</h2><span class="badge">This week ${hm(tot(cur))}</span></div>
    <p class="small muted" style="margin:0">Last week: ${hm(tot(prev))}. Payroll uses Square; if something looks wrong, tell Brittany.</p>
    <table><tr><th>Day</th><th>In</th><th>Out</th><th>Hours</th><th></th></tr>${(data ?? []).map((e) => `<tr>
      <td>${new Date(e.clock_in).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</td>
      <td>${timeOf(e.clock_in)}</td><td>${e.clock_out ? timeOf(e.clock_out) : '<span class="badge ok">On now</span>'}</td><td>${hm(entryMs(e))}</td><td>${sqBadge(e)}</td></tr>`).join("")
      || '<tr><td colspan="5" class="muted">No punches in the last two weeks.</td></tr>'}</table></div>`;
  if (!state.profile.extra_clock) return;
  const { data: x } = await sb.from("extra_time_entries").select("*").eq("user_id", state.profile.id).gte("clock_in", since.toISOString()).order("clock_in", { ascending: false });
  const xc = (x ?? []).filter((e) => new Date(e.clock_in) >= thisWk), xp = (x ?? []).filter((e) => new Date(e.clock_in) < thisWk);
  root.insertAdjacentHTML("beforeend", `<div class="card stack section">
    <div class="row between"><h2 style="margin:0">Extra hours</h2><span class="badge">This week ${hm(tot(xc))}</span></div>
    <p class="small muted" style="margin:0">Last week: ${hm(tot(xp))}. Tracked separately from your Square hours.</p>
    ${extraTable(x, false)}</div>`);
}

function extraTable(list, withName) {
  return `<table><tr>${withName ? "<th>Person</th>" : ""}<th>Day</th><th>In</th><th>Out</th><th>Hours</th><th>For</th></tr>${(list ?? []).map((e) => `<tr>
    ${withName ? `<td>${esc(nameOf(e.user_id))}</td>` : ""}<td>${new Date(e.clock_in).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</td>
    <td>${timeOf(e.clock_in)}</td><td>${e.clock_out ? timeOf(e.clock_out) : '<span class="badge ok">On now</span>'}</td><td>${hm(entryMs(e))}</td><td class="small">${esc(e.note ?? "")}</td></tr>`).join("")
    || `<tr><td colspan="${withName ? 6 : 5}" class="muted">No extra hours logged.</td></tr>`}</table>`;
}

async function renderTimeclockAdmin(root) {
  await loadProfiles();
  const since = weekStart(0);
  const [sq, { data: week }] = await Promise.all([
    fnCall("timeclock", { action: "team_status" }),
    sb.from("time_entries").select("*").gte("clock_in", since.toISOString()).order("clock_in", { ascending: false }),
  ]);
  const byUser = {};
  (week ?? []).forEach((e) => { byUser[e.user_id] = (byUser[e.user_id] ?? 0) + entryMs(e); });
  // Square is the source of truth for who's on right now (covers register punches).
  const open = sq?.ok ? sq.on.map((o) => ({ user_id: o.user_id, clock_in: o.clock_in, name: o.user_id ? nameOf(o.user_id) : "Someone without a hub login" }))
                      : ((await sb.from("time_entries").select("*").is("clock_out", null)).data ?? []);
  const issues = (week ?? []).filter((e) => e.square_status === "error");
  root.innerHTML = `
    <div class="card stack"><div class="row between"><h2 style="margin:0">On the clock now</h2><span class="badge ${open?.length ? "ok" : ""}">${open?.length ?? 0}</span></div>
      ${(open ?? []).map((e) => `<div class="row between"><span>${esc(e.name ?? nameOf(e.user_id))}</span><span class="small muted">since ${timeOf(e.clock_in)} · ${hm(entryMs(e))}</span></div>`).join("") || '<p class="small muted" style="margin:0">Nobody is clocked in.</p>'}
    </div>
    <div class="card section"><h2>This week</h2>
      <table><tr><th>Person</th><th>Hours</th></tr>${Object.entries(byUser).sort((a, b) => b[1] - a[1]).map(([id, ms]) => `<tr><td>${esc(nameOf(id))}</td><td>${hm(ms)}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">No punches yet this week.</td></tr>'}</table>
      ${issues.length ? `<p class="small error">${issues.length} punch${issues.length > 1 ? "es" : ""} didn't reach Square: ${issues.map((e) => esc(nameOf(e.user_id)) + " " + new Date(e.clock_in).toLocaleDateString([], { month: "short", day: "numeric" })).join(", ")}. Fix those in Square Team.</p>` : ""}
    </div>`;
  const { data: x } = await sb.from("extra_time_entries").select("*").gte("clock_in", weekStart(-1).toISOString()).order("clock_in", { ascending: false });
  if (!(x ?? []).length) return;
  const sum = (list) => list.reduce((a, e) => a + entryMs(e), 0);
  const thisWk = (x ?? []).filter((e) => new Date(e.clock_in) >= since), lastWk = (x ?? []).filter((e) => new Date(e.clock_in) < since);
  root.insertAdjacentHTML("beforeend", `<div class="card section stack">
    <div class="row between"><h2 style="margin:0">Extra hours (not in Square)</h2><span class="badge">This week ${hm(sum(thisWk))} · Last week ${hm(sum(lastWk))}</span></div>
    ${extraTable(x, true)}</div>`);
}

async function renderSuppliers(root) {
  const { data } = await sb.from("suppliers").select("*").order("name");
  root.innerHTML = `<div class="row between"><h2>Suppliers</h2>${can("admin") ? '<button class="btn sm primary" id="new">+ Supplier</button>' : ""}</div>
    <div class="list">${(data ?? []).map((s) => `<div class="item" data-s="${s.id}"><div class="title">${esc(s.name)}</div>
      <div class="small muted">${[s.contact_name, s.phone, s.email, s.lead_time_days ? s.lead_time_days + " day lead time" : ""].filter(Boolean).map(esc).join(" · ")}</div>
      ${s.notes ? `<div class="small">${esc(s.notes)}</div>` : ""}</div>`).join("") || '<div class="empty">No suppliers yet.</div>'}</div>`;
  const edit = (s = {}) => sheet(`
    <form class="stack" id="f"><h2>${s.id ? "Edit supplier" : "New supplier"}</h2>
      <div><label>Name</label><input name="name" value="${esc(s.name)}" required></div>
      <div class="grid2">
        <div><label>Contact</label><input name="contact_name" value="${esc(s.contact_name)}"></div>
        <div><label>Phone</label><input name="phone" value="${esc(s.phone)}"></div>
        <div><label>Email</label><input name="email" type="email" value="${esc(s.email)}"></div>
        <div><label>Lead time (days)</label><input name="lead_time_days" type="number" value="${esc(s.lead_time_days)}"></div>
      </div>
      <div><label>Website</label><input name="website" value="${esc(s.website)}"></div>
      <div><label>Notes</label><textarea name="notes" style="min-height:70px">${esc(s.notes)}</textarea></div>
      <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button></div>
    </form>`, (r, close) => {
    r.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const row = { ...f, lead_time_days: f.lead_time_days ? Number(f.lead_time_days) : null };
      Object.keys(row).forEach((k) => row[k] === "" && (row[k] = null));
      const { error } = s.id ? await sb.from("suppliers").update(row).eq("id", s.id) : await sb.from("suppliers").insert(row);
      if (error) return toast(error.message);
      close(); renderSuppliers(root);
    };
  });
  root.querySelector("#new")?.addEventListener("click", () => edit());
  if (can("admin")) root.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => edit(data.find((s) => s.id === b.dataset.s))));
}

async function adminCall(body) {
  const { data, error } = await sb.functions.invoke("admin-users", { body });
  if (error) {
    let msg = "Something went wrong";
    try { msg = (await error.context.json()).error; } catch {}
    toast(msg);
    return null;
  }
  return data;
}

async function renderTeam(root) {
  const people = await loadProfiles();
  const { data: directory } = await sb.from("staff_directory").select("*").order("full_name");
  const haveLogin = new Set(people.map((p) => (p.email || "").toLowerCase()));
  const waiting = (directory ?? []).filter((d) => !haveLogin.has((d.email || "").toLowerCase()));
  const assignable = state.profile.role === "owner" ? ["shop", "lead", "admin"] : ["shop", "lead"];
  root.innerHTML = `<div class="row between"><h2>Team & logins</h2><button class="btn sm primary" id="new">+ Person</button></div>
    <div class="list">${people.map((p) => `<div class="item" data-p="${p.id}"><div class="row between">
      <div><div class="title">${esc(p.full_name || p.email)}</div><div class="small muted">${esc(p.email)}${p.title ? " · " + esc(p.title) : ""}</div></div>
      <div class="row"><span class="badge ${p.active ? "" : "bad"}">${p.active ? ROLE_LABEL[p.role] : "Inactive"}</span></div></div></div>`).join("")}</div>
    ${waiting.length ? `<div class="row between section"><h2 style="margin:0">From Square, no login yet</h2><button class="btn sm primary" id="bulk">Create all ${waiting.length} logins</button></div>
    <div class="list">${waiting.map((d) => `<div class="item" style="cursor:default"><div class="row between">
      <div><div class="title">${esc(d.full_name)}</div><div class="small muted">${esc(d.email ?? "")}${d.title ? " · " + esc(d.title) : ""} · ${ROLE_LABEL[d.planned_role]}</div></div>
      ${assignable.includes(d.planned_role) ? `<button class="btn sm" data-d="${d.id}">Create login</button>` : ""}</div></div>`).join("")}</div>` : ""}
    <p class="small muted">Shop: jobs, inventory counts, SOPs, Ask. Lead: also adds jobs and items, sees suppliers. Admin: also edits SOPs, notes and the team, sees activity and usage.</p>`;
  const addPerson = (d = {}) => sheet(`
    <form class="stack" id="f"><h2>Add a person</h2>
      <div><label>Full name</label><input name="full_name" value="${esc(d.full_name)}" required></div>
      <div><label>Email (their login)</label><input name="email" type="email" value="${esc(d.email)}" required autocomplete="off"></div>
      <div class="grid2">
        <div><label>Job title</label><input name="title" value="${esc(d.title)}" placeholder="Finisher, CNC…"></div>
        <div><label>Role</label><select name="role">${assignable.map((r) => `<option value="${r}" ${d.planned_role === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select></div>
      </div>
      <div><label>Temporary password (8+ characters)</label><input name="password" type="text" minlength="8" required autocomplete="off"></div>
      <p class="small muted" style="margin:0">They'll be asked to choose their own password the first time they sign in.</p>
      <div class="row"><button class="btn primary">Create login</button><button type="button" class="btn" data-close>Cancel</button></div>
    </form>`, (r, close) => {
    r.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const ok = await adminCall({ action: "create", ...formData(e.target) });
      if (ok) { toast("Login created"); close(); renderTeam(root); }
    };
  });
  root.querySelector("#new").onclick = () => addPerson();
  root.querySelector("#bulk")?.addEventListener("click", async (e) => {
    if (!confirm(`Create logins for ${waiting.length} people with temporary passwords?`)) return;
    e.target.disabled = true; e.target.textContent = "Creating…";
    const res = await adminCall({ action: "create_from_directory" });
    renderTeam(root);
    if (!res) return;
    const rows = res.created.map((c) => `<tr><td>${esc(c.name)}</td><td class="small">${esc(c.email)}</td><td>${ROLE_LABEL[c.role]}</td><td><code style="font-size:1rem">${esc(c.password)}</code></td></tr>`).join("");
    sheet(`
      <div class="stack" id="slips">
        <h2>${res.created.length} logins created</h2>
        <p class="small muted" style="margin:0"><strong>Write these down or print now. They won't be shown again.</strong> Each person signs in at mtblockco.github.io/montana-block-hub with their email and temporary password, then chooses their own. Forgotten? Use Reset password on their name.</p>
        <table><tr><th>Name</th><th>Login email</th><th>Role</th><th>Temp password</th></tr>${rows}</table>
        ${res.skipped.length ? `<p class="small error" style="margin:0">Not created: ${res.skipped.map((s) => esc(s.name) + " (" + esc(s.reason) + ")").join(", ")}</p>` : ""}
        <div class="row"><button class="btn" id="print">Print</button><button class="btn primary" data-close>Done</button></div>
      </div>`, (r) => {
      r.querySelector("#print").onclick = () => {
        const w = window.open("", "_blank");
        w.document.write(`<title>Hub logins</title><style>body{font-family:sans-serif;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:10px;text-align:left}code{font-size:16px}</style>
          <h2>Montana Block Hub logins</h2><p>Sign in at <b>mtblockco.github.io/montana-block-hub</b>, then choose your own password.</p>
          <table><tr><th>Name</th><th>Email</th><th>Temp password</th></tr>${res.created.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td><code>${esc(c.password)}</code></td></tr>`).join("")}</table>`);
        w.document.close(); w.print();
      };
    });
  });
  root.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => addPerson(directory.find((d) => d.id === b.dataset.d))));
  root.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => {
    const p = people.find((x) => x.id === b.dataset.p);
    if (p.id === state.profile.id || p.role === "owner" || (state.profile.role !== "owner" && p.role === "admin")) return toast("You can't edit this account here.");
    sheet(`
      <form class="stack" id="f"><h2>${esc(p.full_name || p.email)}</h2><p class="small muted" style="margin:0">${esc(p.email)}</p>
        <div class="grid2">
          <div><label>Full name</label><input name="full_name" value="${esc(p.full_name)}"></div>
          <div><label>Job title</label><input name="title" value="${esc(p.title)}"></div>
          <div><label>Role</label><select name="role">${["pending", ...assignable].map((r) => `<option value="${r}" ${p.role === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select></div>
          <div><label>Ask Claude questions per day</label><input name="daily_ai_limit" type="number" min="0" max="200" value="${p.daily_ai_limit}"></div>
        </div>
        <label class="row" style="color:var(--text)"><input type="checkbox" name="active" style="width:auto;min-height:0" ${p.active ? "checked" : ""}> Active (uncheck to block access)</label>
        ${state.profile.role === "owner" ? `<label class="row" style="color:var(--text)"><input type="checkbox" name="can_edit_inventory" style="width:auto;min-height:0" ${p.can_edit_inventory ? "checked" : ""}> Can change inventory (updates Shopify)</label>
          <label class="row" style="color:var(--text)"><input type="checkbox" name="extra_clock" style="width:auto;min-height:0" ${p.extra_clock ? "checked" : ""}> Extra-hours clock (tracked in the app, not Square)</label>` : ""}
        <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" id="reset">Reset password</button><button type="button" class="btn" data-close>Cancel</button></div>
      </form>`, (r, close) => {
      r.querySelector("#f").onsubmit = async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        const extra = !!f.extra_clock; delete f.extra_clock;
        const ok = await adminCall({ action: "update", id: p.id, ...f, daily_ai_limit: Number(f.daily_ai_limit) });
        if (ok && state.profile.role === "owner" && extra !== !!p.extra_clock) {
          const { error } = await sb.from("profiles").update({ extra_clock: extra }).eq("id", p.id);
          if (error) return toast("Saved, but the extra-hours setting didn't: " + error.message);
        }
        if (ok) { toast("Saved"); close(); renderTeam(root); }
      };
      r.querySelector("#reset").onclick = async () => {
        const pw = prompt(`New temporary password for ${p.full_name || p.email} (8+ characters):`);
        if (!pw) return;
        const ok = await adminCall({ action: "set_password", id: p.id, password: pw });
        if (ok) toast("Password reset. They'll choose a new one at sign-in.");
      };
    });
  }));
}

async function renderActivity(root) {
  await loadProfiles();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [{ data: acts }, { data: usage }] = await Promise.all([
    sb.from("activity_log").select("*").order("created_at", { ascending: false }).limit(150),
    sb.from("ai_usage").select("user_id, question, cost_usd, created_at").gte("created_at", monthStart.toISOString()).order("created_at", { ascending: false }),
  ]);
  const total = (usage ?? []).reduce((s, u) => s + Number(u.cost_usd), 0);
  const byUser = {};
  (usage ?? []).forEach((u) => { const b = (byUser[u.user_id] ??= { n: 0, c: 0 }); b.n++; b.c += Number(u.cost_usd); });
  const label = { login: "signed in", view_sop: "viewed SOP", update_job: "updated job", create_job: "created job", delete_job: "deleted job",
    adjust_inventory: "adjusted", update_inventory: "updated item", create_inventory: "added item", delete_inventory: "deleted item",
    update_sop: "edited SOP", create_sop: "created SOP", delete_sop: "deleted SOP", password_changed: "changed password",
    clock_in: "clocked in", clock_out: "clocked out", sync_shopify: "synced Shopify inventory" };
  const describe = (a) => {
    const d = a.detail ?? {};
    if (a.action === "adjust_inventory") return `${d.name}: ${d.from} → ${d.to}`;
    if (a.action === "update_job" && d.from) return `${d.from} → ${d.to}`;
    return d.title || d.name || "";
  };
  root.innerHTML = `
    <div class="card"><div class="row between"><h2>Ask Claude this month</h2><span class="badge">$${total.toFixed(3)}</span></div>
      <table><tr><th>Person</th><th>Questions</th><th>Cost</th></tr>${Object.entries(byUser).map(([id, b]) =>
        `<tr><td>${esc(nameOf(id))}</td><td>${b.n}</td><td>$${b.c.toFixed(3)}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">No questions yet.</td></tr>'}</table>
      ${(usage ?? []).length ? `<details style="margin-top:8px"><summary class="small">Recent questions</summary><table>${(usage ?? []).slice(0, 40).map((u) =>
        `<tr><td class="small muted">${new Date(u.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td><td class="small">${esc(nameOf(u.user_id))}</td><td class="small">${esc(u.question)}</td></tr>`).join("")}</table></details>` : ""}
    </div>
    <div class="card section"><h2>Recent activity</h2>
      <table><tr><th>When</th><th>Who</th><th>What</th></tr>${(acts ?? []).map((a) => `<tr>
        <td class="small muted">${new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
        <td class="small">${esc(nameOf(a.user_id))}</td><td class="small">${esc(label[a.action] ?? a.action)} <span class="muted">${esc(describe(a))}</span></td></tr>`).join("")
        || '<tr><td colspan="3" class="muted">Nothing yet.</td></tr>'}</table></div>`;
}

boot();
