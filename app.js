import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { sayingFor } from "./sayings.js";

const LOGO = "https://mtblock.com/cdn/shop/files/MONTANA_BLOCK_CO-02.png?v=1747022409&width=600";
const logoImg = (cls) => `<img class="${cls}" src="${LOGO}" alt="Montana Block Co." onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${cls}',textContent:'MONTANA BLOCK CO.',style:'font-family:Oswald,sans-serif;font-size:1.4rem;letter-spacing:.08em;text-align:center'}))">`;
const MTNS = `<svg class="mtns" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden="true"><path d="M0 26 L0 18 L40 8 L70 16 L110 2 L150 14 L185 6 L220 15 L260 4 L300 13 L335 7 L370 15 L400 9 L400 26 Z" fill="var(--bg)"/></svg>`;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// ---------------------------------------------------------------- app colors (per phone/computer)
// "forest" adds pine-green touches; "classic" is the original all-walnut look. Default: forest.
const getTheme = () => { try { return localStorage.getItem("mb_theme") || "forest"; } catch { return "forest"; } };
const applyTheme = (t) => document.documentElement.classList.toggle("forest", t === "forest");
applyTheme(getTheme());

// ---------------------------------------------------------------- view-only logins (the guest)
// The database already refuses every change from a read-only login; this just stops the app from trying,
// so nothing looks saved when it wasn't. Activity logging stays on so Mitchell can see what the guest viewed.
const RO = () => !!state?.profile?.read_only;
const VIEW_ONLY = "This is a view-only login. Nothing can be changed.";
function enableReadOnly() {
  if (sb.__ro) return; sb.__ro = true;
  const refused = () => {
    const res = { data: null, error: { message: VIEW_ONLY }, count: 0 };
    const p = new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? (ok, bad) => Promise.resolve(res).then(ok, bad) : () => p),
      apply: () => p,
    });
    return p;
  };
  const from = sb.from.bind(sb);
  sb.from = (table) => {
    const q = from(table);
    if (table === "activity_log" || table === "ai_usage") return q;
    for (const m of ["insert", "update", "upsert", "delete"]) q[m] = () => { toast(VIEW_ONLY); return refused(); };
    return q;
  };
  const sfrom = sb.storage.from.bind(sb.storage);
  sb.storage.from = (b) => { const s = sfrom(b); for (const m of ["upload", "update", "remove", "move"]) s[m] = async () => ({ data: null, error: { message: VIEW_ONLY } }); return s; };
  document.documentElement.classList.add("readonly");
}

// ---------------------------------------------------------------- helpers
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ROLES = ["pending", "shop", "lead", "admin", "owner"];
const ROLE_LABEL = { pending: "Pending", shop: "Shop", lead: "Lead", admin: "Admin", owner: "Owner" };
const can = (min) => state.profile && ROLES.indexOf(state.profile.role) >= ROLES.indexOf(min);
const canMaterials = () => can("admin") || !!state.profile?.materials_access; // admins + Nate Lyman
const isOwner = () => state.profile?.role === "owner";
const canInv = () => state.profile && (state.profile.role === "owner" || state.profile.can_edit_inventory);
const hm = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
async function fnCall(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) { let msg = "Something went wrong"; try { msg = (await error.context.json()).error; } catch {} return { error: msg }; }
  return data;
}
const CHANNELS = ["Web", "Retail", "Commercial", "Government", "Custom"];
// Product types, used to group both Website and Wholesale inventory (same order everywhere).
const PRODUCT_TYPES = ["Butcher blocks", "Cutting boards", "Charcuterie & serving", "Knife blocks & rails", "Lazy Susans", "Coasters & small goods", "Bundles", "Board care", "Merch", "Other"];
const INV_CATS = PRODUCT_TYPES;
const WHOLESALE_CATS = PRODUCT_TYPES;
const SUPPLY_CATS = ["Abrasives", "Finish & oil", "Glue & epoxy", "Magnets", "Fasteners & hardware", "Blades & bits", "Packaging & shipping", "Engraving & branding", "PPE & safety", "Cleaning & shop", "Lumber", "Other"];
const ORDER_METHODS = ["Website", "Phone", "Email", "Sales rep", "In person"];
const fmtDate = (d) => (d ? new Date(d + (String(d).length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
const daysUntil = (d) => Math.round((new Date(d + "T12:00:00") - new Date(today() + "T12:00:00")) / 864e5);
// Website products are "Low" under 10 on hand unless an item has its own number. Supplies use their own reorder point.
const LOW_PRODUCTS = 9;
// Wholesale: keep at least 10 of each on the shelf (reorder point 9 = "under 10"); an item can have its own number.
const WHOLESALE_MIN = 10;
const wholesaleMin = (i) => (i.reorder_point == null ? WHOLESALE_MIN : Number(i.reorder_point) < 0 ? 0 : Number(i.reorder_point) + 1);
const WEBSITE_MIN = 10;
const websiteMin = (i) => (i.reorder_point == null ? WEBSITE_MIN : Number(i.reorder_point) < 0 ? 0 : Number(i.reorder_point) + 1);
// Website Stock build list is wood we make: no oils/wax/board care, merch, gift cards or bundles.
// "Random Pattern - ..." POS listings draw from wholesale stock, so they're built off the Wholesale list instead.
const NOT_WOOD_CATS = ["Board care", "Merch", "Bundles"];
const isWoodProduct = (i) => !NOT_WOOD_CATS.includes(i.category) && !/^random pattern\s*-/i.test(i.name ?? "")
  && !/\b(oil|wax|butter|conditioner|soap|hat|shirt|hoodie|sticker|gift card|apron)\b/i.test(i.name ?? "");
const isLow = (i) => {
  const rp = i.reorder_point ?? (["shopify", "product"].includes(i.source) ? LOW_PRODUCTS : i.source === "wholesale" ? WHOLESALE_MIN - 1 : null);
  return rp != null && Number(rp) >= 0 && Number(i.quantity) <= Number(rp); // reorder point -1 = don't track
};

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// Phone back button closes the top panel (sheet or photo viewer) instead of leaving the app.
// Each panel adds a history step. Closing with a button leaves that step behind; the back button skips over those.
const overlays = [];
function trackOverlay(removeFn) {
  const entry = { removeFn, open: true };
  overlays.push(entry);
  history.pushState({ overlay: true }, "");
  return () => {
    if (!entry.open) return;
    entry.open = false; removeFn();
    const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1);
  };
}
addEventListener("popstate", (e) => {
  const top = overlays.pop();
  if (top) { top.open = false; top.removeFn(); return; }
  if (e.state?.overlay) history.back(); // a panel already closed with its button: keep going back
});

function sheet(html, onMount) {
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(bg);
  const close = trackOverlay(() => bg.remove());
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
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
  lumber: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="15" width="18" height="4" rx="1"/><circle cx="19" cy="7" r=".6"/><circle cx="19" cy="12" r=".6"/><circle cx="19" cy="17" r=".6"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};

// ---------------------------------------------------------------- office mode
// Office desktops: open the app once with ?office (or office.html). That computer stays in office mode:
// no time clock, no job timers, no personal hours. It stays signed in until someone signs out.
const OFFICE = (() => {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has("office")) {
      if (q.get("office") === "0") localStorage.removeItem("mb_office"); else localStorage.setItem("mb_office", "1");
      history.replaceState(null, "", location.pathname + location.hash);
    }
    return localStorage.getItem("mb_office") === "1";
  } catch { return false; }
})();
if (OFFICE) document.documentElement.classList.add("office");

// ---------------------------------------------------------------- state & routing
const state = { session: null, profile: null, view: "home", cache: {}, chat: [] };

const VIEWS = {
  home: { label: "Home", icon: I.home, render: renderHome },
  jobs: { label: "Jobs", icon: I.jobs, render: renderJobs },
  inventory: { label: "Products", icon: I.inv, render: renderInventory },
  supplies: { label: "Supplies", icon: I.box, render: renderSupplies },
  materials: { label: "Lumber", icon: I.lumber, render: renderMaterialsView, show: () => canMaterials() },
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
  if (profile?.read_only) enableReadOnly();
  if (!profile || !profile.active || profile.role === "pending") return renderPending();
  if (profile.must_change_password) return renderChangePassword(true);
  const hash = location.hash.slice(1);
  state.view = VIEWS[hash] && (!VIEWS[hash].show || VIEWS[hash].show()) ? hash : "home";
  renderShell();
  loadLaser();
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
  const shown = () => Object.entries(VIEWS).filter(([, v]) => !v.show || v.show());
  const nav = (cls) => shown()
    .map(([k, v]) => `<button data-go="${k}" class="${state.view === k ? "active" : ""}" aria-label="${v.label}">${v.icon}<span>${v.label}</span></button>`)
    .join("");
  $app.innerHTML = `
  <div class="shell">
    <nav class="sidebar wood">${logoImg("logo")}${nav("sidebar")}<div class="spacer"></div>
      <div class="small who">${OFFICE ? "🖥 Office computer<br>" : ""}${RO() ? "👁 View only<br>" : ""}${esc(state.profile.full_name || state.profile.email)}<br>${ROLE_LABEL[state.profile.role]}</div></nav>
    <main class="main" id="view"><div class="empty">Loading…</div></main>
    ${RO() ? '<div class="robanner">👁 View only</div>' : ""}
    <nav class="tabbar">${shown().filter(([k]) => k !== "more").map(([k, v]) =>
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
  const [ann, jobs, mine, myOrd] = await Promise.all([
    sb.from("announcements").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(20),
    sb.from("jobs").select("*").neq("status", "Complete").order("due_date", { ascending: true, nullsFirst: false }),
    sb.from("job_steps").select("job_id, name, assignees").contains("assignees", [state.profile.id]),
    OFFICE ? { data: [] } : sb.from("order_assignments").select("*").contains("assignees", [state.profile.id]),
  ]);
  tagMySteps(jobs.data, mine.data);
  const myOrders = myOrd.data ?? [];
  await loadProfiles();
  const first = (state.profile.full_name || "").split(" ")[0];
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/Denver", hour: "numeric", hour12: false }));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const myJobs = OFFICE ? (jobs.data ?? []).filter((j) => j.status === "Active") : (jobs.data ?? []).filter((j) => isMyJob(j));
  const dueSoon = (jobs.data ?? []).filter((j) => j.due_date && daysUntil(j.due_date) <= 7);

  root.innerHTML = `
    <section class="hero wood">
      ${can("admin") ? '<div class="hero-actions"><button class="btn sm acct" id="addAnn" style="position:static">+ Note</button></div>' : ""}
      <button class="btn icon sm acct" data-go-more aria-label="Account">${I.more.replace("<svg", '<svg width="20" height="20"')}</button>
      ${logoImg("logo")}
      <div class="greet">${greet}${first && !OFFICE ? ", " + esc(first) : ""}</div>
      <div class="rule"></div>
      <p class="saying">${esc(sayingFor())}</p>
      ${MTNS}
    </section>
    ${OFFICE || RO() ? "" : `<div class="card accent clock" id="clock"><div class="muted small">Loading time clock…</div></div>
    <div id="mytimer" class="section"></div>`}
    <div id="todos" class="section"></div>
    <div id="msgs" class="section"></div>
    <div id="reqalert"></div>
    ${state.profile.extra_clock && !OFFICE ? '<div class="card clock section" id="xclock"><div class="muted small">Loading extra hours…</div></div>' : ""}
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
      <div class="card"><div class="row between"><h2>${OFFICE ? "Active jobs" : "My jobs"}</h2><span class="badge" id="myjobcount">${myJobs.length + myOrders.length}</span></div>
        <div id="myorders">${orderRows(myOrders)}</div>
        ${jobRows(myJobs) || (myOrders.length ? "" : `<p class="muted small" id="nomine">${OFFICE ? "No active jobs." : "Nothing assigned to you."}</p>`)}</div>
      <div class="card"><div class="row between"><h2>Due this week</h2><span class="badge ${dueSoon.some((j) => daysUntil(j.due_date) < 0) ? "bad" : ""}">${dueSoon.length}</span></div>
        ${jobRows(dueSoon) || '<p class="muted small">Nothing due in the next 7 days.</p>'}</div>
    </div>`;
  wireTopbar(root);
  if (!OFFICE && !RO()) renderClock(root.querySelector("#clock"));
  renderTodos(root.querySelector("#todos"));
  renderMessages(root.querySelector("#msgs"));
  if (state.profile.extra_clock && !OFFICE) renderExtraClock(root.querySelector("#xclock"));
  root.querySelector("#addAnn")?.addEventListener("click", () => editAnnouncement());
  root.querySelectorAll("[data-edit-ann]").forEach((b) => (b.onclick = () => editAnnouncement((ann.data ?? []).find((a) => a.id === b.dataset.editAnn))));
  root.querySelectorAll("[data-job]").forEach((b) => (b.onclick = () => viewJob((jobs.data ?? []).find((j) => j.id === b.dataset.job), () => renderShell())));
  if (!OFFICE && !RO()) renderMyTimer(root.querySelector("#mytimer"), () => renderShell());
  if (myOrders.length) fillMyOrders(root, myOrders, myJobs.length);
  if (can("admin")) sb.from("timecard_requests").select("id", { count: "exact", head: true }).eq("status", "open").then(({ count }) => {
    const el = root.querySelector("#reqalert"); if (!el || !count) return;
    el.innerHTML = `<div class="card section row between" style="cursor:pointer" id="goreq"><span>🕑 <strong>${count}</strong> time card edit request${count > 1 ? "s" : ""} waiting</span><span class="badge warn">Review</span></div>`;
    el.querySelector("#goreq").onclick = () => { state.moreOpen = "requests"; go("more"); };
  });
  if (can("admin")) sb.from("time_off_requests").select("id", { count: "exact", head: true }).eq("status", "pending").then(({ count }) => {
    const el = root.querySelector("#reqalert"); if (!el || !count) return;
    el.insertAdjacentHTML("beforeend", `<div class="card section row between" style="cursor:pointer" id="gooff"><span>🌴 <strong>${count}</strong> time off request${count > 1 ? "s" : ""} waiting</span><span class="badge warn">Review</span></div>`);
    el.querySelector("#gooff").onclick = () => { state.moreOpen = "timeclock"; go("more"); };
  });
}

// ---------------------------------------------------------------- To-dos (Home)
// Notes and to-dos left for each other. Only the writer and the person it's for can see it; "Everyone" shows to the whole team.
let todoShowDone = false;
async function renderTodos(el) {
  if (!el) return;
  await loadProfiles();
  const me = state.profile.id;
  const { data } = await sb.from("todos").select("*").order("done_at", { ascending: true, nullsFirst: true }).order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(200);
  const all = data ?? [];
  const open = all.filter((t) => !t.done_at);
  const forMe = open.filter((t) => t.assigned_to === me || t.for_everyone || (!t.assigned_to && t.created_by === me));
  const fromMe = open.filter((t) => t.created_by === me && t.assigned_to && t.assigned_to !== me);
  const done = all.filter((t) => t.done_at).sort((a, b) => new Date(b.done_at) - new Date(a.done_at)).slice(0, 10);
  const who = (id) => (nameOf(id) || "someone").split(" ")[0];
  const due = (t) => t.due_date ? ` <span class="badge ${daysUntil(t.due_date) < 0 ? "bad" : daysUntil(t.due_date) <= 1 ? "warn" : ""}">${daysUntil(t.due_date) === 0 ? "Today" : daysUntil(t.due_date) === 1 ? "Tomorrow" : fmtDate(t.due_date)}</span>` : "";
  const row = (t, mine) => `<div class="todo ${t.done_at ? "done" : ""}" data-todo="${t.id}">
    <button class="todo-chk" data-chk="${t.id}" aria-label="${t.done_at ? "Mark not done" : "Mark done"}">${t.done_at ? "✓" : ""}</button>
    <div class="todo-body"><div class="todo-title">${esc(t.title)}${t.done_at ? "" : due(t)}</div>
      ${t.note ? `<div class="small" style="white-space:pre-wrap">${esc(t.note)}</div>` : ""}
      <div class="small muted">${t.done_at ? `Done by ${esc(who(t.done_by))} ${new Date(t.done_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : mine ? `For ${t.for_everyone ? "everyone" : esc(who(t.assigned_to))}` : t.created_by === me ? (t.for_everyone ? "For everyone · from you" : "Note to self") : `From ${esc(who(t.created_by))}${t.for_everyone ? " · for everyone" : ""}`}</div></div></div>`;
  el.innerHTML = `<div class="card todos">
    <div class="row between"><h2 style="margin:0">📝 To-Do</h2>${RO() ? "" : '<button class="btn sm primary" id="addtodo">+ Add</button>'}</div>
    ${forMe.length ? `<div class="todo-list">${forMe.map((t) => row(t, false)).join("")}</div>` : '<p class="small muted" style="margin:8px 0 0">Nothing on your list. 👍</p>'}
    ${fromMe.length ? `<details class="todo-sub"><summary class="small">You asked others · ${fromMe.length} open</summary><div class="todo-list">${fromMe.map((t) => row(t, true)).join("")}</div></details>` : ""}
    ${done.length ? `<details class="todo-sub" ${todoShowDone ? "open" : ""}><summary class="small">Recently done · ${done.length}</summary><div class="todo-list">${done.map((t) => row(t, t.created_by === me && t.assigned_to && t.assigned_to !== me)).join("")}</div></details>` : ""}
  </div>`;
  el.querySelector("#addtodo")?.addEventListener("click", () => editTodo({}, () => renderTodos(el)));
  el.querySelectorAll("[data-chk]").forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const t = all.find((x) => x.id === b.dataset.chk);
    const patch = t.done_at ? { done_at: null, done_by: null } : { done_at: new Date().toISOString(), done_by: me };
    b.closest(".todo").classList.toggle("done", !t.done_at);
    const { error } = await sb.from("todos").update(patch).eq("id", t.id);
    if (error) return toast(error.message);
    if (!t.done_at) log("todo_done", "todo", t.id, { title: t.title });
    setTimeout(() => renderTodos(el), 350);
  }));
  el.querySelectorAll("[data-todo]").forEach((d) => (d.onclick = () => {
    const t = all.find((x) => x.id === d.dataset.todo);
    if (RO()) return;
    editTodo(t, () => renderTodos(el));
  }));
  el.querySelectorAll("details.todo-sub").forEach((d) => d.addEventListener("toggle", () => { if (/Recently/.test(d.querySelector("summary").textContent)) todoShowDone = d.open; }));
}
function editTodo(t, done) {
  const me = state.profile.id;
  const people = (state.cache.profiles ?? []).filter((p) => p.active && p.role !== "pending" && !/guest/i.test(p.full_name ?? ""));
  const canEdit = !t.id || t.created_by === me || can("admin");
  const brit = people.find((p) => /^brittany/i.test(p.full_name ?? ""));
  const sel = t.id ? (t.for_everyone ? "everyone" : t.assigned_to ?? me) : (me !== brit?.id && brit ? brit.id : me);
  sheet(`<form class="stack" id="tf">
    <h2 style="margin:0">${t.id ? "To-do" : "New to-do or note"}</h2>
    <div><label>What needs doing</label><input name="title" value="${esc(t.title)}" required ${canEdit ? "" : "readonly"} placeholder="e.g. Call Uline about the box order"></div>
    <div><label>Note (optional)</label><textarea name="note" style="min-height:70px" ${canEdit ? "" : "readonly"}>${esc(t.note)}</textarea></div>
    <div class="grid2">
      <div><label>For</label><select name="for" ${canEdit ? "" : "disabled"}>
        ${people.map((p) => `<option value="${p.id}" ${sel === p.id ? "selected" : ""}>${p.id === me ? "Me" : esc(p.full_name)}</option>`).join("")}
        <option value="everyone" ${sel === "everyone" ? "selected" : ""}>Everyone</option></select></div>
      <div><label>Due (optional)</label><input name="due_date" type="date" value="${esc(t.due_date)}" ${canEdit ? "" : "readonly"}></div>
    </div>
    ${t.id ? `<p class="small muted" style="margin:0">From ${esc(nameOf(t.created_by) || "someone")} · ${new Date(t.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>` : ""}
    <div class="row wrap">${canEdit ? '<button class="btn primary">Save</button>' : ""}<button type="button" class="btn" data-close>${canEdit ? "Cancel" : "Close"}</button>
      ${t.id && (t.created_by === me || can("admin")) ? '<button type="button" class="btn danger" id="deltodo">Delete</button>' : ""}</div>
  </form>`, (root, close) => {
    root.querySelector('[name="title"]').focus();
    root.querySelector("#tf").onsubmit = async (e) => {
      e.preventDefault();
      if (!canEdit) return close();
      const f = formData(e.target);
      const row = { title: f.title.trim(), note: f.note?.trim() || null, due_date: f.due_date || null,
        for_everyone: f.for === "everyone", assigned_to: f.for === "everyone" ? null : f.for };
      const { error } = t.id ? await sb.from("todos").update(row).eq("id", t.id) : await sb.from("todos").insert({ ...row, created_by: me });
      if (error) return toast(error.message);
      if (!t.id) log("todo_add", "todo", null, { title: row.title, for: row.for_everyone ? "everyone" : nameOf(row.assigned_to) });
      toast(t.id ? "Saved" : row.assigned_to && row.assigned_to !== me ? `Added for ${nameOf(row.assigned_to).split(" ")[0]}` : "Added"); close(); done?.();
    };
    root.querySelector("#deltodo")?.addEventListener("click", async () => {
      if (!confirm("Delete this to-do?")) return;
      const { error } = await sb.from("todos").delete().eq("id", t.id);
      if (error) return toast(error.message);
      close(); done?.();
    });
  });
}

// ---------------------------------------------------------------- Messages (Home)
// Mitchell & Brittany (admin+) message the guys. Each employee has one thread with the office; both admins see every thread.
const isGuy = (p) => p.active && (p.role === "shop" || p.role === "lead") && !/guest/i.test(p.full_name ?? "");
const msgTime = (d) => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
let msgPoll = null;
async function renderMessages(el) {
  if (!el || RO()) return;
  await loadProfiles();
  const office = can("admin"), me = state.profile.id;
  const { data } = await sb.from("messages").select("*").order("created_at", { ascending: false }).limit(500);
  const all = data ?? [];
  const unreadFor = (m) => office ? (!m.read_by_office_at && m.sender_id === m.employee_id) : (!m.read_by_employee_at && m.sender_id !== me);
  if (office) {
    const guys = (state.cache.profiles ?? []).filter(isGuy);
    const threads = guys.map((p) => { const ms = all.filter((m) => m.employee_id === p.id); return { p, last: ms[0], unread: ms.filter(unreadFor).length }; })
      .sort((a, b) => (b.unread - a.unread) || (new Date(b.last?.created_at ?? 0) - new Date(a.last?.created_at ?? 0)));
    const active = threads.filter((t) => t.last);
    const unread = active.reduce((s, t) => s + t.unread, 0);
    el.innerHTML = `<div class="card">
      <div class="row between"><h2 style="margin:0">💬 Messages ${unread ? `<span class="badge warn">${unread} new</span>` : ""}</h2><button class="btn sm primary" id="newmsg">+ Message</button></div>
      ${active.length ? `<div class="list" style="margin-top:8px">${active.slice(0, 8).map((t) => `<div class="item" data-thread="${t.p.id}"><div class="row between"><span class="title">${esc(t.p.full_name)}</span>${t.unread ? `<span class="badge warn">${t.unread}</span>` : `<span class="small muted">${msgTime(t.last.created_at)}</span>`}</div>
        <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.last.sender_id === t.p.id ? "" : "You: "}${esc(t.last.body)}</div></div>`).join("")}</div>` : '<p class="small muted" style="margin:8px 0 0">No messages yet. Tap + Message to ask the guys something.</p>'}
    </div>`;
    el.querySelector("#newmsg").onclick = () => newMessage(guys, () => renderMessages(el));
    el.querySelectorAll("[data-thread]").forEach((d) => (d.onclick = () => openThread(d.dataset.thread, () => renderMessages(el))));
  } else {
    const unread = all.filter(unreadFor).length, last = all[0];
    el.innerHTML = `<div class="card" id="mythread" style="cursor:pointer">
      <div class="row between"><h2 style="margin:0">💬 Messages ${unread ? `<span class="badge warn">${unread} new</span>` : ""}</h2><span class="small muted">Mitchell &amp; Brittany</span></div>
      <div class="small ${unread ? "" : "muted"}" style="margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${last ? `${last.sender_id === me ? "You" : esc((nameOf(last.sender_id) || "Office").split(" ")[0])}: ${esc(last.body)}` : "No messages yet. Tap to send one."}</div>
    </div>`;
    el.querySelector("#mythread").onclick = () => openThread(me, () => renderMessages(el));
  }
  clearInterval(msgPoll);
  msgPoll = setInterval(() => { if (!document.body.contains(el)) return clearInterval(msgPoll); if (!document.querySelector(".sheet-bg") && !document.hidden) renderMessages(el); }, 60000);
}
function openThread(empId, done) {
  const office = can("admin"), me = state.profile.id;
  const title = office ? nameOf(empId) : "Mitchell & Brittany";
  let timer = null, lastCount = -1;
  const close = sheet(`<div class="stack" style="min-height:60vh">
    <div class="row between"><h2 style="margin:0">${esc(title)}</h2><button class="btn sm" data-close>Close</button></div>
    <div class="chat" id="thr" style="max-height:55vh;overflow:auto;padding:4px 2px"><p class="small muted">Loading…</p></div>
    <form class="row" id="sendf" style="gap:8px"><textarea name="body" rows="2" placeholder="Type a message…" style="flex:1;min-height:44px" required></textarea><button class="btn primary">Send</button></form>
  </div>`, (root) => {
    const thr = root.querySelector("#thr");
    const load = async () => {
      const { data } = await sb.from("messages").select("*").eq("employee_id", empId).order("created_at", { ascending: true }).limit(300);
      const ms = data ?? [];
      if (ms.length !== lastCount) {
        lastCount = ms.length;
        thr.innerHTML = ms.length ? ms.map((m) => {
          const mine = office ? m.sender_id !== empId : m.sender_id === me;
          const who = mine ? (m.sender_id === me ? "" : (nameOf(m.sender_id) || "").split(" ")[0]) : (nameOf(m.sender_id) || "").split(" ")[0];
          return `<div class="bubble ${mine ? "me" : "ai"}">${esc(m.body)}<div class="small" style="opacity:.7;margin-top:4px">${who ? esc(who) + " · " : ""}${msgTime(m.created_at)}${mine && (office ? m.read_by_employee_at : m.read_by_office_at) ? " · Seen" : ""}</div></div>`;
        }).join("") : '<p class="small muted">No messages yet.</p>';
        thr.scrollTop = thr.scrollHeight;
      }
      const now = new Date().toISOString();
      if (office) { if (ms.some((m) => m.sender_id === empId && !m.read_by_office_at)) await sb.from("messages").update({ read_by_office_at: now }).eq("employee_id", empId).eq("sender_id", empId).is("read_by_office_at", null); }
      else if (ms.some((m) => m.sender_id !== me && !m.read_by_employee_at)) await sb.from("messages").update({ read_by_employee_at: now }).eq("employee_id", empId).neq("sender_id", me).is("read_by_employee_at", null);
    };
    load(); timer = setInterval(load, 15000);
    const watch = setInterval(() => { if (!document.body.contains(root)) { clearInterval(watch); clearInterval(timer); done?.(); } }, 400);
    const ta = root.querySelector("textarea");
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) { e.preventDefault(); root.querySelector("#sendf").requestSubmit(); } });
    root.querySelector("#sendf").onsubmit = async (e) => {
      e.preventDefault();
      const body = ta.value.trim(); if (!body) return;
      ta.value = ""; const b = e.target.querySelector("button"); b.disabled = true;
      const { error } = await sb.from("messages").insert({ employee_id: empId, sender_id: me, body });
      b.disabled = false;
      if (error) { ta.value = body; return toast(error.message); }
      lastCount = -1; load();
    };
  });
  return close;
}
function newMessage(guys, done) {
  sheet(`<form class="stack" id="nmf">
    <h2 style="margin:0">New message</h2>
    <div><label>To</label>
      <label class="row" style="color:var(--text);font-weight:600"><input type="checkbox" id="allg" style="width:auto;min-height:0"> Everyone</label>
      <div class="stack" style="gap:4px;margin-top:4px">${guys.map((p) => `<label class="row" style="color:var(--text);font-weight:400"><input type="checkbox" name="to" value="${p.id}" style="width:auto;min-height:0"> ${esc(p.full_name)}</label>`).join("")}</div></div>
    <div><label>Message</label><textarea name="body" required style="min-height:90px" placeholder="e.g. How many 16&quot; rails are glued up?"></textarea></div>
    <p class="small muted" style="margin:0">Each person gets it in their own thread with you and Brittany, so their answers stay private.</p>
    <div class="row"><button class="btn primary">Send</button><button type="button" class="btn" data-close>Cancel</button></div>
  </form>`, (root, close) => {
    const boxes = [...root.querySelectorAll('[name="to"]')];
    root.querySelector("#allg").onchange = (e) => boxes.forEach((b) => (b.checked = e.target.checked));
    root.querySelector("#nmf").onsubmit = async (e) => {
      e.preventDefault();
      const to = boxes.filter((b) => b.checked).map((b) => b.value);
      const body = root.querySelector('[name="body"]').value.trim();
      if (!to.length) return toast("Pick who it's for");
      if (!body) return;
      const { error } = await sb.from("messages").insert(to.map((id) => ({ employee_id: id, sender_id: state.profile.id, body })));
      if (error) return toast(error.message);
      log("message_send", "message", null, { to: to.length });
      toast(to.length > 1 ? `Sent to ${to.length} people` : `Sent to ${nameOf(to[0]).split(" ")[0]}`); close(); done?.();
    };
  });
}

// ---------------------------------------------------------------- Laser run timer
// The person engraving starts a run on a laser program; the app counts down and alarms when the laser should be done.
// "Reloaded" logs the run (pieces + real cycle time) and starts the next one. Every run builds the data per program.
const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const parseMmss = (v) => { const p = String(v).trim().split(":").map(Number); if (p.some(isNaN)) return NaN; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 60; };
let laserTimer = null, laserAudio = null, laserBeep = null, wakeLock = null;

// One laser, one shared timer. Everyone sees it and anyone can tap Reloaded / Done / Stop, whoever started it.
async function loadLaser() {
  if (!state.profile) return;
  if (!state.cache.profiles) await loadProfiles();
  const { data } = await sb.from("laser_runs").select("*, laser_programs(*), jobs(title), job_steps(name)")
    .eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle();
  const prev = state.laser;
  if (!data) { if (prev) { state.laser = null; laserLoop(); } }
  else if (!prev || prev.run.id !== data.id) { state.laser = { run: data, alarmed: false }; laserLoop(); }
  if (!loadLaser.poll) {
    loadLaser.poll = setInterval(() => document.visibilityState !== "hidden" && loadLaser(), 15000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { loadLaser(); if (state.laser) keepAwake(); } });
  }
}
const loadLaserOthers = loadLaser; // older callers

// Desktop (Chrome / Edge / Opera): a small always-on-top window with the live laser countdown that stays up
// even when the hub is minimized or another program is in front. Phones use the lock-screen notification instead.
const canPopOut = () => "documentPictureInPicture" in window;
let pipWin = null, pipTimer = null;
async function popOutLaser() {
  if (!canPopOut()) return toast("Pop-out works in Chrome, Edge or Opera on a computer.");
  try {
    if (!pipWin || pipWin.closed) {
      pipWin = await documentPictureInPicture.requestWindow({ width: 320, height: 130 });
      pipWin.document.head.innerHTML = `<style>
        body{margin:0;font-family:Oswald,"Arial Narrow",Arial,sans-serif;background:#15100c;color:#f3e9dc;padding:10px}
        .r{background:#261811;border-radius:12px;padding:8px 12px}.r.done{background:#b3261e;animation:p 1s infinite}
        .n{font-family:Inter,Arial,sans-serif;font-size:13px;opacity:.9}.t{font-size:38px;font-variant-numeric:tabular-nums;line-height:1.1}
        .e{font-family:Inter,Arial,sans-serif;font-size:13px;opacity:.7;padding:20px;text-align:center}@keyframes p{50%{opacity:.75}}</style>`;
      pipWin.addEventListener("pagehide", () => { clearInterval(pipTimer); pipWin = null; });
    }
    clearInterval(pipTimer);
    const draw = () => {
      if (!pipWin || pipWin.closed) return clearInterval(pipTimer);
      const r = state.laser?.run;
      if (!r) { pipWin.document.body.innerHTML = '<div class="e">Laser is idle.</div>'; pipWin.document.title = "Laser idle"; return; }
      const left = r.planned_seconds - (Date.now() - new Date(r.started_at)) / 1000;
      pipWin.document.body.innerHTML = `<div class="r ${left <= 0 ? "done" : ""}"><div class="n">🔦 ${esc(r.laser_programs?.name ?? "Laser")}${r.jobs?.title ? " · " + esc(r.jobs.title) : ""}</div>
        <div class="t">${left > 0 ? mmss(left) : "DONE +" + mmss(-left)}</div></div>`;
      pipWin.document.title = left > 0 ? mmss(left) + " · laser" : "LASER DONE";
    };
    draw(); pipTimer = setInterval(draw, 1000);
  } catch (e) { toast("Couldn't pop out the timer: " + (e.message ?? e)); }
}

function laserLoop() {
  clearInterval(laserTimer);
  document.getElementById("laserothers")?.remove();
  let bar = document.getElementById("laserbar");
  if (!state.laser) { bar?.remove(); stopAlarm(); releaseWake(); return; }
  if (!bar) { bar = document.createElement("div"); bar.id = "laserbar"; document.body.appendChild(bar); }
  const r = state.laser.run, p = r.laser_programs ?? {};
  const who = r.user_id === state.profile.id ? "Your run" : `${esc((nameOf(r.user_id) || "Someone").split(" ")[0])}'s run`;
  bar.innerHTML = `<div class="lb-top"><span class="small">🔦 <strong>${who}</strong> · ${esc(p.name ?? "Laser")}${r.jobs?.title ? ` · ${esc(r.jobs.title)}` : ""}</span><span class="lb-time" id="lbtime"></span></div>
    <div class="lb-actions"><button class="btn sm primary" id="lbreload">🔁 Reloaded – next run</button><button class="btn sm" id="lbdone">✓ Done</button><button class="btn sm" id="lbstop" title="Stop without counting this run">✕ Stop</button>${canPopOut() ? '<button class="btn sm" id="lbpop" title="Pop the timer out into its own window">⧉ Pop out</button>' : ""}</div>`;
  bar.querySelector("#lbpop")?.addEventListener("click", popOutLaser);
  bar.querySelector("#lbreload").onclick = () => laserFinish(true);
  bar.querySelector("#lbdone").onclick = () => laserFinish(false);
  bar.querySelector("#lbstop").onclick = laserStop;
  if (!OFFICE) keepAwake();
  const tick = () => {
    if (!state.laser) return;
    const left = r.planned_seconds - (Date.now() - new Date(r.started_at)) / 1000;
    const t = document.getElementById("lbtime");
    if (t) t.textContent = left > 0 ? mmss(left) : `DONE +${mmss(-left)}`;
    bar.classList.toggle("alarm", left <= 0);
    if (left <= 0 && !state.laser.alarmed) { state.laser.alarmed = true; if (!OFFICE) startAlarm(p.name); }
  };
  tick(); laserTimer = setInterval(tick, 1000);
}

function startAlarm(name) {
  try {
    laserAudio ??= new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => { const o = laserAudio.createOscillator(), g = laserAudio.createGain(); o.type = "square"; o.frequency.value = 880; g.gain.value = 0.25;
      o.connect(g).connect(laserAudio.destination); o.start(); o.stop(laserAudio.currentTime + 0.35);
      setTimeout(() => { const o2 = laserAudio.createOscillator(); o2.type = "square"; o2.frequency.value = 1175; o2.connect(g); o2.start(); o2.stop(laserAudio.currentTime + 0.35); }, 450); };
    beep(); laserBeep = setInterval(beep, 2500);
  } catch {}
  navigator.vibrate?.([400, 200, 400, 200, 800]);
  try {
    if ("Notification" in window && Notification.permission === "granted")
      navigator.serviceWorker?.ready.then((reg) => reg.showNotification("Laser run done", { body: `${name ?? "Laser"}: reload the machine`, tag: "laser", renotify: true, requireInteraction: true }));
  } catch {}
}
function stopAlarm() { clearInterval(laserBeep); laserBeep = null; navigator.vibrate?.(0); }
async function keepAwake() { try { if (!wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener?.("release", () => (wakeLock = null)); } } catch {} }
function releaseWake() { try { wakeLock?.release(); } catch {} wakeLock = null; }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.laser) keepAwake(); });

// Push alerts reach the phone even when it's locked. Needs permission once; on iPhone the app must be on the Home Screen.
const VAPID_PUBLIC = "BMEYszqU5K3_1AiH6hmRHYgGHl6lAdLPGl7Jh9BTBmvsHSgdr8oIi3pEf4qtIv4maGRGMU-SImCJX42U6Wd9IMw";
async function enablePush() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
    const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (perm !== "granted") return "denied";
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const raw = atob(VAPID_PUBLIC.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (VAPID_PUBLIC.length % 4)) % 4));
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    }
    const k = sub.toJSON().keys;
    const { error } = await sb.from("push_subscriptions").upsert({ endpoint: sub.endpoint, user_id: state.profile.id, p256dh: k.p256dh, auth: k.auth });
    if (error) { enablePush.lastError = "save: " + error.message; return "error"; }
    return "ok";
  } catch (e) { console.error(e); enablePush.lastError = (e?.name ? e.name + ": " : "") + (e?.message ?? String(e)); return "error"; }
}
const pushHelp = (r) => r === "unsupported"
  ? (/iPhone|iPad/.test(navigator.userAgent) ? "To get laser alerts on a locked iPhone, add the app to the Home Screen (Share → Add to Home Screen) and open it from there." : "This browser can't do lock-screen alerts.")
  : r === "denied" ? "Notifications are blocked for this app. Turn them on in the phone's settings to get alerts on a locked phone." : r === "error" ? `Couldn't turn on alerts on this browser${enablePush.lastError ? ` (${enablePush.lastError})` : ""}. Chrome, Edge or Safari (iPhone home-screen app) work best.` : "";

async function laserStartRun(program, j, step) {
  if (canPopOut() && matchMedia("(min-width: 900px)").matches) popOutLaser();
  laserAudio ??= (() => { try { return new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } })(); // unlock sound on this tap
  try { laserAudio?.resume?.(); } catch {}
  enablePush().then((r) => { if (r !== "ok") toast(pushHelp(r)); });
  const { data, error } = await sb.from("laser_runs").insert({ program_id: program.id, job_id: j?.id ?? null, step_id: step?.id ?? null, planned_seconds: program.run_seconds })
    .select("*, laser_programs(*), jobs(title), job_steps(name)").single();
  if (error) { loadLaser(); toast(/one_laser_run|duplicate/i.test(error.message) ? "The laser is already running. Use the timer bar at the bottom." : error.message); return false; }
  state.laser = { run: data, alarmed: false };
  stopAlarm(); laserLoop();
  return true;
}
async function laserFinish(next) {
  const L = state.laser; if (!L) return;
  stopAlarm();
  const r = L.run, ppr = r.laser_programs?.pieces_per_run ?? 0;
  const { data: upd, error } = await sb.from("laser_runs").update({ status: "done", ended_at: new Date().toISOString(), pieces: ppr }).eq("id", r.id).eq("status", "running").select("id");
  if (error) return toast(error.message);
  state.laser = null; laserLoop();
  if (!upd?.length) { loadLaser(); return toast("Someone else already ended that run."); }
  if (next) { if (await laserStartRun(r.laser_programs, { id: r.job_id }, { id: r.step_id })) toast("Next run started"); return; }
  // Done: offer to count every finished run on this step that hasn't been added yet (whoever ran them).
  if (!r.step_id) return;
  const { data: runs } = await sb.from("laser_runs").select("id, pieces").eq("step_id", r.step_id).eq("status", "done").eq("counted", false);
  const total = (runs ?? []).reduce((a, x) => a + Number(x.pieces ?? 0), 0);
  if (total > 0 && confirm(`${total} pieces engraved (${runs.length} run${runs.length > 1 ? "s" : ""}). Add them to the ${r.job_steps?.name ?? "Engrave"} step on ${r.jobs?.title ?? "the job"}?`)) {
    const { data: st } = await sb.from("job_steps").select("done_qty").eq("id", r.step_id).single();
    if (st) await sb.from("job_steps").update({ done_qty: Number(st.done_qty) + total }).eq("id", r.step_id);
    toast(`Added ${total} pieces`);
  }
  if ((runs ?? []).length) await sb.from("laser_runs").update({ counted: true }).in("id", runs.map((x) => x.id));
}
async function laserStop() {
  const L = state.laser; if (!L) return;
  if (!confirm("Stop this laser run without counting it?")) return;
  stopAlarm();
  await sb.from("laser_runs").update({ status: "stopped", ended_at: new Date().toISOString() }).eq("id", L.run.id).eq("status", "running");
  log("stop_laser_run", "laser_run", L.run.id);
  state.laser = null; laserLoop();
}

async function laserSheet(j, step, after) {
  await loadLaser();
  const [{ data: programs }, { data: stats }] = await Promise.all([
    sb.from("laser_programs").select("*").eq("active", true).order("name"),
    sb.from("laser_program_stats").select("*"),
  ]);
  const stat = Object.fromEntries((stats ?? []).map((x) => [x.program_id, x]));
  const prod = (j.product || j.title || "").toLowerCase();
  const list = (programs ?? []).sort((a, b) => Number((b.product ?? "").toLowerCase() === prod) - Number((a.product ?? "").toLowerCase() === prod));
  const last = (() => { try { return localStorage.getItem("mb_laser_prog_" + j.id); } catch { return null; } })();
  sheet(`<div class="stack">
    <div class="row between"><h2 style="margin:0">🔦 Laser timer</h2><button class="btn sm" data-close>Close</button></div>
    <p class="small muted" style="margin:0">${esc(j.title)} · ${esc(step?.name ?? "Engrave")}</p>
    ${state.laser ? `<div class="card" style="padding:10px">🔦 The laser is running <strong>${esc(state.laser.run.laser_programs?.name ?? "a program")}</strong>. Use the timer bar at the bottom: anyone can tap Reloaded, Done or Stop. One run at a time.</div>` : ""}
    ${list.length ? `<div><label>Laser program</label><select id="lp">${list.map((p) => `<option value="${p.id}" ${p.id === last ? "selected" : ""}>${esc(p.name)}${p.product ? " · " + esc(p.product) : ""}</option>`).join("")}</select></div>
      <div class="card" id="lpinfo" style="padding:10px"></div>
      <div class="row wrap"><button class="btn primary" id="lpstart" ${state.laser ? "disabled" : ""}>▶ Start run</button><button class="btn" id="lpedit">✎ Edit program</button><button class="btn" id="lpnew">+ New program</button></div>`
    : `<p class="muted">No laser programs yet. Add the first one: how long a run takes and how many pieces it does.</p><button class="btn primary" id="lpnew">+ New program</button>`}
    <p class="small muted" style="margin:0">When the run time is up, everyone who turned on notifications gets an alert, even on a locked phone, repeating every 1½ minutes until you tap <strong>Reloaded</strong> or <strong>Done</strong>. Your phone also beeps if the app is open.</p>
  </div>`, (root, close) => {
    const sel = root.querySelector("#lp");
    const cur = () => list.find((p) => p.id === sel?.value);
    const info = () => {
      const p = cur(); if (!p) return; const st = stat[p.id];
      root.querySelector("#lpinfo").innerHTML = `<div><strong>${mmss(p.run_seconds)}</strong> per run · <strong>${p.pieces_per_run}</strong> piece${p.pieces_per_run > 1 ? "s" : ""} per run</div>
        <div class="small muted">${mmss(p.run_seconds / p.pieces_per_run)} per piece on the laser${st?.runs ? ` · ${st.runs} runs logged, ${st.pieces} pcs${st.avg_cycle_seconds ? ` · real cycle incl. reload ${mmss(st.avg_cycle_seconds)} (${Math.round(3600 / st.avg_cycle_seconds * p.pieces_per_run)} pcs/hr)` : ""}` : " · no runs logged yet"}</div>
        ${p.notes ? `<div class="small" style="margin-top:4px;white-space:pre-wrap">${esc(p.notes)}</div>` : ""}`;
    };
    if (sel) { sel.onchange = info; info(); }
    root.querySelector("#lpstart")?.addEventListener("click", async () => {
      const p = cur(); if (!p) return;
      try { localStorage.setItem("mb_laser_prog_" + j.id, p.id); } catch {}
      close(); if (await laserStartRun(p, j, step)) toast("Laser run started");
    });
    root.querySelector("#lpedit")?.addEventListener("click", () => { close(); laserProgramForm(cur(), j, () => laserSheet(j, step, after)); });
    root.querySelector("#lpnew")?.addEventListener("click", () => { close(); laserProgramForm({}, j, () => laserSheet(j, step, after)); });
  });
}

function laserProgramForm(p = {}, j, done) {
  sheet(`<form class="stack" id="lpf">
    <h2 style="margin:0">${p.id ? "Edit laser program" : "New laser program"}</h2>
    <div><label>Program name</label><input name="name" value="${esc(p.name ?? "")}" required placeholder="MKC logo – 12x18 board"></div>
    <div><label>Product (optional)</label><input name="product" value="${esc(p.product ?? j?.product ?? "")}"></div>
    <div class="grid2">
      <div><label>Run time (min:sec)</label><input name="run" value="${p.run_seconds ? mmss(p.run_seconds) : ""}" required placeholder="12:30" inputmode="numeric"></div>
      <div><label>Pieces per run</label><input name="ppr" type="number" min="1" step="1" inputmode="numeric" value="${p.pieces_per_run ?? 1}" required></div>
    </div>
    <div><label>Notes (settings, fixture, file name)</label><textarea name="notes" style="min-height:60px">${esc(p.notes ?? "")}</textarea></div>
    <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>
      ${p.id && can("admin") ? '<button type="button" class="btn danger" id="lpdel">Retire</button>' : ""}</div>
  </form>`, (root, close) => {
    root.querySelector("#lpf").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target), secs = parseMmss(f.run);
      if (!(secs > 0)) return toast("Enter the run time like 12:30");
      const row = { name: f.name, product: f.product || null, run_seconds: secs, pieces_per_run: Math.max(1, Math.round(Number(f.ppr))), notes: f.notes || null, updated_at: new Date().toISOString() };
      const res = p.id ? await sb.from("laser_programs").update(row).eq("id", p.id) : await sb.from("laser_programs").insert(row);
      if (res.error) return toast(res.error.message);
      log(p.id ? "update_laser_program" : "create_laser_program", "laser_program", p.id ?? null, row);
      close(); done?.();
    };
    root.querySelector("#lpdel")?.addEventListener("click", async () => {
      if (!confirm("Retire this program? Its run history stays.")) return;
      await sb.from("laser_programs").update({ active: false }).eq("id", p.id); close(); done?.();
    });
  });
}

let clockTimer = null;
async function renderClock(el, preset) {
  const res = preset ?? await fnCall("timeclock", { action: "status" });
  if (res.error) { el.innerHTML = `<div class="small error">${esc(res.error)}</div>`; return; }
  const open = res.open, brk = open ? res.break : null;
  if (res.note && !preset) toast(res.note);
  clearInterval(clockTimer);
  el.classList.toggle("on", !!open && !brk);
  el.classList.toggle("onbreak", !!brk);
  const BRK = { lunch: { label: "Lunch", min: 30 }, quick: { label: "Quick break", min: 5 } };
  // Break countdown: time left, then how far over.
  const brkLeft = () => {
    const ms = BRK[brk.kind].min * 60000 - (Date.now() - new Date(brk.start_at));
    const m = Math.ceil(Math.abs(ms) / 60000);
    return ms >= 0 ? `${m} min left` : `${m} min over`;
  };
  el.innerHTML = `
    <div>
      <div class="state"><span class="dot"></span>${brk ? `On ${BRK[brk.kind].label.toLowerCase()}` : open ? "On the clock" : "Off the clock"}</div>
      ${brk ? `<div class="timer" id="tmr">${brkLeft()}</div><div class="small muted">${BRK[brk.kind].label} started ${timeOf(brk.start_at)}${brk.kind === "lunch" ? " · unpaid" : " · paid"}</div>`
        : open ? `<div class="timer" id="tmr">${hm(Date.now() - new Date(open.clock_in))}</div><div class="small muted">since ${timeOf(open.clock_in)}</div>`
        : `<div class="small muted">${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>`}
    </div>
    <div class="clock-actions">
      ${brk ? '<button class="btn punch in" id="brkend">End break</button>'
        : `<button class="btn punch ${open ? "out" : "in"}" id="punch">${open ? "Clock out" : "Clock in"}</button>
           ${open ? '<div class="row" style="gap:6px;margin-top:6px"><button class="btn sm" data-brk="lunch">🍔 Lunch (30)</button><button class="btn sm" data-brk="quick">☕ Break (5)</button></div>' : ""}`}
    </div>`;
  if (open) clockTimer = setInterval(() => {
    const t = document.getElementById("tmr"); if (!t) return clearInterval(clockTimer);
    t.textContent = brk ? brkLeft() : hm(Date.now() - new Date(open.clock_in));
  }, brk ? 15000 : 30000);
  el.querySelector("#punch")?.addEventListener("click", async (e) => {
    if (open && !confirm(`Clock out now? You've been on ${hm(Date.now() - new Date(open.clock_in))}.`)) return;
    e.target.disabled = true; e.target.textContent = open ? "Clocking out…" : "Clocking in…";
    const r = await fnCall("timeclock", { action: open ? "clock_out" : "clock_in" });
    if (r.error) { toast(r.error); return renderClock(el); }
    toast(r.note || (open ? "Clocked out. Have a good one!" : "Clocked in. Let's build something."));
    renderClock(el, { open: r.open });
  });
  el.querySelectorAll("[data-brk]").forEach((b) => (b.onclick = async () => {
    const kind = b.dataset.brk;
    el.querySelectorAll("button").forEach((x) => (x.disabled = true));
    const r = await fnCall("timeclock", { action: "break_start", kind });
    if (r.error) { toast(r.error); return renderClock(el); }
    toast(r.note || (kind === "lunch" ? "Enjoy lunch. 30 minutes, see you back." : "Quick break. Back in 5."));
    renderClock(el, { open: r.open, break: r.break });
  }));
  el.querySelector("#brkend")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Ending…";
    const r = await fnCall("timeclock", { action: "break_end" });
    if (r.error) { toast(r.error); return renderClock(el); }
    toast(r.note || "Welcome back. You're on the clock.");
    renderClock(el, { open: r.open, break: null });
  });
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
    sb.from("job_steps").select("id, job_id, name, position, done_qty, assignees").order("position"),
    loadProfiles(),
  ]);
  state.cache.jobs = jobs ?? [];
  state.cache.jobMoney = {};
  if (seesMoney()) ((await sb.from("job_financials").select("*")).data ?? []).forEach((f) => (state.cache.jobMoney[f.job_id] = f));
  const byJob = {};
  (steps ?? []).forEach((st) => (byJob[st.job_id] ??= []).push(st));
  tagMySteps(jobs, steps);
  // Billed jobs (archived) leave the Jobs tab but stay in the database for stats and records.
  const billedJobs = (jobs ?? []).filter((j) => j.archived_at);
  const live = (jobs ?? []).filter((j) => !j.archived_at);
  const list = live.filter((j) => (jobFilter === "Complete" ? j.status === "Complete" : j.status !== "Complete"));
  if (jobFilter === "Complete") list.sort((a, b) => new Date(b.completed_at ?? b.updated_at) - new Date(a.completed_at ?? a.updated_at));
  else list.sort((a, b) => Number(isMyJob(b)) - Number(isMyJob(a))); // your jobs on top (sort is stable, so due-date order stays)
  const counts = { Active: live.filter((j) => j.status !== "Complete").length, Complete: live.filter((j) => j.status === "Complete").length };
  if (jobFilter === "Materials") jobFilter = "Active";
  const tabs = ["Active", "Complete", "Shopify", "Wholesale"]; // shop employees only see orders assigned to them
  if (!tabs.includes(jobFilter)) jobFilter = "Active";
  const chips = `<div class="chips">${tabs.map((f) => `<button class="chip ${f === jobFilter ? "active" : ""}" data-f="${f}">${f.toUpperCase()}${counts[f] != null ? ` <span class="small">${counts[f]}</span>` : ""}</button>`).join("")}</div>`;
  if (jobFilter === "Shopify" || jobFilter === "Wholesale") return renderOpenOrders(root, chips, jobFilter === "Wholesale");
  root.innerHTML = `
    ${topbar("Jobs", can("lead") && jobFilter === "Active" ? '<button class="btn sm primary" id="new">+ Job</button>' : "")}
    ${chips}
    <div id="mytimer" style="margin-top:12px"></div>
    ${jobFilter === "Complete" && seesMoney() && list.length ? '<p class="small muted" style="margin:10px 0 0">Once a job is billed, tick <strong>Billed</strong> to clear it off the Jobs tab. Its record is kept.</p>' : ""}
    <div class="list" style="margin-top:12px">${list.map((j) => jobCard(j, byJob[j.id] ?? [])).join("") || `<div class="empty">${jobFilter === "Active" ? "No active jobs. Tap + Job to add one." : "Nothing completed and waiting to bill."}</div>`}</div>
    ${jobFilter === "Complete" && seesMoney() && billedJobs.length ? `<details class="section"><summary class="small muted" style="cursor:pointer">Billed &amp; cleared (${billedJobs.length})</summary>
      <div class="list" style="margin-top:6px">${billedJobs.sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at)).map((j) => `<div class="item row between" style="cursor:default">
        <span><span class="title">${esc(j.title)}</span><div class="small muted">${j.shipped_qty ?? j.quantity} sent${j.completed_at ? ` · done ${fmtDate(String(j.completed_at).slice(0, 10))}` : ""} · billed ${fmtDate(String(j.archived_at).slice(0, 10))}</div></span>
        <button class="btn sm" data-unbill="${j.id}">Put back</button></div>`).join("")}</div></details>` : ""}`;
  wireTopbar(root);
  renderMyTimer(root.querySelector("#mytimer"), () => renderJobs(root));
  root.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { jobFilter = b.dataset.f; renderJobs(root); }));
  root.querySelector("#new")?.addEventListener("click", () => editJob({}, () => renderJobs(root)));
  root.querySelectorAll("[data-job]").forEach((b) => (b.onclick = (e) => { if (e.target.closest("[data-billed]")) return; viewJob(jobs.find((j) => j.id === b.dataset.job), () => renderJobs(root)); }));
  root.querySelectorAll("[data-billed]").forEach((cb) => (cb.onclick = async (e) => {
    e.stopPropagation();
    const j = jobs.find((x) => x.id === cb.dataset.billed);
    if (!confirm(`${j.title}: billed? This clears it off the Jobs tab. The record is kept.`)) { e.preventDefault(); return; }
    const now = new Date().toISOString();
    const { error } = await sb.from("jobs").update({ archived_at: now, archived_by: state.profile.id }).eq("id", j.id);
    if (error) return toast(error.message);
    if (!state.cache.jobMoney?.[j.id]?.billed_at) await sb.from("job_financials").upsert({ job_id: j.id, billed_at: now.slice(0, 10), updated_at: now });
    log("bill_job", "job", j.id, { title: j.title, sent: j.shipped_qty });
    toast(`${j.title} billed and cleared`); renderJobs(root);
  }));
  root.querySelectorAll("[data-unbill]").forEach((b) => (b.onclick = async () => {
    const { error } = await sb.from("jobs").update({ archived_at: null, archived_by: null }).eq("id", b.dataset.unbill);
    if (error) return toast(error.message);
    toast("Put back in Complete"); renderJobs(root);
  }));
  if (can("lead")) root.querySelectorAll(".item.hold[data-job]").forEach((el) => onHold(el, () => assignJob(jobs.find((j) => j.id === el.dataset.job), () => renderJobs(root))));
}

// Leads and up: assign one process (step) on a job to specific people. Blank = anyone.
function assignStep(j, st, done) {
  const people = (state.cache.profiles ?? []).filter((p) => p.active && p.role !== "pending" && !/shipping room|office|guest/i.test(p.full_name ?? ""));
  const on = new Set(st.assignees ?? []);
  sheet(`<form class="stack" id="sa">
    <h2 style="margin:0">${esc(st.name)}</h2>
    <p class="small muted" style="margin:0">${esc(j.title)} · who does this step? Leave everyone unchecked for "anyone".</p>
    <div class="list">${people.map((p) => `<label class="item row between" style="cursor:pointer"><span class="title">${esc(p.full_name || p.email)}</span>
      <input type="checkbox" name="p_${p.id}" ${on.has(p.id) ? "checked" : ""} style="width:22px;height:22px"></label>`).join("")}</div>
    <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button></div>
  </form>`, (root, close) => {
    root.querySelector("#sa").onsubmit = async (e) => {
      e.preventDefault();
      const ids = people.filter((p) => root.querySelector(`[name="p_${p.id}"]`).checked).map((p) => p.id);
      const { error } = await sb.from("job_steps").update({ assignees: ids }).eq("id", st.id);
      if (error) return toast(error.message);
      log("assign_step", "job", j.id, { step: st.name, people: ids.map(nameOf) });
      toast(ids.length ? `${st.name}: ${ids.map(nameOf).join(", ")}` : `${st.name}: anyone`); close(); done?.();
    };
  });
}

// Leads and up: press and hold a job to assign people. Assigned jobs show up as "Yours" for them and on their Home screen.
function assignJob(j, done) {
  const people = (state.cache.profiles ?? []).filter((p) => p.active && p.role !== "pending" && !/shipping room|office|guest/i.test(p.full_name ?? ""));
  const on = new Set(jobPeople(j));
  sheet(`<form class="stack" id="as">
    <h2 style="margin:0">Assign: ${esc(j.title)}</h2>
    <p class="small muted" style="margin:0">Pick everyone working this job. It shows up as theirs in the app.</p>
    <div class="list">${people.map((p) => `<label class="item row between" style="cursor:pointer"><span class="title">${esc(p.full_name || p.email)}</span>
      <input type="checkbox" name="p_${p.id}" ${on.has(p.id) ? "checked" : ""} style="width:22px;height:22px"></label>`).join("")}</div>
    <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button></div>
  </form>`, (root, close) => {
    root.querySelector("#as").onsubmit = async (e) => {
      e.preventDefault();
      const ids = people.filter((p) => root.querySelector(`[name="p_${p.id}"]`).checked).map((p) => p.id);
      // Keep the lead if still picked; otherwise the first person picked becomes the lead.
      const lead = ids.includes(j.assigned_to) ? j.assigned_to : ids[0] ?? null;
      const { error } = await sb.from("jobs").update({ assignees: ids, assigned_to: lead }).eq("id", j.id);
      if (error) return toast(error.message);
      log("assign_job", "job", j.id, { title: j.title, people: ids.map(nameOf) });
      toast(ids.length ? `Assigned to ${ids.map(nameOf).join(", ")}` : "Unassigned"); close(); done?.();
    };
  });
}

// ---------------------------------------------------------------- Open Shopify orders vs inventory
// SHOPIFY = website orders not shipped yet; WHOLESALE = wholesale orders not shipped yet.
// Each tab adds up what's ordered, compares it to what's on the shelf, and shows what to build.
const normName = (s) => String(s ?? "").toLowerCase().replace(/^wholesale\s*[-–]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
async function loadOpenOrders(force) {
  const c = state.cache.openOrders;
  if (!force && c && Date.now() - c.at < 120000) return c;
  const [res, { data: inv }, { data: asg }] = await Promise.all([
    fnCall("shopify-inventory", { action: "open_orders" }),
    sb.from("inventory_items").select("id, name, quantity, source, shopify_variant_id, reorder_point, category, on_website").in("source", ["shopify", "wholesale", "product"]),
    sb.from("order_assignments").select("*"),
  ]);
  const assign = Object.fromEntries((asg ?? []).map((a) => [a.shopify_order_id, a]));
  const { data: hubPhotos } = await sb.from("order_photos").select("*").order("created_at");
  (res?.orders ?? []).forEach((o) => (o.hubPhotos = (hubPhotos ?? []).filter((p) => p.shopify_order_id === o.id)));
  const out = { at: Date.now(), error: res?.error ?? null, orders: res?.orders ?? [], inv: inv ?? [], assign };
  if (!out.error) state.cache.openOrders = out;
  return out;
}
function matchStock(line, inv, wholesale) {
  const byVariant = line.variant_id && inv.find((i) => i.source === "shopify" && i.shopify_variant_id === line.variant_id);
  const n = normName(line.title + (line.variant ? " " + line.variant : "")), t = normName(line.title);
  const byName = (src) => inv.filter((i) => i.source === src).find((i) => normName(i.name) === n || normName(i.name) === t)
    ?? inv.filter((i) => i.source === src).find((i) => t.length > 3 && (normName(i.name).includes(t) || t.includes(normName(i.name))));
  if (wholesale) return byName("wholesale") ?? null; // wholesale = random-pattern stock only; never mixed with website stock
  return byVariant ?? byName("shopify") ?? null;
}
async function renderOpenOrders(root, chips, wholesale, force) {
  root.innerHTML = `${topbar("Jobs", '<button class="btn sm" id="refresh">Refresh</button>')}${chips}<div class="empty" style="margin-top:12px">Loading open orders from Shopify…</div>`;
  wireTopbar(root);
  const wire = () => {
    root.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { jobFilter = b.dataset.f; renderJobs(root); }));
    root.querySelector("#refresh")?.addEventListener("click", () => renderOpenOrders(root, chips, wholesale, true));
  };
  wire();
  const { error, orders, inv, assign } = await loadOpenOrders(force);
  if (error) {
    root.innerHTML = `${topbar("Jobs", '<button class="btn sm" id="refresh">Refresh</button>')}${chips}
      <div class="card" style="margin-top:12px"><strong>Can't read Shopify orders yet.</strong>
      <p class="small muted" style="margin:6px 0 0">${/access denied/i.test(error) ? "The hub's Shopify app needs permission to read orders. Mitchell is switching it on." : esc(error)}</p></div>`;
    wireTopbar(root); return wire();
  }
  const isMine = (o) => (assign[o.id]?.assignees ?? []).includes(state.profile.id);
  const list = orders.filter((o) => !!o.wholesale === wholesale).sort((a, b) => Number(isMine(b)) - Number(isMine(a)));
  // Orders build list: what's ordered, compared to stock. Wholesale also restocks to 10 (see below).
  const need = {};
  list.forEach((o) => o.lines.forEach((l) => {
    const item = matchStock(l, inv, wholesale);
    const key = item?.id ?? "x:" + normName(l.title + " " + (l.variant ?? ""));
    const name = item?.name ?? (l.variant ? `${l.title} – ${l.variant}` : l.title);
    (need[key] ??= { name, ordered: 0, stock: item ? Number(item.quantity) : null, orders: new Set(), min: wholesale && item?.source === "wholesale" ? wholesaleMin(item) : 0 });
    need[key].ordered += Number(l.qty); need[key].orders.add(o.name);
    l._stock = item ? Number(item.quantity) : null;
  }));
  // Wholesale keeps 10 of each on the shelf: restock items under 10 even with no open orders.
  if (wholesale) inv.filter((i) => i.source === "wholesale" && wholesaleMin(i) > 0 && !need[i.id] && Number(i.quantity) < wholesaleMin(i))
    .forEach((i) => (need[i.id] = { name: i.name, ordered: 0, stock: Number(i.quantity), orders: new Set(), min: wholesaleMin(i) }));
  const sortRows = (rs) => rs.sort((a, b) => (b.short ?? -1) - (a.short ?? -1) || b.ordered - a.ordered || a.name.localeCompare(b.name));
  const orderRows = sortRows(Object.values(need).map((r) => ({ ...r, short: r.stock == null ? null : Math.max(0, r.ordered + (r.min ?? 0) - Math.max(0, r.stock)) })));
  // Website stock: every website product kept at 10 (Shopify's "available" count already has unshipped orders taken out).
  const stockRows = wholesale ? [] : sortRows(inv.filter((i) => i.source === "shopify" && i.on_website === true && isWoodProduct(i) && websiteMin(i) > 0 && Number(i.quantity) < websiteMin(i))
    .map((i) => ({ name: i.name, ordered: 0, stock: Number(i.quantity), orders: new Set(), min: websiteMin(i), short: websiteMin(i) - Math.max(0, Number(i.quantity)) })));
  const lists = wholesale
    ? [{ key: "wh", title: "Wholesale", rows: orderRows, orders: list, cols: "orders",
        desc: `Open wholesale orders <strong>plus</strong> getting each wholesale item back to ${WHOLESALE_MIN} on the shelf.`, empty: "Nothing to build. Every wholesale item is at 10 or more and no orders are waiting. 🎉" }]
    : [{ key: "so", title: "Shopify Orders", rows: orderRows, orders: list, cols: "orders",
        desc: "Only what's on open website orders, compared to what's on the shelf.", empty: "No open website orders. 🎉" },
       { key: "ws", title: "Website Stock", rows: stockRows, orders: [], cols: "stock",
        desc: `Website products under ${WEBSITE_MIN} available. Build gets each one back to ${WEBSITE_MIN}. Only what's for sale on mtblock.com: wood products, no oils, wax or merch, no orders. Random pattern pieces are on the Wholesale list.`, empty: `Every website product has ${WEBSITE_MIN} or more. 🎉` }];
  const buildCard = (L) => {
    const tb = L.rows.filter((r) => r.short > 0), n = tb.reduce((a, r) => a + r.short, 0);
    const head = L.cols === "stock" ? "<th>Product</th><th>On hand</th><th>Keep</th><th>Build</th>" : "<th>Product</th><th>Ordered</th><th>On hand</th><th>Build</th>";
    return `<details class="grp buildlist" style="margin-top:12px"><summary><span class="grp-arrow" aria-hidden="true">▶</span><span class="grp-name">🔨 ${L.title}</span>
      <span class="grp-meta">${n ? `${n} to build` : "✓ nothing"}${L.cols === "orders" ? ` · ${L.orders.length} order${L.orders.length === 1 ? "" : "s"}` : ""}</span>
      <button class="btn sm" data-print="${L.key}" aria-label="Print ${L.title} build list" style="margin-left:6px">🖨</button></summary>
      <div style="padding:0 12px 12px">
      <p class="small muted" style="margin:4px 0 8px">${L.desc}</p>
      ${L.rows.length ? `<table><tr>${head}</tr>${L.rows.map((r, i) => `<tr>
        <td>${esc(r.name)}<div class="small muted">${[...r.orders].join(", ") || (r.min && L.cols === "orders" ? `Restock to ${r.min}` : "")}</div></td>
        ${L.cols === "stock" ? `<td>${Math.max(0, r.stock)}</td><td>${r.min}</td>` : `<td>${r.ordered}</td><td>${r.stock == null ? '<span class="small muted">not tracked</span>' : r.stock}</td>`}
        <td>${r.short == null ? "?" : r.short > 0 ? `<span class="badge bad">${r.short}</span>${can("lead") ? ` <button class="linkbtn" data-build="${L.key}:${i}">+ Job</button>` : ""}` : '<span class="badge ok">✓</span>'}</td></tr>`).join("")}</table>`
        : `<p class="small muted" style="margin:0">${L.empty}</p>`}
      ${tb.length ? `<p class="small" style="margin:8px 0 0"><strong>${n} pieces to build</strong> across ${tb.length} product${tb.length === 1 ? "" : "s"}.</p>` : ""}
    </div></details>`;
  };
  const age = (d) => Math.floor((Date.now() - new Date(d)) / 864e5);
  root.innerHTML = `
    ${topbar("Jobs", '<button class="btn sm" id="refresh">Refresh</button>')}
    ${chips}
    ${lists.map(buildCard).join("")}
    <h3 class="section" style="margin-bottom:4px">Open ${wholesale ? "wholesale" : "website"} orders</h3>
    <div class="list">${list.map((o) => {
      const d = age(o.created_at);
      const a = assign[o.id], who = (a?.assignees ?? []).map(nameOf).filter(Boolean);
      return `<div class="item" data-order="${esc(o.id)}">
        <div class="row between"><span class="title">${isMine(o) ? '<span class="badge ok">Yours</span> ' : ""}${esc(o.name)} · ${esc(o.customer || "")}</span>
          <span class="badge ${d >= 10 ? "bad" : d >= 5 ? "warn" : ""}">${d === 0 ? "Today" : d + "d old"}</span></div>
        <div class="row between small" style="margin-top:2px"><span class="${who.length ? "assignees" : "muted"}">👤 ${who.length ? who.map(esc).join(", ") : "Not assigned"}</span>${a && a.status !== "Not started" ? `<span class="badge ${a.status === "Ready to ship" ? "ok" : "warn"}">${esc(a.status)}</span>` : ""}</div>
        <div class="small muted">${fmtDate(o.created_at.slice(0, 10))}${o.status === "PARTIALLY_FULFILLED" ? " · partly shipped" : ""}${o.pickup ? " · Local pickup" : ""}${orderPhotoCount(o) ? ` · 📷 ${orderPhotoCount(o)}` : ""}${(o.tags ?? []).filter((t) => !/wholesale/i.test(t)).map((t) => ` <span class="badge ${/hold/i.test(t) ? "warn" : ""}">${esc(t)}</span>`).join("")}</div>
        ${o.lines.map((l) => `<div class="row between small" style="margin-top:4px"><span>${l.qty} × ${esc(l.title)}${l.variant ? ` <span class="muted">(${esc(l.variant)})</span>` : ""}</span>
          <span class="muted">${l._stock == null ? "" : l._stock >= l.qty ? "✓ on shelf" : `${Math.max(0, l._stock)} on shelf`}</span></div>`).join("")}
        ${o.note ? `<div class="small muted" style="margin-top:4px;white-space:pre-wrap">📝 ${esc(o.note)}</div>` : ""}
      </div>`;
    }).join("") || `<div class="empty">${can("lead") ? "Nothing waiting to ship." : "No orders assigned to you right now."}</div>`}</div>`;
  wireTopbar(root); wire();
  const reload = () => { state.cache.openOrders = null; renderOpenOrders(root, chips, wholesale, true); };
  root.querySelectorAll("[data-order]").forEach((el) => (el.onclick = () => viewOrder(list.find((o) => o.id === el.dataset.order), assign[el.dataset.order], wholesale, reload)));
  const L = (k) => lists.find((x) => x.key === k);
  root.querySelectorAll("[data-print]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const x = L(b.dataset.print); printBuildList(x, assign); }));
  root.querySelectorAll("[data-build]").forEach((b) => (b.onclick = () => {
    const [k, i] = b.dataset.build.split(":"), r = L(k).rows[Number(i)];
    editJob({ title: `${wholesale ? "Wholesale" : k === "ws" ? "Web stock" : "Web"} – ${r.name}`, product: r.name, quantity: r.short,
      customer: [...r.orders].join(", ") || (wholesale ? "Wholesale stock" : k === "ws" ? "Website stock" : "Website orders"), channel: wholesale ? "Retail" : "Web" }, () => { jobFilter = "Active"; renderJobs(root); });
  }));
}

// Printable build list: big, black-on-white, a checkbox per line, then each open order (no prices).
function printBuildList(L, assign) {
  const { rows, orders } = L, stock = L.cols === "stock";
  const kind = L.title;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const build = rows.filter((r) => r.short > 0), other = rows.filter((r) => !(r.short > 0));
  const total = build.reduce((a, r) => a + r.short, 0);
  const row = (r) => `<tr><td class="box">☐</td><td><b>${esc(r.name)}</b><div class="sub">${[...r.orders].join(", ")}${r.min ? `${r.orders.size ? " · " : ""}Keep ${r.min}` : ""}</div></td>
    ${stock ? "" : `<td class="n">${r.ordered}</td>`}<td class="n">${r.stock == null ? "—" : Math.max(0, r.stock)}</td><td class="n big">${r.short == null ? "?" : r.short > 0 ? r.short : "✓"}</td></tr>`;
  const thead = `<tr><th></th><th>Product</th>${stock ? "" : '<th class="n">Ordered</th>'}<th class="n">On hand</th><th class="n">Build</th></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${kind} Build List – ${today}</title><style>
    @page { margin: 0.5in; }
    body { font: 13pt/1.35 -apple-system, "Segoe UI", Arial, sans-serif; color: #000; background: #fff; margin: 0; }
    h1 { font-size: 22pt; margin: 0; } .meta { color: #444; margin: 2px 0 14px; }
    .tot { font-size: 15pt; border: 2px solid #000; padding: 8px 12px; display: inline-block; margin-bottom: 14px; }
    h2 { font-size: 15pt; margin: 18px 0 6px; border-bottom: 2px solid #000; padding-bottom: 3px; }
    table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #999; padding: 7px 6px; text-align: left; vertical-align: top; }
    th { font-size: 10pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 2px solid #000; }
    td.n, th.n { text-align: center; width: 70px; } td.big { font-size: 17pt; font-weight: 800; } td.box { width: 26px; font-size: 18pt; line-height: 1; }
    .sub { font-size: 10pt; color: #555; } tr { break-inside: avoid; }
    .order { border: 1px solid #000; padding: 8px 10px; margin: 0 0 8px; break-inside: avoid; }
    .order b { font-size: 13pt; } .order ul { margin: 4px 0 0 18px; padding: 0; } .note { font-size: 10.5pt; margin-top: 4px; font-style: italic; }
    .orders { columns: 2; column-gap: 14px; } .pb { break-before: page; }
  </style></head><body>
    <h1>🔨 ${kind} Build List</h1><div class="meta">${today}${stock ? "" : ` · ${orders.length} open order${orders.length === 1 ? "" : "s"}`} · Montana Block Co.</div>
    <div class="meta">${L.desc.replace(/<[^>]+>/g, "")}</div>
    ${build.length ? `<div class="tot"><b>${total} pieces to build</b> across ${build.length} product${build.length === 1 ? "" : "s"}</div>` : other.some((r) => r.short == null) ? '<div class="tot">No known shortages — check the shelf for the items marked "?"</div>' : '<div class="tot">Nothing to build.</div>'}
    ${build.length ? `<h2>To build</h2><table>${thead}${build.map(row).join("")}</table>` : ""}
    ${other.length ? `<h2>Already on the shelf / not tracked</h2><table>${thead}${other.map(row).join("")}</table>` : ""}
    ${orders.length ? `<h2 class="pb">Open orders</h2><div class="orders">${orders.map((o) => {
      const who = (assign[o.id]?.assignees ?? []).map(nameOf).filter(Boolean);
      return `<div class="order">☐ <b>${esc(o.name)}</b> · ${esc(o.customer || "")}<div class="sub">${fmtDate(o.created_at.slice(0, 10))}${o.pickup ? " · Local pickup" : o.shipping ? " · " + esc(o.shipping) : ""}${who.length ? " · 👤 " + who.map(esc).join(", ") : ""}${assign[o.id]?.status && assign[o.id].status !== "Not started" ? " · " + esc(assign[o.id].status) : ""}</div>
        <ul>${o.lines.map((l) => `<li>${l.qty} × ${esc(l.title)}${l.variant ? ` (${esc(l.variant)})` : ""}</li>`).join("")}</ul>${o.note ? `<div class="note">Note: ${esc(o.note)}</div>` : ""}</div>`;
    }).join("")}</div>` : ""}
  </body></html>`;
  // Print through a hidden frame so it works from the installed app on phones and computers.
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast("Couldn't open printing on this device."); } setTimeout(() => f.remove(), 60000); }, 300);
  log("print_build_list", "order", null, { kind, products: rows.length, orders: orders.length });
}

// One Shopify order: what's on it, what's on the shelf, who's on it and where it's at. No prices.
const ORDER_STATUSES = ["Not started", "In progress", "Ready to ship"];
function viewOrder(o, a, wholesale, done) {
  if (!o) return;
  const who = (a?.assignees ?? []).map(nameOf).filter(Boolean);
  const mine = (a?.assignees ?? []).includes(state.profile.id);
  const canStatus = !OFFICE && (can("lead") || mine);
  const status = a?.status ?? "Not started";
  const numericId = String(o.id).split("/").pop();
  const d = Math.floor((Date.now() - new Date(o.created_at)) / 864e5);
  sheet(`
    <div class="row between"><span class="badge ${d >= 10 ? "bad" : d >= 5 ? "warn" : ""}">${d === 0 ? "Ordered today" : d + " days old"}</span><button class="btn sm" data-close>Close</button></div>
    <h1 class="jv-title">${esc(o.name)}</h1>
    <div class="small muted">${esc(o.customer || "")}${o.customer ? " · " : ""}${fmtDate(o.created_at.slice(0, 10))}${wholesale ? " · Wholesale" : " · Website"}</div>
    <div class="small" style="margin-top:4px">🚚 ${o.pickup ? "<strong>Local pickup</strong>" : esc(o.shipping || "Shipping")}${o.status === "PARTIALLY_FULFILLED" ? ' · <span class="badge warn">Partly shipped</span>' : ""}</div>
    ${(o.tags ?? []).length ? `<div class="row wrap" style="gap:4px;margin-top:6px">${o.tags.map((t) => `<span class="badge ${/hold/i.test(t) ? "warn" : ""}">${esc(t)}</span>`).join("")}</div>` : ""}
    <div class="row between jv-people" style="margin-top:10px">${who.length ? `<span class="assignees">👤 ${who.map(esc).join(", ")}</span>` : '<span class="muted">👤 Not assigned</span>'}${can("lead") && !OFFICE ? '<button class="btn sm" id="oassign">Assign</button>' : ""}</div>
    <div class="section"><label>Status</label>
      ${canStatus ? `<div class="chips" id="ostatus">${ORDER_STATUSES.map((x) => `<button class="chip ${x === status ? "active" : ""}" data-s="${x}">${x}</button>`).join("")}</div>`
        : `<span class="badge ${status === "Ready to ship" ? "ok" : status === "In progress" ? "warn" : ""}">${esc(status)}</span>`}</div>
    <h3 class="section" style="margin-bottom:4px">Items to ship</h3>
    <div class="list">${o.lines.map((l) => `<div class="item row" style="cursor:default;gap:10px;align-items:flex-start">
      ${l.image ? `<img src="${esc(l.image)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:8px;flex:none;background:#fff" loading="lazy">` : ""}
      <div style="flex:1;min-width:0"><div class="row between">
      <span class="title">${l.qty} × ${esc(l.title)}${l.variant ? ` <span class="muted">(${esc(l.variant)})</span>` : ""}</span>
      <span class="small ${l._stock == null ? "muted" : l._stock >= l.qty ? "" : "error"}">${l._stock == null ? "not tracked" : l._stock >= l.qty ? "✓ on shelf" : `${Math.max(0, l._stock)} on shelf`}</span></div>
      ${(l.options ?? []).map((x) => `<div class="small">${esc(x)}</div>`).join("")}
      ${l.sku ? `<div class="small muted">SKU ${esc(l.sku)}</div>` : ""}</div></div>`).join("")}</div>
    ${o.note ? `<h3 class="section" style="margin-bottom:4px">Order note</h3><div class="card small" style="white-space:pre-wrap">${esc(o.note)}</div>` : ""}
    <div class="row between section" style="margin-bottom:4px"><h3 style="margin:0">📷 Photos</h3>
      <label class="btn sm" style="cursor:pointer">+ Add photo<input type="file" accept="image/*" multiple id="ophoto" hidden></label></div>
    <div id="ophotos"><p class="small muted" style="margin:0">Loading photos…</p></div>
    <div class="row wrap section">
      ${can("lead") && !OFFICE ? '<button class="btn" id="ojob">+ Job from this order</button>' : ""}
      ${can("admin") ? `<a class="btn" href="https://admin.shopify.com/store/brittany-316/orders/${esc(numericId)}" target="_blank" rel="noopener">Open in Shopify ↗</a>` : ""}
    </div>
    ${a?.updated_by ? `<p class="small muted">Last updated by ${esc(nameOf(a.updated_by))} · ${new Date(a.updated_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>` : ""}`,
  (root, close) => {
    const showPhotos = async () => {
      const list = await orderPhotoList(o);
      const el = root.querySelector("#ophotos"); if (!el) return;
      el.innerHTML = list.length ? `<div class="sop-photos">${list.map((p, n) => `<figure data-oph="${n}"><img src="${esc(p.url)}" alt="${esc(p.caption || o.name)}" loading="lazy">${p.caption ? `<figcaption class="small">${esc(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div>`
        : '<p class="small muted" style="margin:0">No photos on this order yet. Add the customer\'s pictures or reference shots here so whoever builds it can see them.</p>';
      el.querySelectorAll("[data-oph]").forEach((f) => (f.onclick = () => photoViewer(list[Number(f.dataset.oph)], list)));
    };
    showPhotos();
    root.querySelector("#ophoto").onchange = async (e) => {
      const files = [...e.target.files]; if (!files.length) return;
      toast(`Uploading ${files.length} photo${files.length > 1 ? "s" : ""}…`);
      for (const f of files) {
        const path = `${String(o.id).split("/").pop()}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        const up = await sb.storage.from("orders").upload(path, await shrinkImage(f, 1600), { contentType: "image/jpeg" });
        if (up.error) return toast(up.error.message);
        const { data: row, error } = await sb.from("order_photos").insert({ shopify_order_id: o.id, order_name: o.name, path, uploaded_by: state.profile.id }).select().single();
        if (error) return toast(error.message);
        (o.hubPhotos ??= []).push(row);
      }
      log("order_photo", "order", null, { order: o.name, count: files.length });
      toast("Photo added"); e.target.value = ""; showPhotos();
    };
    root.querySelector("#oassign")?.addEventListener("click", () => { close(); assignOrder(o, a, done); });
    root.querySelectorAll("#ostatus [data-s]").forEach((b) => (b.onclick = async () => {
      const row = { shopify_order_id: o.id, order_name: o.name, status: b.dataset.s };
      const { error } = a ? await sb.from("order_assignments").update({ status: b.dataset.s }).eq("shopify_order_id", o.id)
        : await sb.from("order_assignments").insert(row);
      if (error) return toast(error.message);
      log("order_status", "order", null, { order: o.name, status: b.dataset.s });
      toast(`${o.name}: ${b.dataset.s}`); close(); done?.();
    }));
    root.querySelector("#ojob")?.addEventListener("click", () => {
      close();
      const lines = o.lines.map((l) => `${l.qty} × ${l.title}${l.variant ? ` (${l.variant})` : ""}`).join("\n");
      const one = o.lines.length === 1 ? o.lines[0] : null;
      editJob({ title: `${o.name} – ${o.customer || (wholesale ? "Wholesale" : "Web order")}`, product: one ? one.title : "", quantity: one ? one.qty : o.lines.reduce((t, l) => t + Number(l.qty), 0),
        customer: o.customer || "", channel: wholesale ? "Retail" : "Web", shopify_order_id: o.id, notes: `Shopify order ${o.name}\n${lines}${o.note ? "\n\nOrder note: " + o.note : ""}` },
        () => { jobFilter = "Active"; done?.(); });
    });
  });
}

// ---------------------------------------------------------------- Box / layer packing record
// Countertop stand jobs: record how many pieces went in each layer of each box. The total feeds "amount sent".
const isBoxJob = (j) => /countertop|stand/i.test(`${j.title ?? ""} ${j.product ?? ""}`);
const boxSum = (boxes) => boxes.reduce((a, b) => a + (b.layers ?? []).reduce((x, n) => x + Number(n || 0), 0), 0);
async function fillJobBoxes(el, j, reload) {
  if (!el) return;
  const { data } = await sb.from("job_boxes").select("*").eq("job_id", j.id).order("box_no");
  const boxes = data ?? [], total = boxSum(boxes);
  el.innerHTML = `<div class="row between section" style="margin-bottom:4px"><h3 style="margin:0">📦 Boxes &amp; layers</h3>
      ${j.status !== "Complete" || can("lead") ? '<button class="btn sm primary" id="addbox">+ Box</button>' : ""}</div>
    <div class="card" style="padding:10px">
      <div class="row between"><span><strong style="font-size:1.25rem">${total}</strong> <span class="small muted">pieces in ${boxes.length} box${boxes.length === 1 ? "" : "es"}</span></span>
        <span class="small ${total === Number(j.quantity) ? "" : "muted"}">${total === Number(j.quantity) ? "✓ matches order" : `ordered ${j.quantity}`}</span></div>
      ${boxes.length ? `<div class="list" style="margin-top:8px">${boxes.map((b) => `<div class="item" data-box="${b.id}">
        <div class="row between"><span class="title">Box ${b.box_no}</span><strong>${(b.layers ?? []).reduce((x, n) => x + Number(n || 0), 0)}</strong></div>
        <div class="small muted">${(b.layers ?? []).map((n, i) => `Layer ${i + 1}: <span style="color:var(--text)">${n}</span>`).join(" · ") || "No layers yet"}${b.note ? ` · ${esc(b.note)}` : ""}</div></div>`).join("")}</div>` : '<p class="small muted" style="margin:6px 0 0">No boxes recorded yet. Tap + Box as each box is packed.</p>'}
      ${can("lead") && boxes.length && Number(j.shipped_qty) !== total ? `<button class="btn sm" id="boxsent" style="margin-top:8px">Use ${total} as amount sent</button>` : ""}
    </div>`;
  const lastLayers = boxes.length ? boxes[boxes.length - 1].layers.length : 3;
  el.querySelector("#addbox")?.addEventListener("click", () => editBox(j, { box_no: (boxes.at(-1)?.box_no ?? 0) + 1, layers: Array(lastLayers || 3).fill("") }, reload));
  el.querySelectorAll("[data-box]").forEach((d) => (d.onclick = () => editBox(j, boxes.find((b) => b.id === d.dataset.box), reload)));
  el.querySelector("#boxsent")?.addEventListener("click", async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
    const { error } = await sb.from("jobs").update({ shipped_qty: total, shipped_at: j.shipped_at ?? today, shipped_by: state.profile.id }).eq("id", j.id);
    if (error) return toast(error.message);
    log("update_job", "job", j.id, { shipped: total, from: "boxes" });
    toast(`Amount sent: ${total}`); reload();
  });
}
function editBox(j, b, reload) {
  const layers = [...(b.layers ?? [])];
  const draw = (root) => {
    root.querySelector("#layers").innerHTML = layers.map((n, i) => `<div class="row" style="gap:8px;align-items:center">
      <label style="margin:0;min-width:70px">Layer ${i + 1}</label>
      <input data-l="${i}" type="number" min="0" step="1" inputmode="numeric" value="${esc(n)}" style="flex:1">
      ${layers.length > 1 ? `<button type="button" class="btn icon sm" data-rm="${i}" aria-label="Remove layer ${i + 1}">×</button>` : ""}</div>`).join("");
    const tot = () => layers.reduce((x, n) => x + Number(n || 0), 0);
    root.querySelector("#btot").textContent = tot();
    root.querySelectorAll("[data-l]").forEach((inp) => (inp.oninput = () => { layers[Number(inp.dataset.l)] = inp.value; root.querySelector("#btot").textContent = tot(); }));
    root.querySelectorAll("[data-rm]").forEach((x) => (x.onclick = () => { layers.splice(Number(x.dataset.rm), 1); draw(root); }));
  };
  sheet(`<form class="stack" id="bf">
    <h2 style="margin:0">${esc(j.title)}</h2>
    <div class="grid2"><div><label>Box #</label><input name="box_no" type="number" min="1" step="1" inputmode="numeric" value="${esc(b.box_no)}" required></div>
      <div><label>Total in box</label><div style="font-size:1.6rem;font-weight:800;padding-top:4px" id="btot">0</div></div></div>
    <div><label>Pieces in each layer</label><div class="stack" id="layers" style="gap:6px"></div>
      <button type="button" class="btn sm" id="addlayer" style="margin-top:6px">+ Layer</button></div>
    <div><label>Note (optional)</label><input name="note" value="${esc(b.note)}" placeholder="e.g. 2 seconds on top"></div>
    <div class="row wrap"><button class="btn primary">Save box</button><button type="button" class="btn" data-close>Cancel</button>
      ${b.id ? '<button type="button" class="btn danger" id="delbox">Delete box</button>' : ""}</div>
  </form>`, (root, close) => {
    draw(root);
    root.querySelector('[data-l="0"]')?.focus();
    root.querySelector("#addlayer").onclick = () => { layers.push(""); draw(root); root.querySelector(`[data-l="${layers.length - 1}"]`)?.focus(); };
    root.querySelector("#bf").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const clean = layers.map((n) => Math.max(0, Math.round(Number(n || 0))));
      while (clean.length > 1 && clean[clean.length - 1] === 0 && layers[clean.length - 1] === "") clean.pop();
      const row = { job_id: j.id, box_no: Math.round(Number(f.box_no)), layers: clean, note: f.note || null, updated_by: state.profile.id, updated_at: new Date().toISOString() };
      const { error } = b.id ? await sb.from("job_boxes").update(row).eq("id", b.id) : await sb.from("job_boxes").insert(row);
      if (error) return toast(error.message);
      log("pack_box", "job", j.id, { box: row.box_no, layers: clean, total: clean.reduce((a, n) => a + n, 0) });
      toast(`Box ${row.box_no}: ${clean.reduce((a, n) => a + n, 0)} pieces`); close(); reload();
    };
    root.querySelector("#delbox")?.addEventListener("click", async () => {
      if (!confirm(`Delete box ${b.box_no}?`)) return;
      const { error } = await sb.from("job_boxes").delete().eq("id", b.id);
      if (error) return toast(error.message);
      close(); reload();
    });
  });
}

// A job made from a Shopify order shows that order's photos.
async function fillJobPhotos(el, j) {
  if (!el) return;
  const { orders } = await loadOpenOrders();
  let o = (orders ?? []).find((x) => x.id === j.shopify_order_id);
  if (!o) o = { id: j.shopify_order_id, name: "", photos: [], hubPhotos: (await sb.from("order_photos").select("*").eq("shopify_order_id", j.shopify_order_id).order("created_at")).data ?? [] };
  const list = await orderPhotoList(o);
  if (!list.length) return;
  el.innerHTML = `<h3 class="section" style="margin-bottom:4px">📷 Order photos</h3><div class="sop-photos">${list.map((p, n) => `<figure data-jph="${n}"><img src="${esc(p.url)}" alt="" loading="lazy">${p.caption ? `<figcaption class="small">${esc(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div>`;
  el.querySelectorAll("[data-jph]").forEach((f) => (f.onclick = () => photoViewer(list[Number(f.dataset.jph)], list)));
}

// Every photo on an order: pictures the customer attached in Shopify, plus ones added in the hub (private, links last an hour).
const orderPhotoCount = (o) => (o.photos ?? []).length + (o.hubPhotos ?? []).length;
async function orderPhotoList(o) {
  const hub = (o.hubPhotos ?? []).map((p) => ({ ...p, caption: p.caption || `Added by ${nameOf(p.uploaded_by) || "someone"} · ${fmtDate(p.created_at.slice(0, 10))}` }));
  if (hub.length) {
    const { data } = await sb.storage.from("orders").createSignedUrls(hub.map((p) => p.path), 3600);
    (data ?? []).forEach((d) => { const p = hub.find((x) => x.path === d.path); if (p && d.signedUrl) p.url = d.signedUrl; });
  }
  return [...(o.photos ?? []).map((p) => ({ url: p.url, caption: `From the order · ${p.caption}` })), ...hub.filter((p) => p.url)];
}

// Leads and up: pick who's working a Shopify order. Shop employees then see it in their SHOPIFY / WHOLESALE tab.
function assignOrder(o, a, done) {
  const people = (state.cache.profiles ?? []).filter((p) => p.active && p.role !== "pending" && !/shipping room|office|guest/i.test(p.full_name ?? ""));
  const on = new Set(a?.assignees ?? []);
  sheet(`<form class="stack" id="oa">
    <h2 style="margin:0">Assign: ${esc(o.name)}</h2>
    <p class="small muted" style="margin:0">${esc(o.customer || "")} · pick everyone working this order. It shows up as theirs in the app.</p>
    <div class="list">${people.map((p) => `<label class="item row between" style="cursor:pointer"><span class="title">${esc(p.full_name || p.email)}</span>
      <input type="checkbox" name="p_${p.id}" ${on.has(p.id) ? "checked" : ""} style="width:22px;height:22px"></label>`).join("")}</div>
    <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button></div>
  </form>`, (root, close) => {
    root.querySelector("#oa").onsubmit = async (e) => {
      e.preventDefault();
      const ids = people.filter((p) => root.querySelector(`[name="p_${p.id}"]`).checked).map((p) => p.id);
      const { error } = await sb.from("order_assignments").upsert({ shopify_order_id: o.id, order_name: o.name, assignees: ids, status: a?.status ?? "Not started" }, { onConflict: "shopify_order_id" });
      if (error) return toast(error.message);
      log("assign_order", "order", null, { order: o.name, people: ids.map(nameOf) });
      toast(ids.length ? `${o.name}: ${ids.map(nameOf).join(", ")}` : `${o.name}: unassigned`); close(); done?.();
    };
  });
}

// ---------------------------------------------------------------- Materials (lumber to order per job)
// Each product has a board-foot "recipe" (BF per piece of each species/thickness), taken from the
// MKC Order Totals sheet. Jobs x recipes = what to order. Lumber prices are admin-only.
const ceilBF = (n) => Math.ceil(Math.round(n * 1000) / 1000);
const fmtBF = (n) => ceilBF(n).toLocaleString("en-US") + " BF";
async function loadMaterialData() {
  const [{ data: prods }, { data: recs }, { data: orders }] = await Promise.all([
    sb.from("material_products").select("*").order("product"),
    sb.from("material_recipes").select("*").order("position"),
    sb.from("job_material_orders").select("*"),
  ]);
  const prices = {};
  if (seesMoney()) ((await sb.from("material_prices").select("*")).data ?? []).forEach((p) => (prices[p.material] = p.price_per_bf));
  const recipe = {};
  (recs ?? []).forEach((r) => (recipe[r.product] ??= []).push(r));
  const ord = Object.fromEntries((orders ?? []).map((o) => [o.job_id, o]));
  return { prods: prods ?? [], recipe, ord, prices };
}
const jobNeeds = (j, recipe) => (recipe[j.product] ?? []).map((r) => ({ material: r.material, bf: Number(r.bf_per_piece) * (j.quantity ?? 0) }));
const matSort = (a, b) => a.localeCompare(b, "en", { numeric: true });
function matStatus(o) {
  if (o?.received_at) return `<span class="badge ok">Received ${fmtDate(o.received_at)}</span>`;
  if (o?.ordered_at) return `<span class="badge">Ordered ${fmtDate(o.ordered_at)}</span>`;
  return '<span class="badge warn">Needs ordering</span>';
}
function bfLines(needs, prices) {
  return needs.map((n) => `<div class="row between small"><span>${esc(n.material)}</span><span><strong>${fmtBF(n.bf)}</strong>${seesMoney() && prices[n.material] != null ? ` <span class="muted">· ${usd(ceilBF(n.bf) * prices[n.material])}</span>` : ""}</span></div>`).join("");
}

// Lumber / materials ordering lives on its own bottom tab: admins and Nate Lyman only.
async function renderMaterialsView(root) {
  if (!canMaterials()) { root.innerHTML = '<div class="empty">Not available.</div>'; return; }
  const { data: jobs } = await sb.from("jobs").select("*").order("due_date", { ascending: true, nullsFirst: false }).order("created_at");
  await loadProfiles();
  return renderMaterials(root, "", jobs ?? []);
}
async function renderMaterials(root, chips, allJobs) {
  const { prods, recipe, ord, prices } = await loadMaterialData();
  const jobs = allJobs.filter((j) => j.status !== "Complete");
  const toOrder = {};
  let pending = 0;
  jobs.forEach((j) => {
    if (ord[j.id]?.ordered_at) return;
    const n = jobNeeds(j, recipe);
    if (n.length) pending++;
    n.forEach((x) => (toOrder[x.material] = (toOrder[x.material] ?? 0) + x.bf));
  });
  const mats = Object.keys(toOrder).sort(matSort);
  const totalBF = mats.reduce((a, m) => a + ceilBF(toOrder[m]), 0);
  const totalCost = mats.reduce((a, m) => a + (prices[m] != null ? ceilBF(toOrder[m]) * prices[m] : 0), 0);
  root.innerHTML = `
    ${topbar("Lumber", seesMoney() ? '<button class="btn sm" id="recipes">Recipes &amp; prices</button>' : "")}
    ${chips}
    <div class="card" style="margin-top:12px">
      <div class="row between"><h3 style="margin:0">🪵 Lumber to order</h3>${mats.length ? '<button class="btn sm" id="copy">Copy list</button>' : ""}</div>
      ${mats.length ? `<p class="small muted" style="margin:4px 0 8px">For ${pending} job${pending === 1 ? "" : "s"} not marked ordered yet. Rounded up to the whole board foot.</p>
        ${bfLines(mats.map((m) => ({ material: m, bf: toOrder[m] })), prices)}
        <div class="row between" style="border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><strong>Total</strong><span><strong>${totalBF.toLocaleString("en-US")} BF</strong>${seesMoney() && totalCost ? ` · <strong>${usd(totalCost)}</strong>` : ""}</span></div>`
        : '<p class="small muted" style="margin:6px 0 0">Nothing to order. Every active job is marked ordered (or has no recipe yet).</p>'}
    </div>
    <h3 class="section" style="margin-bottom:4px">Active jobs</h3>
    <div class="list">${jobs.map((j) => {
      const n = jobNeeds(j, recipe), o = ord[j.id];
      return `<div class="item" style="cursor:default">
        <div class="row between"><span class="title">${esc(j.title)}</span>${n.length ? matStatus(o) : ""}</div>
        <div class="small muted">${[j.quantity + " pc", j.product, j.due_date ? "Due " + fmtDate(j.due_date) : ""].filter(Boolean).map(esc).join(" · ")}</div>
        ${n.length ? `<div style="margin-top:6px">${bfLines(n, prices)}</div>
          <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
            ${!o?.ordered_at ? `<button class="btn sm primary" data-ordered="${j.id}">Mark ordered</button>` : ""}
            ${o?.ordered_at && !o?.received_at ? `<button class="btn sm primary" data-received="${j.id}">Mark received</button>` : ""}
            ${o?.ordered_at ? `<button class="btn sm" data-undo="${j.id}">Undo</button>` : ""}
          </div>`
        : `<p class="small muted" style="margin:6px 0 0">No board-foot recipe for “${esc(j.product || "no product set")}”.${seesMoney() ? ` <button class="linkbtn" data-addrec="${esc(j.product || "")}">Add one</button>` : " Ask Mitchell to add it."}</p>`}
      </div>`;
    }).join("") || '<div class="empty">No active jobs.</div>'}</div>
    <h3 class="section" style="margin-bottom:4px">Quick calculator</h3>
    <div class="card">
      <p class="small muted" style="margin:0 0 8px">Figure lumber for an order before it's a job.</p>
      <div class="row" style="gap:8px"><select id="cprod" style="flex:2">${prods.map((p) => `<option>${esc(p.product)}</option>`).join("")}</select>
        <input id="cqty" type="number" inputmode="numeric" min="0" placeholder="Pieces" style="flex:1"></div>
      <div id="cnote" class="small muted" style="margin-top:6px"></div>
      <div id="cout" style="margin-top:6px"></div>
    </div>`;
  wireTopbar(root);
  root.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { jobFilter = b.dataset.f; renderJobs(root); }));
  const redo = () => renderMaterialsView(root);
  root.querySelector("#recipes")?.addEventListener("click", () => recipesSheet(prods, recipe, prices, redo));
  root.querySelectorAll("[data-addrec]").forEach((b) => (b.onclick = () => editRecipe({ product: b.dataset.addrec }, [], redo)));
  root.querySelector("#copy")?.addEventListener("click", async () => {
    const text = "Lumber order\n" + mats.map((m) => `${m}: ${ceilBF(toOrder[m])} BF`).join("\n") + `\nTotal: ${totalBF} BF`;
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it in a text or email."); } catch { toast("Couldn't copy on this device"); }
  });
  const setOrder = async (id, patch, msg) => {
    const { error } = await sb.from("job_material_orders").upsert({ job_id: id, ...patch, updated_at: new Date().toISOString() });
    if (error) return toast(error.message);
    log("material_order", "job", id, patch); toast(msg); redo();
  };
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  root.querySelectorAll("[data-ordered]").forEach((b) => (b.onclick = () => setOrder(b.dataset.ordered, { ordered_at: today(), ordered_by: state.profile.id }, "Marked ordered")));
  root.querySelectorAll("[data-received]").forEach((b) => (b.onclick = () => setOrder(b.dataset.received, { received_at: today() }, "Marked received")));
  root.querySelectorAll("[data-undo]").forEach((b) => (b.onclick = () => {
    const o = ord[b.dataset.undo];
    setOrder(b.dataset.undo, o?.received_at ? { received_at: null } : { ordered_at: null, ordered_by: null }, "Undone");
  }));
  const calc = () => {
    const p = root.querySelector("#cprod").value, q = Number(root.querySelector("#cqty").value) || 0;
    root.querySelector("#cnote").textContent = prods.find((x) => x.product === p)?.note ?? "";
    const n = jobNeeds({ product: p, quantity: q }, recipe);
    const tot = n.reduce((a, x) => a + ceilBF(x.bf), 0), cost = n.reduce((a, x) => a + (prices[x.material] != null ? ceilBF(x.bf) * prices[x.material] : 0), 0);
    root.querySelector("#cout").innerHTML = q ? bfLines(n, prices) + `<div class="row between" style="border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><strong>Total</strong><span><strong>${tot.toLocaleString("en-US")} BF</strong>${seesMoney() && cost ? ` · <strong>${usd(cost)}</strong>` : ""}</span></div>` : "";
  };
  root.querySelector("#cprod")?.addEventListener("change", calc);
  root.querySelector("#cqty")?.addEventListener("input", calc);
  if (prods.length) calc();
}

// Inside a job: what lumber it takes and whether it's been ordered.
async function fillJobMaterials(el, j) {
  if (!el || !j.product) return;
  const { recipe, ord, prices } = await loadMaterialData();
  const n = jobNeeds(j, recipe);
  if (!n.length) return;
  el.innerHTML = `<details class="card" style="margin:8px 0;padding:10px"><summary class="small muted" style="cursor:pointer">🪵 Lumber for this job · ${fmtBF(n.reduce((a, x) => a + x.bf, 0))} ${matStatus(ord[j.id])}</summary>
    <div style="margin-top:6px">${bfLines(n, prices)}</div></details>`;
}

function recipesSheet(prods, recipe, prices, after) {
  const mats = [...new Set([...Object.keys(prices), ...Object.values(recipe).flat().map((r) => r.material)])].sort(matSort);
  sheet(`
    <div class="row between"><h2 style="margin:0">Recipes &amp; lumber prices</h2><button class="btn sm" data-close>Close</button></div>
    <p class="small muted">Board feet per piece for each product. Leads see board feet; only you and Brittany see prices.</p>
    <div class="row between"><h3 class="section" style="margin:0">Products</h3><button class="btn sm primary" id="addp">+ Product</button></div>
    <div class="list" style="margin-top:6px">${prods.map((p) => `<div class="item" data-p="${esc(p.product)}">
      <div class="title">${esc(p.product)}</div>
      <div class="small muted">${(recipe[p.product] ?? []).map((r) => `${esc(r.material)} ${Number(r.bf_per_piece)}`).join(" · ") || "No materials yet"}</div></div>`).join("")}</div>
    <h3 class="section">Lumber price per BF</h3>
    <form id="pf"><table><tr><th>Material</th><th>$ / BF</th></tr>
      ${mats.map((m) => `<tr><td>${esc(m)}</td><td><input name="${esc(m)}" type="number" step="0.01" min="0" value="${prices[m] ?? ""}" style="width:90px"></td></tr>`).join("")}
    </table><button class="btn primary" style="margin-top:10px">Save prices</button></form>`, (root, close) => {
    root.querySelector("#addp").onclick = () => { close(); editRecipe({}, [], after); };
    root.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { close(); editRecipe(prods.find((p) => p.product === b.dataset.p), recipe[b.dataset.p] ?? [], after); }));
    root.querySelector("#pf").onsubmit = async (e) => {
      e.preventDefault();
      const rows = Object.entries(formData(e.target)).filter(([, v]) => v !== "").map(([material, v]) => ({ material, price_per_bf: Number(v), updated_at: new Date().toISOString() }));
      const { error } = await sb.from("material_prices").upsert(rows);
      if (error) return toast(error.message);
      toast("Prices saved"); close(); after?.();
    };
  });
}

function editRecipe(p, rows, after) {
  sheet(`
    <div class="row between"><h2 style="margin:0">${rows.length ? "Edit recipe" : "New recipe"}</h2><button class="btn sm" data-close>Close</button></div>
    <form id="rf" style="margin-top:10px">
      <label>Product (must match the job's product)</label><input name="product" required value="${esc(p.product ?? "")}" list="prodlist">
      <datalist id="prodlist">${[...new Set((state.cache.jobs ?? []).map((j) => j.product).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
      <label>Glue-up / cutting note</label><input name="note" value="${esc(p.note ?? "")}" placeholder="e.g. 9' x 35&quot; glue-up">
      <label>Board feet per piece, one material per line</label>
      <textarea name="lines" style="min-height:110px" placeholder="8/4 Walnut: 1.75&#10;8/4 Cherry: 1.75">${rows.map((r) => `${esc(r.material)}: ${Number(r.bf_per_piece)}`).join("\n")}</textarea>
      <div class="row between" style="margin-top:12px">${rows.length ? '<button type="button" class="btn danger" id="del">Delete</button>' : "<span></span>"}<button class="btn primary">Save</button></div>
    </form>`, (root, close) => {
    root.querySelector("#rf").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const lines = f.lines.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => {
        const m = l.match(/^(.+?)\s*[:=]\s*([\d.]+)\s*$/);
        return m ? { product: f.product, material: m[1].trim(), bf_per_piece: Number(m[2]), position: i + 1 } : null;
      });
      if (!lines.length || lines.includes(null)) return toast('Use one line per material, like "8/4 Walnut: 1.75"');
      const old = p.product && p.product !== f.product ? p.product : null;
      let r = await sb.from("material_products").upsert({ product: f.product, note: f.note || null, updated_at: new Date().toISOString() });
      if (r.error) return toast(r.error.message);
      if (old) await sb.from("material_products").delete().eq("product", old);
      await sb.from("material_recipes").delete().eq("product", f.product);
      r = await sb.from("material_recipes").insert(lines);
      if (r.error) return toast(r.error.message);
      toast("Recipe saved"); close(); after?.();
    };
    root.querySelector("#del")?.addEventListener("click", async () => {
      if (!confirm(`Delete the recipe for ${p.product}?`)) return;
      await sb.from("material_products").delete().eq("product", p.product);
      toast("Deleted"); close(); after?.();
    });
  });
}

// Progress = pieces through all steps / (pieces x steps).
function jobProgress(j, steps) {
  if (!steps.length) return 0;
  const total = steps.length * j.quantity;
  return Math.round((steps.reduce((a, st) => a + Math.min(st.done_qty, j.quantity), 0) / total) * 100);
}
function currentStep(j, steps) { return steps.find((st) => st.done_qty < j.quantity); }

// Everyone on a job: the lead plus anyone assigned.
const jobPeople = (j) => [...new Set([j.assigned_to, ...(j.assignees ?? [])].filter(Boolean))];
const mySteps = (j) => j._mySteps ?? [];
const isMyJob = (j) => jobPeople(j).includes(state.profile?.id) || mySteps(j).length > 0;
// Tag each job with the steps assigned to the signed-in person.
function tagMySteps(jobs, steps) {
  const me = state.profile?.id, by = {};
  (steps ?? []).forEach((st) => { if ((st.assignees ?? []).includes(me)) (by[st.job_id] ??= []).push(st.name); });
  (jobs ?? []).forEach((j) => (j._mySteps = by[j.id] ?? []));
}
const peopleLine = (j) => { const ids = jobPeople(j); return ids.length ? `<span class="assignees">👤 ${ids.map((id) => esc(nameOf(id) || "?")).join(", ")}</span>` : ""; };

// Jobs list card: just the job name and piece count (everything else is inside the job).
function jobCard(j, steps) {
  if (j.status === "Complete") {
    const sent = j.shipped_qty ?? j.quantity ?? 0;
    return `<div class="item jobcard done" data-job="${j.id}">
    <div class="row between" style="gap:10px"><span class="title">✓ ${esc(j.title)}</span>
      <span class="pcs">${sent}<small> sent</small></span></div>
    <div class="row between" style="gap:10px"><div class="small">Completed ${j.completed_at ? new Date(j.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}${j.shipped_qty == null ? " · amount sent not recorded" : j.shipped_qty !== j.quantity ? ` · ordered ${j.quantity}` : ""}</div>
      ${seesMoney() ? `<label class="billchk" data-billed="${j.id}"><input type="checkbox" style="width:20px;height:20px;margin:0"> Billed</label>` : ""}</div>
  </div>`;
  }
  return `<div class="item jobcard${can("lead") ? " hold" : ""}" data-job="${j.id}">
    <div class="row between" style="gap:10px"><span class="title">${esc(j.title)}</span>
      <span class="pcs">${j.quantity ?? 1}<small> pcs</small></span></div>
  </div>`;
}

// Kept for the Home screen lists.
// Shopify / wholesale orders assigned to me, shown in "My jobs" on Home. Shown right away from the hub's
// assignment list, then checked against Shopify so shipped orders drop off and the customer/items fill in.
function orderRows(list, open) {
  if (!list.length) return "";
  return `<div class="list" style="margin-top:6px">${list.map((a) => {
    const o = open?.find((x) => x.id === a.shopify_order_id);
    const pcs = o ? o.lines.reduce((t, l) => t + Number(l.qty), 0) : null;
    return `<div class="item" data-myorder="${esc(a.shopify_order_id)}"><div class="row between"><span class="title">🛒 ${esc(a.order_name)}${o?.customer ? ` · ${esc(o.customer)}` : ""}</span>
      ${pcs != null ? `<span class="badge">${pcs} pc</span>` : ""}</div>
      <div class="small muted">${o ? (o.wholesale ? "Wholesale order" : "Website order") : "Shopify order"}${o?.pickup ? " · Local pickup" : ""}${a.status !== "Not started" ? ` · <span class="badge ${a.status === "Ready to ship" ? "ok" : "warn"}">${esc(a.status)}</span>` : ""}</div>
      ${o ? `<div class="small">${o.lines.map((l) => `${l.qty} × ${esc(l.title)}`).join(", ")}</div>` : ""}</div>`;
  }).join("")}</div>`;
}
async function fillMyOrders(root, mine, jobCount) {
  const { error, orders, inv, assign } = await loadOpenOrders();
  const el = root.querySelector("#myorders"); if (!el || error) return;
  const open = mine.filter((a) => orders.some((o) => o.id === a.shopify_order_id)); // shipped/closed orders drop off
  orders.forEach((o) => o.lines.forEach((l) => { const it = matchStock(l, inv, o.wholesale); l._stock = it ? Number(it.quantity) : null; }));
  el.innerHTML = orderRows(open, orders);
  const c = root.querySelector("#myjobcount"); if (c) c.textContent = jobCount + open.length;
  if (!open.length && !jobCount) el.innerHTML = '<p class="muted small">Nothing assigned to you.</p>';
  el.querySelectorAll("[data-myorder]").forEach((b) => (b.onclick = () => {
    const o = orders.find((x) => x.id === b.dataset.myorder);
    viewOrder(o, assign[o.id], o.wholesale, () => { state.cache.openOrders = null; renderShell(); });
  }));
}

function jobRows(list) {
  if (!list.length) return "";
  return `<div class="list" style="margin-top:6px">${list.map((j) => {
    const d = j.due_date ? daysUntil(j.due_date) : null;
    const dueCls = d === null ? "" : d < 0 ? "bad" : d <= 2 ? "warn" : "";
    return `<div class="item" data-job="${j.id}"><div class="row between"><span class="title">${esc(j.title)}</span>
      <span class="badge">${j.quantity ?? 1} pc</span></div>
      ${mySteps(j).length ? `<div class="small">🛠 Your step${mySteps(j).length > 1 ? "s" : ""}: <strong>${mySteps(j).map(esc).join(", ")}</strong></div>` : ""}
      <div class="small muted">${esc(j.customer ?? "")}${j.due_date ? ` · <span class="badge ${dueCls}">Due ${fmtDate(j.due_date)}</span>` : ""}${j.priority === "Rush" ? ' · <span class="badge bad">Rush</span>' : ""}</div></div>`;
  }).join("")}</div>`;
}

// Money is admin-only (Mitchell and Brittany). These tables are blocked for everyone else by the database.
const seesMoney = () => !!(state.profile?.active && state.profile?.sees_money); // Mitchell and Brittany only (set per person in the database)
async function loadItemPrices(ids) {
  if (!seesMoney() || !ids?.length) return {};
  const { data } = await sb.from("item_prices").select("*").in("item_id", ids);
  return Object.fromEntries((data ?? []).map((p) => [p.item_id, p]));
}
async function saveItemPrice(itemId, patch) {
  if (!seesMoney()) return;
  const { error } = await sb.from("item_prices").upsert({ item_id: itemId, ...patch, updated_at: new Date().toISOString() });
  if (error) toast("Price didn't save: " + error.message);
}
const usd = (n) => (n == null ? "" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
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
      <div class="grid2">
        <div><label>How many pieces did you finish on this step?</label><input name="pieces" type="number" min="0" step="1" inputmode="numeric" required autofocus></div>
        <div><label>How many men worked it (you included)?</label><input name="crew" type="number" min="1" max="10" step="1" inputmode="numeric" value="1" required></div>
      </div>
      <p class="small muted" id="math" style="margin:0"></p>
      <div><label>Note (optional)</label><input name="note" placeholder="Interrupted, machine down, extra defects…"></div>
      <div class="row wrap"><button class="btn primary">Save time</button><button type="button" class="btn" data-close>Keep timing</button><button type="button" class="btn danger" id="cancelt">Cancel timer</button></div>
    </form>`, (root, close) => {
    root.querySelector("#cancelt").onclick = () => { close(); cancelTimer(t, after); };
    // Labor = clock time x men. Shown so the guy sees what gets recorded.
    const clockMin = (Date.now() - new Date(t.started_at)) / 60000;
    const pp = (m) => (m < 1 ? `${Math.round(m * 60)} sec` : m < 10 ? `${m.toFixed(1)} min` : fmtMin(m));
    const showMath = () => {
      const f = formData(root.querySelector("#f")), pcs = Number(f.pieces), men = Math.max(1, Math.round(Number(f.crew) || 1));
      const labor = clockMin * men;
      root.querySelector("#math").textContent = pcs > 0
        ? `${fmtMin(clockMin)} on the clock × ${men} ${men > 1 ? "men" : "man"} = ${fmtMin(labor)} of labor → ${pp(labor / pcs)} labor per piece${men > 1 ? ` (${pp(clockMin / pcs)} on the clock)` : ""}.`
        : "";
    };
    root.querySelectorAll("input[name=pieces], input[name=crew]").forEach((i) => (i.oninput = showMath));
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const { error } = await sb.rpc("job_timer_stop", { p_pieces: Number(f.pieces), p_note: f.note || null, p_crew: Math.max(1, Math.round(Number(f.crew) || 1)) });
      if (error) return toast(error.message);
      toast(`Logged ${f.pieces} piece${f.pieces === "1" ? "" : "s"}. Nice work.`);
      close(); after?.();
    };
  });
}

// Re-open a job's view with fresh data after a change.
async function reopenJob(id, done) {
  const { data } = await sb.from("jobs").select("*").eq("id", id).single();
  if (data) viewJob(data, done); else done?.();
}

// Final amount sent: what actually went out, so Brittany bills the real count.
async function recordShipped(j, after) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  const boxTotal = isBoxJob(j) ? boxSum((await sb.from("job_boxes").select("layers").eq("job_id", j.id)).data ?? []) : 0;
  sheet(`
    <form class="stack" id="f"><h2>Final amount sent</h2>
      <p class="small muted" style="margin:0">${esc(j.title)} · ordered ${j.quantity}${boxTotal ? ` · <strong>${boxTotal} counted in boxes</strong>` : ""}</p>
      <div class="grid2">
        <div><label>Pieces sent</label><input name="shipped_qty" type="number" min="0" step="1" inputmode="numeric" value="${esc(j.shipped_qty ?? (boxTotal || j.quantity))}" required></div>
        <div><label>Date sent</label><input name="shipped_at" type="date" value="${esc(j.shipped_at ?? today)}" required></div>
      </div>
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>
        ${j.shipped_qty != null ? '<button type="button" class="btn danger" id="clr">Clear</button>' : ""}</div>
    </form>`, (root, close) => {
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const { error } = await sb.from("jobs").update({ shipped_qty: Math.round(Number(f.shipped_qty)), shipped_at: f.shipped_at, shipped_by: state.profile.id }).eq("id", j.id);
      if (error) return toast(error.message);
      log("update_job", "job", j.id, { shipped: Number(f.shipped_qty) });
      toast("Amount sent saved. Brittany can bill it."); close(); after?.();
    };
    root.querySelector("#clr")?.addEventListener("click", async () => {
      await sb.from("jobs").update({ shipped_qty: null, shipped_at: null, shipped_by: null }).eq("id", j.id); close(); after?.();
    });
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
  const money = seesMoney() ? (await sb.from("job_financials").select("*").eq("job_id", j.id).maybeSingle()).data : null;
  const { data: stats } = await sb.from("process_stats").select("*").in("product", products);
  const statFor = (name) => (stats ?? []).find((x) => x.step === name);
  const mine = (timers ?? []).find((t) => t.user_id === state.profile.id && !t.ended_at);
  const mins = (t) => ((t.ended_at ? new Date(t.ended_at) : new Date()) - new Date(t.started_at)) / 60000;
  const labor = (t) => mins(t) * (t.crew ?? 1); // man-minutes
  const stepMin = (id) => (timers ?? []).filter((t) => t.step_id === id).reduce((a, t) => a + labor(t), 0);
  const totalMin = (timers ?? []).reduce((a, t) => a + labor(t), 0);
  const running = (timers ?? []).filter((t) => !t.ended_at);
  // A completed job shows every step finished (also covers jobs completed before steps were filled in automatically).
  if (j.status === "Complete") (steps ?? []).forEach((st) => { if (Number(st.done_qty ?? 0) < Number(j.quantity)) st.done_qty = j.quantity; });
  const pct = jobProgress(j, steps ?? []);
  sheet(`
    <div class="row between"><span class="badge ${j.status === "Complete" ? "ok" : ""}">${j.status === "Complete" ? "Complete" : "Active"}</span><button class="btn sm" data-close>Close</button></div>
    <h1 class="jv-title">${esc(j.title)}</h1>
    <div class="row between jv-people">${peopleLine(j) || '<span class="muted">👤 Not assigned</span>'}${can("lead") ? '<button class="btn sm" id="assign">Assign</button>' : ""}</div>
    <details class="grp jv-details"><summary><span class="grp-arrow" aria-hidden="true">▶</span><span class="grp-name">Job details</span>
      <span class="grp-meta">${j.quantity} pcs${j.due_date ? ` · <span class="badge ${daysUntil(j.due_date) < 0 ? "bad" : daysUntil(j.due_date) <= 2 ? "warn" : ""}">Due ${fmtDate(j.due_date)}</span>` : ""}</span></summary>
    <div style="padding:0 12px 12px">
    <div class="jv-pcs">${j.quantity} pieces</div>
    ${j.due_date ? `<div class="jv-due"><span class="badge ${daysUntil(j.due_date) < 0 ? "bad" : daysUntil(j.due_date) <= 2 ? "warn" : ""}">Due ${fmtDate(j.due_date)}</span></div>` : ""}
    ${j.product || j.customer || j.channel || j.notes ? `<details class="jv-more"><summary class="small muted">More info</summary>
      <p class="small muted" style="margin:4px 0 0">${[j.product, j.customer, j.channel].filter(Boolean).map(esc).join(" · ")}</p>
      ${j.notes ? `<p class="small" style="white-space:pre-wrap;margin:4px 0 0">${esc(j.notes)}</p>` : ""}</details>` : ""}
    ${money ? `<details class="card" style="margin:8px 0;padding:10px"><summary class="small muted" style="cursor:pointer">💲 Pricing &amp; PO <span class="muted">(admin only)</span>${money.billed_at ? ' <span class="badge ok">Billed</span>' : j.shipped_qty != null ? ' <span class="badge warn">Ready to bill</span>' : ""}</summary>
      <div style="margin-top:6px"><strong>${usd(money.line_total)}</strong>${money.unit_price != null ? ` · ${usd(money.unit_price)} ea` : ""}</div>
      ${j.shipped_qty != null && money.unit_price != null ? `<div style="margin-top:4px">Bill for sent: <strong>${usd(j.shipped_qty * money.unit_price)}</strong> <span class="small muted">(${j.shipped_qty} × ${usd(money.unit_price)})</span></div>` : ""}
      <div class="row between" style="margin-top:6px">${money.billed_at ? `<span class="badge ok">Billed ${fmtDate(money.billed_at)}${money.invoice_number ? " · #" + esc(money.invoice_number) : ""}</span>` : j.shipped_qty != null ? '<span class="badge warn">Ready to bill</span>' : '<span class="small muted">Not billed</span>'}
        <button class="btn sm" id="billed">${money.billed_at ? "Edit billing" : "Mark billed"}</button></div>
      ${money.money_notes ? `<div class="small muted" style="margin-top:8px">PO details</div><div class="small" style="white-space:pre-wrap">${esc(money.money_notes)}</div>` : ""}</details>` : ""}
    <div class="card" style="margin:8px 0;padding:10px">
      <div class="row between"><span class="small muted">📦 FINAL AMOUNT SENT</span>${can("lead") ? `<button class="btn sm" id="ship">${j.shipped_qty != null ? "Change" : "Record amount sent"}</button>` : ""}</div>
      ${j.shipped_qty != null ? `<div><strong>${j.shipped_qty}</strong> of ${j.quantity} pieces${j.shipped_at ? ` · sent ${fmtDate(j.shipped_at)}` : ""}${j.shipped_by ? ` · by ${esc(nameOf(j.shipped_by))}` : ""}${j.shipped_qty !== j.quantity ? ` <span class="badge warn">${j.shipped_qty > j.quantity ? "+" : ""}${j.shipped_qty - j.quantity} vs order</span>` : ""}</div>` : '<div class="small muted">Not sent yet.</div>'}
    </div>
    <div id="jobmat"></div>
    <div class="progress" style="margin:10px 0 4px"><span style="width:${pct}%"></span></div>
    <div class="row between small muted"><span>${pct}% done</span><span>Total labor logged: ${fmtMin(totalMin)}</span></div>
    </div></details>
    ${running.length ? `<p class="small" style="margin:6px 0 0">⏱ On it now: ${running.map((t) => esc(nameOf(t.user_id)) + " (" + esc((steps ?? []).find((s) => s.id === t.step_id)?.name ?? "") + ")").join(", ")}</p>` : ""}
    <div class="row between section" style="margin-bottom:4px"><h3 style="margin:0">Steps</h3>${isOwner() ? '<button class="btn sm" id="arrange">Arrange steps</button>' : ""}</div>
    ${isOwner() ? '<p class="small muted" style="margin:0 0 6px">Press and hold a step to rename, move or remove it.</p>' : ""}
    ${(() => {
    // A step is done once its count reaches the job quantity (and nobody is timing it).
    const isDone = (st) => st.done_qty >= j.quantity && mine?.step_id !== st.id;
    const stepHtml = (st) => {
      const s10 = statFor(st.name), done = isDone(st);
      const head = done
        ? `<div class="row between"><span class="title"><span class="grp-arrow" aria-hidden="true">▶</span> ✓ ${esc(st.name)}</span><span class="donetotal">${st.done_qty}/${j.quantity}${stepMin(st.id) ? ` <small>· ${fmtMin(stepMin(st.id))}</small>` : ""}</span></div>`
        : `<div class="row between"><span class="title">${(st.assignees ?? []).includes(state.profile.id) ? '<span class="badge ok">Yours</span> ' : ""}${esc(st.name)}</span><span class="badge">${st.done_qty}/${j.quantity}</span></div>`;
      return `${done ? `<details class="item stepdone${isOwner() ? " hold" : ""}" data-step="${st.id}"><summary>${head}</summary>` : `<div class="item${isOwner() ? " hold" : ""}" data-step="${st.id}" style="cursor:default">${head}`}
        ${(st.assignees ?? []).length || can("lead") ? `<div class="row" style="gap:6px;margin-top:2px">${(st.assignees ?? []).length ? `<span class="small assignees">👤 ${st.assignees.map((id) => esc(nameOf(id) || "?")).join(", ")}</span>` : '<span class="small muted">👤 Anyone</span>'}
          ${can("lead") && j.status !== "Complete" ? `<button class="linkbtn small" style="float:none;color:var(--accent);font-size:.85rem;text-decoration:underline" data-stepassign="${st.id}">${(st.assignees ?? []).length ? "change" : "assign"}</button>` : ""}</div>` : ""}
        <div class="progress thin" style="margin:6px 0"><span style="width:${Math.min(100, Math.round(st.done_qty / j.quantity * 100))}%"></span></div>
        <div class="row between" style="gap:6px;flex-wrap:wrap">
          <span class="small muted">This job: ${fmtMin(stepMin(st.id))} labor${s10?.minutes_per_10 ? ` · Avg ${fmtMin(s10.minutes_per_10)} labor per 10 pcs` : ""}</span>
          <span class="row" style="gap:6px">
            ${j.status !== "Complete" && !OFFICE ? (mine?.step_id === st.id ? '<button class="btn sm danger" data-stop>Stop</button><button class="btn sm" data-cancelt>Cancel</button>' : `<button class="btn sm primary" data-start="${st.id}" ${mine ? "disabled" : ""}>Start timer</button>`) : ""}
            ${/engrav|laser/i.test(st.name) && j.status !== "Complete" ? `<button class="btn sm" data-laser="${st.id}">🔦 Laser timer</button>` : ""}
            <button class="btn sm" data-notes="${st.id}">💬 ${notesFor(st.id).length || ""}</button>
            ${can("lead") && j.status !== "Complete" ? `<button class="btn icon sm" data-fix="${st.id}" aria-label="Adjust count">✎</button>` : ""}
          </span></div>
        <div class="notes" id="notes-${st.id}" style="display:none">${noteList(notesFor(st.id))}${noteForm(st.id)}</div>${done ? "</details>" : "</div>"}`;
    };
    // Steps stay in their order; finished ones show collapsed in green (tap to open).
    if (!(steps ?? []).length) return '<div class="list"><div class="empty">No steps on this job.</div></div>';
    return `<div class="list">${(steps ?? []).map(stepHtml).join("")}</div>`;
    })()}
    ${isBoxJob(j) ? '<div id="jobboxes"></div>' : ""}
    ${j.shopify_order_id ? '<div id="jobphotos"></div>' : ""}
    <h3 class="section" style="margin-bottom:4px">Job notes</h3>
    <div class="notes">${noteList(notesFor(null)) || '<p class="small muted" style="margin:0">No notes yet. Anything the next guy should know goes here.</p>'}${noteForm(null)}</div>
    ${(timers ?? []).length ? `<details class="section"><summary class="small">Time log (${timers.length})</summary>
      ${can("admin") ? '<p class="small muted" style="margin:6px 0 0">Tap a line to fix the time, pieces or step.</p>' : ""}
      <table style="margin-top:6px"><tr><th>Who</th><th>Step</th><th>When</th><th>Time</th><th>Men</th><th>Pcs</th></tr>${timers.map((t) => `<tr ${can("admin") ? `data-tedit="${t.id}" style="cursor:pointer"` : ""}>
        <td>${esc(nameOf(t.user_id))}</td><td>${esc((steps ?? []).find((s) => s.id === t.step_id)?.name ?? "")}</td>
        <td class="small">${fmtDate(t.started_at.slice(0, 10))} ${timeOf(t.started_at)}</td>
        <td>${t.ended_at ? fmtMin(mins(t)) : '<span class="badge ok">Running</span>'}</td><td>${t.crew ?? 1}</td><td>${t.pieces ?? ""}${can("admin") ? ' <span class="muted">✎</span>' : ""}</td></tr>`).join("")}</table></details>` : ""}
    <div class="row wrap" style="margin-top:14px">
      ${can("lead") ? '<button class="btn" id="edit">Edit job</button>' : ""}
      ${can("lead") && j.status !== "Complete" ? '<button class="btn primary" id="complete">Mark complete</button>' : ""}
      ${can("lead") && j.status === "Complete" ? '<button class="btn" id="reopen">Reopen</button>' : ""}
    </div>`, (root, close) => {
    if (canMaterials()) fillJobMaterials(root.querySelector("#jobmat"), j);
    if (j.shopify_order_id) fillJobPhotos(root.querySelector("#jobphotos"), j);
    if (isBoxJob(j)) fillJobBoxes(root.querySelector("#jobboxes"), j, () => { close(); reopenJob(j.id, done); });
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
    root.querySelector("#ship")?.addEventListener("click", () => recordShipped(j, () => { close(); reopenJob(j.id, done); }));
    root.querySelector("#billed")?.addEventListener("click", async () => {
      const inv = prompt("Invoice number (leave blank to clear billed):", money?.invoice_number ?? "");
      if (inv === null) return;
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
      const patch = inv.trim() === "" && money?.billed_at ? { billed_at: null, invoice_number: null } : { billed_at: money?.billed_at ?? today, invoice_number: inv.trim() || null };
      const { error } = await sb.from("job_financials").upsert({ job_id: j.id, ...patch, updated_at: new Date().toISOString() });
      if (error) return toast(error.message);
      toast(patch.billed_at ? "Marked billed" : "Billing cleared"); close(); reopenJob(j.id, done);
    });
    root.querySelector("#complete")?.addEventListener("click", async () => {
      if (running.length && !confirm("Someone still has a timer running on this job. Complete it anyway?")) return;
      if (j.shipped_qty == null) { toast("Record the final amount sent first."); return recordShipped(j, () => { close(); reopenJob(j.id, done); }); }
      const { error } = await sb.from("jobs").update({ status: "Complete", completed_at: new Date().toISOString() }).eq("id", j.id);
      if (error) return toast(error.message);
      // Complete job = every step finished: bring each step's count up to the job quantity.
      const behind = (steps ?? []).filter((st) => Number(st.done_qty ?? 0) < Number(j.quantity));
      if (behind.length) await sb.from("job_steps").update({ done_qty: j.quantity }).eq("job_id", j.id).lt("done_qty", j.quantity);
      log("update_job", "job", j.id, { to: "Complete" }); toast("Job complete. Moved to COMPLETE."); close(); done?.();
    });
    root.querySelector("#reopen")?.addEventListener("click", async () => {
      await sb.from("jobs").update({ status: "Active", completed_at: null }).eq("id", j.id); close(); done?.();
    });
    root.querySelector("#assign")?.addEventListener("click", () => { close(); assignJob(j, () => reopenJob(j.id, done)); });
    root.querySelectorAll("[data-stepassign]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); close(); assignStep(j, (steps ?? []).find((x) => x.id === b.dataset.stepassign), () => reopenJob(j.id, done)); }));
    root.querySelectorAll("[data-laser]").forEach((b) => (b.onclick = () => { close(); laserSheet(j, (steps ?? []).find((x) => x.id === b.dataset.laser), () => reopenJob(j.id, done)); }));
    if (isOwner()) {
      const reopenIt = () => reopenJob(j.id, done);
      root.querySelector("#arrange")?.addEventListener("click", () => { close(); arrangeSteps(j, steps ?? [], null, reopenIt); });
      root.querySelectorAll(".item.hold[data-step]").forEach((el) => onHold(el, () => { close(); arrangeSteps(j, steps ?? [], el.dataset.step, reopenIt); }));
    }
    root.querySelectorAll("[data-tedit]").forEach((r) => (r.onclick = () => {
      const t = timers.find((x) => x.id === r.dataset.tedit);
      editTimer(t, steps ?? [], () => { close(); reopenJob(j.id, done); });
    }));
  });
}

// Owner only: rename, reorder, add or remove a job's steps. Changes save as you go.
function arrangeSteps(j, steps, focusId, after) {
  let list = [...steps].sort((a, b) => a.position - b.position);
  sheet(`<div id="arr"></div>`, (root, close) => {
    const box = root.querySelector("#arr");
    const persist = async () => {
      const changed = list.map((s, i) => ({ s, i })).filter(({ s, i }) => s.position !== i);
      for (const { s, i } of changed) {
        const { error } = await sb.from("job_steps").update({ position: i }).eq("id", s.id);
        if (error) return toast(error.message);
        s.position = i;
      }
    };
    const draw = () => {
      box.innerHTML = `
        <div class="row between"><h2 style="margin:0">Arrange steps</h2><button class="btn sm primary" id="donearr">Done</button></div>
        <p class="small muted" style="margin:4px 0 10px">${esc(j.title)} · changes save right away.</p>
        <div class="list">${list.map((s, i) => `
          <div class="item" style="cursor:default;${s.id === focusId ? "border-color:var(--accent)" : ""}">
            <div class="row between" style="gap:6px">
              <span class="title" style="min-width:0;flex:1">${i + 1}. ${esc(s.name)} <span class="small muted">${s.done_qty}/${j.quantity}</span></span>
              <span class="row" style="gap:4px">
                <button class="btn icon sm" data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
                <button class="btn icon sm" data-down="${i}" ${i === list.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
                <button class="btn icon sm" data-ren="${s.id}" aria-label="Rename">✎</button>
                <button class="btn icon sm" data-del="${s.id}" aria-label="Remove">🗑</button>
              </span></div></div>`).join("") || '<div class="empty">No steps.</div>'}</div>
        <form class="row" id="addst" style="margin-top:10px;gap:6px"><input name="name" placeholder="New step name" required style="flex:1"><button class="btn">+ Add</button></form>`;
      box.querySelector("#donearr").onclick = () => { close(); after?.(); };
      const move = async (i, d) => { [list[i], list[i + d]] = [list[i + d], list[i]]; focusId = list[i + d].id; draw(); await persist(); log("reorder_steps", "job", j.id, { order: list.map((s) => s.name) }); };
      box.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => move(Number(b.dataset.up), -1)));
      box.querySelectorAll("[data-down]").forEach((b) => (b.onclick = () => move(Number(b.dataset.down), 1)));
      box.querySelectorAll("[data-ren]").forEach((b) => (b.onclick = async () => {
        const s = list.find((x) => x.id === b.dataset.ren);
        const name = prompt("New name for this process:", s.name)?.trim();
        if (!name || name === s.name) return;
        const everywhere = confirm(`Rename "${s.name}" to "${name}" on EVERY job and in the standard list?\n\nOK = everywhere (keeps the time averages together)\nCancel = just this job`);
        if (everywhere) {
          const { data: n, error } = await sb.rpc("rename_process", { p_old: s.name, p_new: name });
          if (error) return toast(error.message);
          toast(`Renamed on ${n} job step${n === 1 ? "" : "s"}`);
        } else {
          const { error } = await sb.from("job_steps").update({ name }).eq("id", s.id);
          if (error) return toast(error.message);
          log("rename_step", "job", j.id, { from: s.name, to: name });
        }
        s.name = name; focusId = s.id; draw();
      }));
      box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
        const s = list.find((x) => x.id === b.dataset.del);
        const { count } = await sb.from("job_timers").select("id", { count: "exact", head: true }).eq("step_id", s.id);
        if (!confirm(`Remove "${s.name}" from this job?${count ? ` Its ${count} time entr${count > 1 ? "ies" : "y"} and notes will be deleted too.` : ""}`)) return;
        const { error } = await sb.from("job_steps").delete().eq("id", s.id);
        if (error) return toast(error.message);
        log("delete_step", "job", j.id, { name: s.name, timers: count ?? 0 });
        list = list.filter((x) => x.id !== s.id); draw(); await persist();
      }));
      box.querySelector("#addst").onsubmit = async (e) => {
        e.preventDefault();
        const name = formData(e.target).name.trim(); if (!name) return;
        const at = focusId ? list.findIndex((x) => x.id === focusId) + 1 : list.length;
        const { data, error } = await sb.from("job_steps").insert({ job_id: j.id, name, position: at, done_qty: 0 }).select().single();
        if (error) return toast(error.message);
        list.splice(at, 0, data); focusId = data.id; log("add_step", "job", j.id, { name }); draw(); await persist();
      };
    };
    draw();
  });
}

// Admins: fix a process timer someone got wrong (times, pieces, step) or delete it.
// Piece counts on the steps move with the change so job progress stays right.
function editTimer(t, steps, after) {
  const local = (iso) => { if (!iso) return ""; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  sheet(`<form class="stack" id="tf">
    <h2>Fix time: ${esc(nameOf(t.user_id))}</h2>
    <div><label>Step</label><select name="step_id">${steps.map((s) => `<option value="${s.id}" ${s.id === t.step_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
    <div class="grid2">
      <div><label>Started</label><input type="datetime-local" name="started_at" value="${local(t.started_at)}" required></div>
      <div><label>Stopped</label><input type="datetime-local" name="ended_at" value="${local(t.ended_at)}"></div>
    </div>
    <div class="grid2">
      <div><label>Pieces</label><input type="number" min="0" step="1" name="pieces" value="${t.pieces ?? ""}"></div>
      <div><label>Men on it</label><input type="number" min="1" max="10" step="1" name="crew" value="${t.crew ?? 1}" required></div>
      <div><label>Note</label><input name="note" value="${esc(t.note ?? "")}"></div>
    </div>
    <p class="small muted" style="margin:0">Leave "Stopped" empty only if the timer is still running.</p>
    <div class="row between"><button type="button" class="btn danger" id="tdel">Delete</button>
      <span class="row" style="gap:6px"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></span></div>
  </form>`, (root, close) => {
    const fixCounts = async (stepId, delta) => {
      if (!delta) return;
      const s = steps.find((x) => x.id === stepId); if (!s) return;
      const next = Math.max(0, Number(s.done_qty) + delta);
      await sb.from("job_steps").update({ done_qty: next }).eq("id", stepId);
      s.done_qty = next;
    };
    root.querySelector("#tf").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const start = new Date(f.started_at), end = f.ended_at ? new Date(f.ended_at) : null;
      if (end && end <= start) return toast("Stopped has to be after started.");
      if (end && end - start > 16 * 36e5) return toast("That's over 16 hours. Check the times.");
      const pieces = f.pieces === "" ? null : Math.max(0, Math.round(Number(f.pieces)));
      const { error } = await sb.from("job_timers").update({
        step_id: f.step_id, started_at: start.toISOString(), ended_at: end ? end.toISOString() : null, pieces, note: f.note || null,
        crew: Math.min(10, Math.max(1, Math.round(Number(f.crew) || 1))),
      }).eq("id", t.id);
      if (error) return toast(error.message);
      // Move the piece count: take the old pieces off the old step, add the new pieces to the new step.
      if (t.step_id === f.step_id) await fixCounts(f.step_id, (pieces ?? 0) - (t.pieces ?? 0));
      else { await fixCounts(t.step_id, -(t.pieces ?? 0)); await fixCounts(f.step_id, pieces ?? 0); }
      log("edit_timer", "job_timer", t.id, { from: { start: t.started_at, end: t.ended_at, pieces: t.pieces, step: t.step_id }, to: { start: start.toISOString(), end: end?.toISOString() ?? null, pieces, step: f.step_id } });
      toast("Time fixed"); close(); after?.();
    };
    root.querySelector("#tdel").onclick = async () => {
      if (!confirm(`Delete this time entry for ${nameOf(t.user_id)}? Its ${t.pieces ?? 0} pieces come off the step too.`)) return;
      const { error } = await sb.from("job_timers").delete().eq("id", t.id);
      if (error) return toast(error.message);
      await fixCounts(t.step_id, -(t.pieces ?? 0));
      log("delete_timer", "job_timer", t.id, { start: t.started_at, end: t.ended_at, pieces: t.pieces });
      toast("Deleted"); close(); after?.();
    };
  });
}

async function editJob(j = {}, done, steps = null) {
  const people = (state.cache.profiles ?? []).filter((p) => p.active && p.role !== "pending");
  const { data: past } = await sb.from("jobs").select("product").not("product", "is", null).limit(200);
  const fin = seesMoney() && j.id ? (await sb.from("job_financials").select("*").eq("job_id", j.id).maybeSingle()).data ?? {} : {};
  const stdSteps = j.id ? [] : ((await sb.from("process_names").select("name").order("position")).data ?? []).map((p) => p.name);
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
      ${j.id ? "" : `<div><label>Steps (one per line, in order)</label><textarea name="steps" style="min-height:170px">${(stdSteps.length ? stdSteps : DEFAULT_STEPS).join("\n")}</textarea>
        <p class="small muted" style="margin:4px 0 0">Use the same step names every time so the timing averages line up.</p></div>`}
      <div><label>Notes (everyone sees these, no prices)</label><textarea name="notes" style="min-height:70px">${esc(j.notes)}</textarea></div>
      ${seesMoney() ? `<div class="card stack" style="padding:10px"><div class="small muted">💲 Pricing (only you and Brittany see this)</div>
        <div class="grid2"><div><label>Price each</label><input name="unit_price" type="number" step="0.01" value="${esc(fin.unit_price)}"></div>
          <div><label>Job total</label><input name="line_total" type="number" step="0.01" value="${esc(fin.line_total)}" placeholder="auto = price x pieces"></div></div>
        <div><label>PO / pricing notes</label><textarea name="money_notes" style="min-height:60px">${esc(fin.money_notes)}</textarea></div></div>` : ""}
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>
        ${j.id && can("admin") ? '<button type="button" class="btn danger" id="del">Delete</button>' : ""}</div>
    </form>`, (root, close) => {
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const row = { title: f.title, product: f.product || null, quantity: Math.max(1, Math.round(Number(f.quantity))), customer: f.customer || null,
        channel: f.channel, due_date: f.due_date || null, priority: f.priority, assigned_to: f.assigned_to || null, notes: f.notes || null };
      if (!j.id) { row.status = "Active"; if (j.shopify_order_id) row.shopify_order_id = j.shopify_order_id; }
      const res = j.id ? await sb.from("jobs").update(row).eq("id", j.id).select().single() : await sb.from("jobs").insert(row).select().single();
      if (res.error) return toast(res.error.message);
      if (seesMoney() && (f.unit_price !== "" || f.line_total !== "" || f.money_notes)) {
        const up = f.unit_price === "" ? null : Number(f.unit_price);
        const tot = f.line_total !== "" ? Number(f.line_total) : up != null ? +(up * row.quantity).toFixed(2) : null;
        const r3 = await sb.from("job_financials").upsert({ job_id: res.data.id, unit_price: up, line_total: tot, money_notes: f.money_notes || null, updated_at: new Date().toISOString() });
        if (r3.error) toast("Job saved, pricing didn't: " + r3.error.message);
      }
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
  const { data: items } = await sb.from("inventory_items").select("*").in("source", ["shopify", "product"]).order("category").order("name");
  state.cache.inventory = items ?? [];
  let suppliers = [];
  if (can("lead")) suppliers = (await sb.from("suppliers").select("id, name").order("name")).data ?? [];
  state.cache.suppliers = suppliers;
  const q = invQ.toLowerCase();
  if (invCat !== "All" && invCat !== "Low") invCat = "All";
  const list = (items ?? []).filter((i) =>
    (invCat === "All" || isLow(i)) &&
    (!q || [i.name, i.sku, i.species, i.thickness, i.location].join(" ").toLowerCase().includes(q)));
  const lastSync = (items ?? []).filter((i) => i.synced_at).map((i) => i.synced_at).sort().pop();
  root.innerHTML = `
    ${topbar("Products", (canInv() ? '<button class="btn sm primary" id="newprod">+ Product</button>' : "") + (canInv() ? '<button class="btn sm" id="sync">Sync Shopify</button>' : ""))}
    ${productTabs()}
    <input id="q" placeholder="Search boards, SKU…" value="${esc(invQ)}" style="margin-bottom:10px">
    ${lastSync ? `<p class="small muted" style="margin:0 0 8px">Product counts come from Shopify · last synced ${new Date(lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>` : ""}
    <div class="chips">${["All", "Low"].map((c) => `<button class="chip ${c === invCat ? "active" : ""}" data-c="${c}">${c}</button>`).join("")}</div>
    ${invCat === "Low" && list.length ? (() => {
      const toBuild = list.reduce((a, i) => a + (i.reorder_qty ? Number(i.reorder_qty) : 0), 0);
      return `<div class="card accent section" style="padding:10px">🔔 <strong>${list.length} product${list.length > 1 ? "s" : ""} under 10.</strong> Time to restock${toBuild ? `: build <strong>${toBuild}</strong> pieces total per the restock numbers below` : ""}.</div>`;
    })() : ""}
    <div style="margin-top:12px">${list.length ? groupedList("web", list, (i) => `
      <div class="item" data-id="${i.id}">
        <div class="row between">
          ${photoSlot(i)}
          <div style="min-width:0;flex:1" data-open="${i.id}"><div class="title">${esc(i.name)} ${isLow(i) ? `<span class="badge warn">Low${i.reorder_qty ? ` · build ${Number(i.reorder_qty)}` : ""}</span>` : ""}</div>
            <div class="small muted">${i.source === "shopify" ? `<span class="badge">Shopify</span> ${esc(i.sku ?? "")}` : i.source === "product" ? `<span class="badge warn">App only</span> ${esc(i.sku ?? "")}` : [i.species, i.thickness, i.location].filter(Boolean).map(esc).join(" · ") || esc(i.category)}</div></div>
          ${i.source === "shopify" ? `<div class="qty"><span class="n ${Number(i.quantity) <= 0 ? "error" : ""}">${Number(i.quantity)} <span class="small muted">${esc(i.unit)}</span></span>${canInv() ? '<button class="btn sm" data-set>Count</button>' : ""}</div>` : !canInv() ? `<div class="qty"><span class="n">${Number(i.quantity)} <span class="small muted">${esc(i.unit)}</span></span></div>` : `
          <div class="qty">
            <button class="btn icon sm" data-adj="-1" aria-label="Decrease">−</button>
            <span class="n">${Number(i.quantity)} <span class="small muted">${esc(i.unit)}</span></span>
            <button class="btn icon sm" data-adj="1" aria-label="Increase">+</button>
          </div>`}
        </div>
      </div>`, invCat === "Low" || !!q) : '<div class="empty">No items yet.</div>'}</div>`;
  wireTopbar(root);
  const qEl = root.querySelector("#q");
  qEl.oninput = () => { invQ = qEl.value; clearTimeout(qEl._t); qEl._t = setTimeout(() => { renderInventory(root).then(() => { const n = root.querySelector("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 250); };
  root.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { invCat = b.dataset.c; renderInventory(root); }));
  wireProductTabs(root);
  wireGroups(root, "web");
  wireSnaps(root, () => renderInventory(root));
  root.querySelector("#new")?.addEventListener("click", () => editItem());
  root.querySelector("#newprod")?.addEventListener("click", () => newAppProduct(() => renderInventory(root)));
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

// Photo slot on product rows: tap to take or pick a picture. Anyone signed in can add one.
function photoSlot(i) {
  return `<label class="pslot" title="${i.photo_url ? "Retake photo" : "Add photo"}" data-snapwrap>
    ${i.photo_url ? `<img src="${esc(i.photo_url)}" alt="">` : "<span>📷</span>"}
    <input type="file" accept="image/*" data-snap="${i.id}" style="display:none"></label>`;
}
function wireSnaps(root, rerender) {
  root.querySelectorAll("[data-snapwrap]").forEach((l) => l.addEventListener("click", (e) => e.stopPropagation()));
  root.querySelectorAll("[data-snap]").forEach((inp) => inp.addEventListener("change", async () => {
    const file = inp.files?.[0]; if (!file) return;
    const slot = inp.closest(".pslot"); slot.classList.add("busy");
    try {
      const blob = await shrinkImage(file, 1200);
      const path = `products/${inp.dataset.snap}-${Date.now()}.jpg`;
      const up = await sb.storage.from("supplies").upload(path, blob, { contentType: blob.type || "image/jpeg" });
      if (up.error) throw up.error;
      const url = sb.storage.from("supplies").getPublicUrl(path).data.publicUrl;
      const { error } = await sb.rpc("set_supply_photo", { p_item: inp.dataset.snap, p_url: url });
      if (error) throw error;
      toast("Photo saved"); rerender();
    } catch (err) { slot.classList.remove("busy"); toast("Photo didn't save: " + (err.message ?? err)); }
  }));
}

// Products added in the app only (not on Shopify / the website). They sit in the WEBSITE INVENTORY list with an "App only" tag.
function newAppProduct(done) {
  let photoFile = null;
  sheet(`<form class="stack" id="np">
    <h2>New product</h2>
    <p class="small muted" style="margin:0">Tracked in the app only. It won't be added to Shopify or the website.</p>
    <div><label>Product name</label><input name="name" required></div>
    <div class="grid2">
      <div><label>On hand</label><input name="quantity" type="number" step="1" min="0" inputmode="numeric" value="0" required></div>
      <div><label>Category</label><select name="category">${INV_CATS.map((c) => `<option>${c}</option>`).join("")}</select></div>
      <div><label>SKU (optional)</label><input name="sku"></div>
      <div><label>Where it's kept (optional)</label><input name="location"></div>
    </div>
    <div class="row" style="gap:10px"><label class="btn sm" style="margin:0;color:var(--text)">📷 Add photo<input type="file" accept="image/*" id="npphoto" style="display:none"></label>
      <img id="npph" style="display:none;width:56px;height:56px;object-fit:cover;border-radius:8px"></div>
    <div><label>Notes (optional)</label><textarea name="notes" style="min-height:60px"></textarea></div>
    <div class="row wrap"><button class="btn primary">Add product</button><button type="button" class="btn" data-close>Cancel</button></div>
  </form>`, (root, close) => {
    root.querySelector("#npphoto").onchange = (e) => { photoFile = e.target.files[0] ?? null; if (photoFile) { const ph = root.querySelector("#npph"); ph.src = URL.createObjectURL(photoFile); ph.style.display = ""; } };
    root.querySelector("#np").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target), btn = e.target.querySelector(".primary");
      btn.disabled = true;
      try {
        const row = { name: f.name, category: f.category, sku: f.sku || null, location: f.location || null, notes: f.notes || null,
          quantity: Math.max(0, Math.round(Number(f.quantity))), unit: "ea", source: "product" };
        if (photoFile) {
          const blob = await shrinkImage(photoFile, 1200);
          const path = `products/${crypto.randomUUID()}.jpg`;
          const up = await sb.storage.from("supplies").upload(path, blob, { contentType: blob.type || "image/jpeg" });
          if (up.error) throw up.error;
          row.photo_url = sb.storage.from("supplies").getPublicUrl(path).data.publicUrl;
        }
        const { data, error } = await sb.from("inventory_items").insert(row).select().single();
        if (error) throw error;
        log("create_inventory", "inventory", data.id, { name: row.name, quantity: row.quantity, app_only: true });
        toast("Product added"); close(); done?.();
      } catch (err) { toast(err.message ?? String(err)); btn.disabled = false; }
    };
  });
}

// Set a wholesale item's count. Items linked to a "Wholesale - ..." Shopify listing write to Shopify too.
async function setWholesaleQty(item, next) {
  next = Math.round(next);
  if (item.shopify_variant_id) {
    const r = await fnCall("shopify-inventory", { action: "set", id: item.id, quantity: next, expected: Number(item.quantity) });
    if (r.error) { toast(r.error); return false; }
    return true;
  }
  const { error } = await sb.from("inventory_items").update({ quantity: next }).eq("id", item.id);
  if (error) { toast(error.message); return false; }
  log("adjust_inventory", "inventory", item.id, { name: item.name, from: Number(item.quantity), to: next, wholesale: true });
  return true;
}

// Collapsible type groups. Start collapsed; a section you open stays open while you work (until the app is reopened).
const openGroups = new Set();
const grpKey = (tab, cat) => `${tab}|${cat}`;
const grpOpen = (tab, cat) => openGroups.has(grpKey(tab, cat));
function groupedList(tab, items, rowHtml, forceOpen) {
  const groups = {};
  items.forEach((i) => (groups[PRODUCT_TYPES.includes(i.category) ? i.category : i.category || "Other"] ??= []).push(i));
  const order = [...PRODUCT_TYPES.filter((c) => groups[c]), ...Object.keys(groups).filter((c) => !PRODUCT_TYPES.includes(c)).sort()];
  return order.map((cat) => {
    const its = groups[cat], low = its.filter(isLow).length, pcs = its.reduce((a, i) => a + Math.max(0, Number(i.quantity)), 0);
    return `<details class="grp" data-grp="${esc(cat)}" ${forceOpen || grpOpen(tab, cat) ? "open" : ""}>
      <summary><span class="grp-arrow" aria-hidden="true">▶</span><span class="grp-name">${esc(cat)}</span>
        <span class="grp-meta">${its.length} item${its.length > 1 ? "s" : ""} · ${pcs} pcs${low && tab === "web" ? ` · <span class="badge warn">${low} low</span>` : ""}</span></summary>
      <div class="list">${its.map(rowHtml).join("")}</div></details>`;
  }).join("");
}
function wireGroups(root, tab) {
  root.querySelectorAll("details.grp").forEach((d) => d.addEventListener("toggle", () => { const k = grpKey(tab, d.dataset.grp); d.open ? openGroups.add(k) : openGroups.delete(k); }));
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
  const prices = await loadItemPrices((items ?? []).map((i) => i.id));
  (items ?? []).forEach((i) => (i.wholesale_price = prices[i.id]?.wholesale_price ?? null));
  const q = whQ.toLowerCase();
  const list = (items ?? []).filter((i) => !q || [i.name, i.category, i.species, i.location, i.notes].join(" ").toLowerCase().includes(q));
  const totalPcs = (items ?? []).reduce((a, i) => a + Number(i.quantity), 0);
  const totalVal = (items ?? []).reduce((a, i) => a + Number(i.quantity) * Number(i.wholesale_price ?? 0), 0);
  root.innerHTML = `
    ${topbar("Products", canInv() ? '<button class="btn sm primary" id="new">+ Product</button>' : "")}
    ${productTabs()}
    <input id="q" placeholder="Search patterns, species, bins…" value="${esc(whQ)}" style="margin-bottom:6px">
    <p class="small muted" style="margin:0 0 8px">Show and distributor stock. ${totalPcs} pieces on hand${totalVal && seesMoney() ? ` · ${money(totalVal)} at wholesale` : ""}. Keep ${WHOLESALE_MIN} of each.</p>
    ${(() => { const low = (items ?? []).filter(isLow); const n = low.reduce((a, i) => a + wholesaleMin(i) - Math.max(0, Number(i.quantity)), 0);
      return low.length ? `<div class="card accent" style="padding:10px;margin-bottom:8px">🔔 <strong>${low.length} item${low.length > 1 ? "s" : ""} under ${WHOLESALE_MIN}.</strong> Build <strong>${n}</strong> pieces to get every item back to ${WHOLESALE_MIN}. It's on the Wholesale build list in Jobs.</div>` : ""; })()}
    ${list.length ? groupedList("wh", list, (i) => `
        <div class="item hold" data-id="${i.id}"><div class="row between">
          ${photoSlot(i)}
          <div style="min-width:0;flex:1" data-open="${i.id}"><div class="title">${esc(i.name)} ${isLow(i) ? `<span class="badge warn">Low · build ${wholesaleMin(i) - Math.max(0, Number(i.quantity))}</span>` : ""}</div>
            <div class="small muted">${i.shopify_variant_id ? '<span class="badge">Shopify</span> ' : ""}${[i.species, i.location, seesMoney() && i.wholesale_price != null ? money(i.wholesale_price) + " ea" : ""].filter(Boolean).map(esc).join(" · ")}</div></div>
          <div class="qty">${canInv() ? '<button class="btn icon sm" data-adj="-1" aria-label="Sold one">−</button>' : ""}
            <span class="n ${Number(i.quantity) <= 0 ? "error" : ""}">${Number(i.quantity)}</span>
            ${canInv() ? '<button class="btn icon sm" data-adj="1" aria-label="Add one">+</button>' : ""}</div>
        </div></div>`, !!q) : `<div class="empty">${(items ?? []).length ? "Nothing matches." : "No wholesale items yet. Tap + Item to add your random-pattern stock."}</div>`}`;
  wireTopbar(root); wireProductTabs(root); wireGroups(root, "wh");
  wireSnaps(root, () => renderWholesale(root));
  const qEl = root.querySelector("#q");
  qEl.oninput = () => { whQ = qEl.value; clearTimeout(qEl._t); qEl._t = setTimeout(() => renderWholesale(root).then(() => { const n = root.querySelector("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 250); };
  const again = () => renderWholesale(root);
  root.querySelector("#new")?.addEventListener("click", () => editWholesale({}, items ?? [], again));
  root.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { const it = items.find((i) => i.id === b.dataset.open); canInv() ? editWholesale(it, items, again) : toast(`${it.name}: ${Number(it.quantity)} on hand`); }));
  root.querySelectorAll("[data-adj]").forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const item = items.find((i) => i.id === b.closest("[data-id]").dataset.id);
    const next = Math.max(0, Number(item.quantity) + Number(b.dataset.adj));
    b.disabled = true;
    const ok = await setWholesaleQty(item, next);
    b.disabled = false;
    if (!ok) return renderWholesale(root);
    item.quantity = next; b.parentElement.querySelector(".n").textContent = next;
  }));
  if (canInv()) root.querySelectorAll(".item.hold").forEach((el) => onHold(el, () => {
    const it = items.find((i) => i.id === el.dataset.id);
    sheet(`<div class="row between"><h2 style="margin:0">${esc(it.name)}</h2><button class="btn sm" data-close>Close</button></div>
      <p class="small muted" style="margin:4px 0 12px">${Number(it.quantity)} on hand</p>
      <div class="stack"><button class="btn" id="count">Set count…</button><button class="btn" id="edit">Edit details</button><button class="btn danger" id="del">Delete</button></div>`, (r, close) => {
      r.querySelector("#count").onclick = async () => {
        const v = prompt(`How many ${it.name} on hand?`, Number(it.quantity)); if (v === null || v.trim() === "" || isNaN(Number(v))) return;
        if (!(await setWholesaleQty(it, Math.max(0, Number(v))))) return; close(); again();
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
  sheet(`
    <form class="stack" id="f"><h2>${i.id ? "Edit wholesale item" : "New wholesale item"}</h2>
      <div><label>Item</label><input name="name" value="${esc(i.name)}" required placeholder="Random pattern end grain 12x16"></div>
      <div class="row" style="align-items:center">
        <img id="ph" src="${esc(i.photo_url ?? "")}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:10px;background:var(--surface-2);${i.photo_url ? "" : "display:none"}">
        <label class="btn sm" style="margin:0;color:var(--text)">${i.photo_url ? "Change photo" : "Add photo"}<input type="file" accept="image/*" capture="environment" id="photo" style="display:none"></label></div>
      <div class="grid2">
        <div><label>Category</label><select name="category" required>${WHOLESALE_CATS.map((c) => `<option ${i.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div><label>Species / pattern</label><input name="species" value="${esc(i.species)}" placeholder="Walnut & maple, random"></div>
        <div><label>On hand</label><input name="quantity" type="number" min="0" step="1" value="${esc(i.quantity ?? 0)}" required></div>
        ${seesMoney() ? `<div><label>Wholesale price (each) 💲</label><input name="wholesale_price" type="number" step="0.01" value="${esc(i.wholesale_price)}"></div>` : ""}
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
      const qtyChanged = i.id && Number(f.quantity) !== Number(i.quantity);
      if (qtyChanged && i.shopify_variant_id && !(await setWholesaleQty(i, Math.max(0, Number(f.quantity))))) return;
      const row = { name: f.name, category: f.category, species: f.species || null, quantity: Number(f.quantity), unit: "ea",
        location: f.location || null, reorder_point: num(f.reorder_point), notes: f.notes || null, source: "wholesale" };
      if (photoFile) {
        const path = `wholesale/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from("supplies").upload(path, await shrinkImage(photoFile, 1200), { contentType: "image/jpeg" });
        if (up.error) return toast("Photo upload failed: " + up.error.message);
        row.photo_url = sb.storage.from("supplies").getPublicUrl(path).data.publicUrl;
      }
      const res = i.id ? await sb.from("inventory_items").update(row).eq("id", i.id).select().single() : await sb.from("inventory_items").insert(row).select().single();
      if (res.error) return toast(res.error.message);
      if (seesMoney() && "wholesale_price" in f) await saveItemPrice(res.data.id, { wholesale_price: num(f.wholesale_price) });
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
      <div><label>Type</label><select name="cat">${[...new Set([...PRODUCT_TYPES, item.category].filter(Boolean))].map((c) => `<option ${item.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <div><label>Restock: build this many when it drops under 10</label><input name="rq" type="number" min="0" step="1" inputmode="numeric" value="${item.reorder_qty ?? ""}"></div>
      <div class="row"><button class="btn primary">Update Shopify</button><button type="button" class="btn" data-close>Cancel</button></div>
    </form>`, (root, close) => {
    const inp = root.querySelector("input"); inp.focus(); inp.select();
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector(".primary"); btn.disabled = true; btn.textContent = "Updating…";
      const rq = e.target.querySelector("[name=rq]").value;
      const cat = e.target.querySelector("[name=cat]").value;
      if (String(item.reorder_qty ?? "") !== rq || cat !== item.category) await sb.from("inventory_items").update({ reorder_qty: rq === "" ? null : Math.round(Number(rq)), category: cat }).eq("id", item.id);
      if (Number(inp.value) === Number(item.quantity)) { toast("Saved"); close(); return renderInventory(listRoot); }
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
        <div><label>Reorder when at or below</label><input name="reorder_point" type="number" step="any" value="${esc(i.reorder_point)}" placeholder="9"></div>
        <div><label>Restock: build this many</label><input name="reorder_qty" type="number" step="1" value="${esc(i.reorder_qty)}"></div>
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
        reorder_point: f.reorder_point === "" ? null : Number(f.reorder_point), reorder_qty: f.reorder_qty === "" || f.reorder_qty == null ? null : Number(f.reorder_qty), supplier_id: f.supplier_id || null });
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
  const prices = await loadItemPrices((items ?? []).map((i) => i.id));
  (items ?? []).forEach((i) => { i.unit_cost = prices[i.id]?.unit_cost ?? null; i.price_notes = prices[i.id]?.price_notes ?? null; });
  const vName = (id) => shortVendor((vendors ?? []).find((v) => v.id === id)?.name ?? "");
  const q = supQ.toLowerCase();
  const list = (items ?? []).filter((i) =>
    (supCat === "All" || (supCat === "Low" ? isLow(i) : supCat === "Vendors" || supCat === "Packaging" ? false : i.category === supCat)) &&
    (!q || [i.name, i.category, i.location, i.vendor_sku, vName(i.supplier_id)].join(" ").toLowerCase().includes(q)));
  const lowCount = (items ?? []).filter(isLow).length;
  const groups = {};
  list.forEach((i) => (groups[i.category] ??= []).push(i));
  const usedCats = SUPPLY_CATS.filter((c) => (items ?? []).some((i) => i.category === c));

  root.innerHTML = `
    ${topbar("Supplies", canInv() ? '<button class="btn sm primary" id="new">+ Supply</button>' : "")}
    <input id="q" placeholder="Search sandpaper, glue, vendor…" value="${esc(supQ)}" style="margin-bottom:10px">
    <div class="chips">${["All", "Low", "Vendors", ...(can("lead") ? ["Packaging"] : []), ...usedCats].map((c) => `<button class="chip ${c === supCat ? "active" : ""}" data-c="${c}">${c === "Low" && lowCount ? `Low (${lowCount})` : c}</button>`).join("")}</div>
    <div id="body" style="margin-top:12px"></div>`;
  const body = root.querySelector("#body");

  if (supCat === "Packaging") {
    renderPackaging(body, items ?? [], () => renderSupplies(root));
  } else if (supCat === "Vendors") {
    body.innerHTML = `${canInv() ? '<div class="row" style="margin-bottom:10px"><button class="btn sm primary" id="newv">+ Vendor</button></div>' : ""}
      <div class="list">${(vendors ?? []).map((v) => {
        const n = (items ?? []).filter((i) => i.supplier_id === v.id);
        return `<div class="item" data-v="${v.id}"><div class="row between"><span class="title">${esc(v.name)}</span><span class="badge">${n.length} item${n.length === 1 ? "" : "s"}</span></div>
          <div class="small muted">${[v.order_method, v.contact_name, v.phone, v.email, v.email2, v.website, v.lead_time_days ? v.lead_time_days + "-day lead time" : ""].filter(Boolean).map(esc).join(" · ")}</div>
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
      <details class="grp" data-grp="${esc(cat)}" ${supCat !== "All" || q || grpOpen("sup", cat) ? "open" : ""}>
      <summary><span class="grp-arrow" aria-hidden="true">▶</span><span class="grp-name">${esc(cat)}</span>
        <span class="grp-meta">${its.length} item${its.length > 1 ? "s" : ""}${its.some(isLow) ? ` · <span class="badge warn">${its.filter(isLow).length} reorder</span>` : ""}</span></summary>
      <div class="list">${its.map((i) => `
        <div class="item hold" data-id="${i.id}">
          <div class="row between">
            ${i.photo_url ? `<img src="${esc(i.photo_url)}" alt="" data-open="${i.id}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0">` : `<div data-open="${i.id}" title="No photo yet. Tap to add one" style="width:48px;height:48px;border-radius:8px;flex-shrink:0;display:grid;place-items:center;background:var(--surface-2);border:1px dashed var(--line);opacity:.7">📷</div>`}
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
        </div>`).join("")}</div></details>`).join("") || `<div class="empty">${(items ?? []).length ? "Nothing matches." : "No supplies tracked yet."}</div>`;
    wireGroups(body, "sup");
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
  let img;
  try { img = await createImageBitmap(file); } catch { return file; }
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
      ${v ? `<tr><th>Vendor</th><td><strong>${esc(v.name)}</strong>${i.vendor_sku ? ` · #${esc(i.vendor_sku)}` : ""}<br><span class="small muted">${[v.order_method, v.phone, v.email, v.email2].filter(Boolean).map(esc).join(" · ")}</span>${v.website ? `<br><a href="${esc(v.website.startsWith("http") ? v.website : "https://" + v.website)}" target="_blank" rel="noopener">${esc(v.website)}</a>` : ""}</td></tr>` : ""}
      ${i.pack_size ? `<tr><th>Comes in</th><td>${esc(i.pack_size)}</td></tr>` : ""}
      ${seesMoney() && i.unit_cost != null ? `<tr><th>Last price 💲</th><td>${money(i.unit_cost)} / ${esc(i.unit)}</td></tr>` : ""}
      ${seesMoney() && i.price_notes ? `<tr><th>Price history 💲</th><td class="small">${esc(i.price_notes)}</td></tr>` : ""}
      ${i.last_ordered ? `<tr><th>Last ordered</th><td>${fmtDate(i.last_ordered)}</td></tr>` : ""}
      ${i.notes ? `<tr><th>Notes</th><td>${esc(i.notes)}</td></tr>` : ""}
    </table>
    <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
      <label class="btn" style="margin:0;color:var(--text)" id="snap">📷 ${i.photo_url ? "Retake photo" : "Take a photo"}<input type="file" accept="image/*" capture="environment" id="snapfile" style="display:none"></label>
      ${canInv() ? '<button class="btn" id="edit">Edit</button>' : ""}
    </div>`,
  (root, close) => {
    root.querySelector("#edit")?.addEventListener("click", () => { close(); editSupply(i, vendors, done); });
    // Anyone can photograph a supply; only the photo changes.
    root.querySelector("#snapfile").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const lbl = root.querySelector("#snap"); lbl.firstChild.textContent = "Uploading… ";
      try {
        const path = `${i.id}-${Date.now()}.jpg`;
        const up = await sb.storage.from("supplies").upload(path, await shrinkImage(file, 1200), { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        const url = sb.storage.from("supplies").getPublicUrl(path).data.publicUrl;
        const { error } = await sb.rpc("set_supply_photo", { p_item: i.id, p_url: url });
        if (error) throw error;
        toast("Photo saved. Thanks!");
        close(); done?.();
      } catch (err) {
        toast("Photo didn't save: " + (err.message ?? err));
        lbl.firstChild.textContent = "📷 Try again";
      }
    });
  });
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
        ${seesMoney() ? `<div><label>Last price per unit 💲</label><input name="unit_cost" type="number" step="0.01" value="${esc(i.unit_cost)}"></div>` : ""}
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
        pack_size: f.pack_size || null, last_ordered: f.last_ordered || null, notes: f.notes || null, source: "hub" };
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
      if (seesMoney() && "unit_cost" in f) await saveItemPrice(res.data.id, { unit_cost: num(f.unit_cost) });
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

// ---------------------------------------------------------------- Packaging (auto-deducted from shipped Shopify orders)
// Recipes say what packaging each product uses. Each night shipped orders are run through
// apply_packaging() in the database, which subtracts the pieces from Supplies once per order.
async function renderPackaging(body, items, redo) {
  const [{ data: rules }, { data: usage }, { data: products }] = await Promise.all([
    sb.from("packaging_rules").select("*").order("match"),
    sb.from("packaging_usage").select("*").order("shipped_at", { ascending: false }).limit(40),
    sb.from("inventory_items").select("name").eq("source", "shopify").order("name"),
  ]);
  const nameOf = (id) => items.find((i) => i.id === id)?.name ?? "(deleted supply)";
  const groups = {};
  (rules ?? []).filter((r) => r.per === "item").forEach((r) => (groups[r.match] ??= []).push(r));
  const extras = (rules ?? []).filter((r) => r.per === "order");
  const canEdit = canInv() || can("admin");
  const missing = {};
  (usage ?? []).forEach((u) => (u.unmatched ?? []).forEach((x) => (missing[x.title] = (missing[x.title] ?? 0) + Number(x.qty || 1))));
  const line = (r) => `${Number(r.qty)} × ${esc(nameOf(r.supply_item_id))}`;
  body.innerHTML = `
    <div class="card"><p class="small muted" style="margin:0">Each night, every Shopify order that shipped subtracts its packaging from Supplies, using the recipes below. Local pickups aren't counted, and each order is only counted once.</p></div>
    <div class="row between" style="margin-top:14px"><h2 class="section" style="margin:0">Every box gets</h2>${canEdit ? '<button class="btn sm" id="extras">Edit</button>' : ""}</div>
    <div class="card" style="margin-top:6px">${extras.map((r) => `<div class="small">${line(r)}</div>`).join("") || '<div class="small muted">Nothing yet.</div>'}</div>
    <div class="row between" style="margin-top:14px"><h2 class="section" style="margin:0">Packing recipes</h2>${canEdit ? '<button class="btn sm primary" id="newr">+ Recipe</button>' : ""}</div>
    ${Object.keys(missing).length ? `<div class="card" style="margin-top:6px;border-color:var(--warn,#c80)"><div class="small"><strong>Shipped without a recipe</strong> (nothing was subtracted for these):</div>
      ${Object.entries(missing).map(([t, n]) => `<div class="row between small" style="margin-top:4px"><span>${esc(t)} <span class="muted">×${n}</span></span>${canEdit ? `<button class="linkbtn" data-add="${esc(t)}">Add recipe</button>` : ""}</div>`).join("")}</div>` : ""}
    <div class="list" style="margin-top:6px">${Object.entries(groups).map(([m, rs]) => `
      <div class="item" data-m="${esc(m)}"><div class="title">${esc(m)}</div><div class="small muted">${rs.map(line).join(" · ")}</div></div>`).join("") || '<div class="empty">No recipes yet.</div>'}</div>
    <h2 class="section">Recent shipments</h2>
    <div class="list">${(usage ?? []).map((u) => `<div class="item" style="cursor:default">
      <div class="row between"><span class="title">${esc(u.order_name ?? u.order_id)}</span><span class="small muted">${u.shipped_at ? fmtDate(u.shipped_at) : ""}</span></div>
      <div class="small muted">${(u.used ?? []).map((x) => `${Number(x.qty)} × ${esc(x.name)}`).join(" · ") || "Nothing subtracted"}</div>
      ${(u.unmatched ?? []).length ? `<div class="small" style="color:var(--warn,#c80)">No recipe: ${u.unmatched.map((x) => esc(x.title)).join(", ")}</div>` : ""}</div>`).join("") || '<div class="empty">No shipments counted yet. The first run is tonight.</div>'}</div>`;
  const pack = items.filter((i) => i.category === "Packaging & shipping");
  body.querySelector("#newr")?.addEventListener("click", () => editPackRecipe("", [], pack, products ?? [], redo));
  body.querySelector("#extras")?.addEventListener("click", () => editPackRecipe("*", extras, pack, products ?? [], redo));
  body.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => editPackRecipe(b.dataset.add, [], pack, products ?? [], redo)));
  if (canEdit) body.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => editPackRecipe(b.dataset.m, groups[b.dataset.m], pack, products ?? [], redo)));
}

function editPackRecipe(match, rows, pack, products, after) {
  const isExtras = match === "*";
  const opts = (sel) => pack.map((i) => `<option value="${i.id}" ${i.id === sel ? "selected" : ""}>${esc(i.name)}</option>`).join("");
  const rowHtml = (r = {}) => `<div class="row pr" style="gap:6px;margin-top:6px"><input type="number" min="0" step="any" class="pq" value="${r.qty != null ? Number(r.qty) : 1}" style="width:64px">
    <select class="ps" style="flex:1">${opts(r.supply_item_id)}</select><button type="button" class="btn icon sm" data-rm aria-label="Remove">✕</button></div>`;
  sheet(`
    <div class="row between"><h2 style="margin:0">${isExtras ? "Every box gets" : match ? "Packing recipe" : "New packing recipe"}</h2><button class="btn sm" data-close>Close</button></div>
    <form id="pf" style="margin-top:10px">
      ${isExtras ? '<p class="small muted">Added once to every shipped order.</p>' : `<label>Product name (or a word in it, like "Chef - End Grain" or "16&quot; x 16&quot;")</label>
        <input name="match" required value="${esc(match)}" list="shopprods"><datalist id="shopprods">${products.map((p) => `<option value="${esc(p.name)}">`).join("")}</datalist>
        <p class="small muted" style="margin:4px 0 0">If more than one recipe matches an item, the most specific (longest) one wins. Pieces per item shipped.</p>`}
      <div id="rows">${(rows.length ? rows : [{}]).map(rowHtml).join("")}</div>
      <button type="button" class="btn sm" id="addrow" style="margin-top:8px">+ Add packaging</button>
      <div class="row between" style="margin-top:14px">${rows.length && !isExtras ? '<button type="button" class="btn danger" id="del">Delete</button>' : "<span></span>"}<button class="btn primary">Save</button></div>
    </form>`, (root, close) => {
    const wireRm = () => root.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => b.closest(".pr").remove()));
    wireRm();
    root.querySelector("#addrow").onclick = () => { root.querySelector("#rows").insertAdjacentHTML("beforeend", rowHtml()); wireRm(); };
    root.querySelector("#pf").onsubmit = async (e) => {
      e.preventDefault();
      const m = isExtras ? "*" : e.target.match.value.trim();
      if (!m || m === "*") return toast("Enter a product name");
      const lines = [...root.querySelectorAll(".pr")].map((r) => ({ match: m, supply_item_id: r.querySelector(".ps").value, qty: Number(r.querySelector(".pq").value), per: isExtras ? "order" : "item" })).filter((r) => r.qty > 0 && r.supply_item_id);
      if (isExtras) await sb.from("packaging_rules").delete().eq("per", "order");
      else {
        await sb.from("packaging_rules").delete().eq("per", "item").eq("match", m);
        if (match && match !== m) await sb.from("packaging_rules").delete().eq("per", "item").eq("match", match);
      }
      if (lines.length) { const { error } = await sb.from("packaging_rules").insert(lines); if (error) return toast(error.message); }
      log("packaging_recipe", "packaging", m, { lines: lines.length });
      toast("Saved"); close(); after?.();
    };
    root.querySelector("#del")?.addEventListener("click", async () => {
      if (!confirm(`Delete the packing recipe for “${match}”?`)) return;
      await sb.from("packaging_rules").delete().eq("per", "item").eq("match", match);
      toast("Deleted"); close(); after?.();
    });
  });
}

async function editVendor(v = {}, done) {
  const vp = seesMoney() && v.id ? (await sb.from("supplier_prices").select("price_notes").eq("supplier_id", v.id).maybeSingle()).data : null;
  sheet(`
    <form class="stack" id="f"><h2>${v.id ? "Edit vendor" : "New vendor"}</h2>
      <div><label>Vendor name</label><input name="name" value="${esc(v.name)}" required></div>
      <div class="grid2">
        <div><label>How we order</label><select name="order_method"><option value="">—</option>${ORDER_METHODS.map((m) => `<option ${v.order_method === m ? "selected" : ""}>${m}</option>`).join("")}</select></div>
        <div><label>Website</label><input name="website" value="${esc(v.website)}"></div>
        <div><label>Contact / rep</label><input name="contact_name" value="${esc(v.contact_name)}"></div>
        <div><label>Phone</label><input name="phone" type="tel" value="${esc(v.phone)}"></div>
        <div><label>Email</label><input name="email" type="email" value="${esc(v.email)}"></div>
        <div><label>Secondary email</label><input name="email2" type="email" value="${esc(v.email2)}"></div>
        <div><label>Our account #</label><input name="account_number" value="${esc(v.account_number)}"></div>
        <div><label>Lead time (days)</label><input name="lead_time_days" type="number" value="${esc(v.lead_time_days)}"></div>
      </div>
      <div><label>Notes (everyone sees these, no prices)</label><textarea name="notes" style="min-height:70px">${esc(v.notes)}</textarea></div>
      ${seesMoney() ? `<div><label>Pricing & quotes 💲 (only you and Brittany)</label><textarea name="price_notes" style="min-height:90px">${esc(vp?.price_notes)}</textarea></div>` : ""}
      <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button></div>
    </form>`, (root, close) => {
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const priceNotes = f.price_notes; delete f.price_notes;
      const row = { ...f, lead_time_days: f.lead_time_days ? Number(f.lead_time_days) : null };
      Object.keys(row).forEach((k) => row[k] === "" && (row[k] = null));
      const res = v.id ? await sb.from("suppliers").update(row).eq("id", v.id).select().single() : await sb.from("suppliers").insert(row).select().single();
      if (res.error) return toast(res.error.message);
      if (seesMoney() && priceNotes !== undefined) {
        const r2 = await sb.from("supplier_prices").upsert({ supplier_id: res.data.id, price_notes: priceNotes || null, updated_at: new Date().toISOString() });
        if (r2.error) toast("Vendor saved, pricing notes didn't: " + r2.error.message);
      }
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
    ${topbar("SOPs", isOwner() ? '<button class="btn sm primary" id="new">+ SOP</button>' : "")}
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
    <div class="row between"><span class="badge">${esc(s.category)}</span><span class="row" style="gap:6px">${isOwner() ? '<button class="btn sm primary" id="edit">✎ Edit</button>' : ""}<button class="btn sm" data-close>Close</button></span></div>
    <h1 style="margin-top:10px">${esc(s.title)}</h1>
    <div class="prose">${md(s.body)}</div>
    ${(s.photos ?? []).length ? `<h2 class="section">Photos &amp; diagrams</h2>
      <div class="sop-photos">${s.photos.map((p, n) => `<figure data-ph="${n}"><img src="${esc(p.url)}" alt="${esc(p.caption || s.title)}" loading="lazy">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : ""}
    ${isOwner() ? '<div class="row" style="margin-top:14px"><button class="btn" id="edit2">✎ Edit this SOP</button></div>' : ""}`,
  (root, close) => {
    ["#edit", "#edit2"].forEach((id) => root.querySelector(id)?.addEventListener("click", () => { close(); editSop(s); }));
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
  const close = trackOverlay(() => { d.remove(); document.removeEventListener("keydown", key); });
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
// Parses "1 3/4", "3/4", "1.75", "1-3/4", "8/4" -> number (inches)
function parseLen(v) {
  v = String(v ?? "").trim().replace(/["”]/g, "").replace(/(\d)-(\d+\/)/, "$1 $2");
  if (!v) return NaN;
  const m = v.match(/^(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?$/);
  if (!m || (!m[1] && !m[2])) return NaN;
  return (m[1] ? +m[1] : 0) + (m[2] ? +m[2] / +m[3] : 0);
}
// inches -> nearest 1/den as a reduced fraction string
function toFrac(inches, den = 32) {
  const neg = inches < 0; let n = Math.round(Math.abs(inches) * den);
  const whole = Math.floor(n / den); let r = n % den, d = den;
  while (r && r % 2 === 0) { r /= 2; d /= 2; }
  const s = (whole ? whole : "") + (r ? `${whole ? " " : ""}${r}/${d}` : "") || "0";
  return (neg ? "-" : "") + s + '"';
}
const fmtN = (n, p = 2) => (Math.round(n * 10 ** p) / 10 ** p).toLocaleString(undefined, { maximumFractionDigits: p });

// Epoxy per piece, from the shop whiteboard (Nov 2026)
const EPOXY_RATES = [
  { label: '24" rails', short: '24" rails', oz: 1, per: "each" },
  { label: '16" rails', short: '16" rails', oz: 0.8, per: "each" },
  { label: "Countertop stands", short: "stands", oz: 0.5, per: "each" },
  { label: "Knife blocks (tables)", short: "knife block tables", oz: 25, per: "per table" },
];

function renderCalcs(el) {
  el.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Board Foot Calculator</h3>
      <div class="chips" style="flex-wrap:wrap;margin-bottom:8px">${["4/4", "5/4", "6/4", "8/4", "10/4", "12/4", "16/4"].map((q) => `<button type="button" class="chip" data-q="${q}">${q}</button>`).join("")}</div>
      <div class="grid2">
        <div><label>Thickness (in)</label><input id="bt" inputmode="decimal" placeholder='e.g. 1 3/4 or 8/4' value="1"></div>
        <div><label>Width (in)</label><input id="bw" inputmode="decimal" placeholder="e.g. 6 1/2"></div>
        <div><label>Length</label><div class="row"><input id="bl" inputmode="decimal" placeholder="e.g. 96" style="flex:1"><select id="blu" style="width:auto"><option value="in">in</option><option value="ft">ft</option></select></div></div>
        <div><label>Pieces</label><input id="bq" inputmode="numeric" value="1"></div>
      </div>
      <div id="bfout" class="calc-out"></div>
      <p class="small muted" style="margin-bottom:0">Board feet = thickness × width × length (in) ÷ 144. Quarters: 4/4 = 1", 8/4 = 2".</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">MM ⇄ Inch Converter</h3>
      <div class="grid2">
        <div><label>Millimeters</label><input id="mm" inputmode="decimal" placeholder="e.g. 19"></div>
        <div><label>Inches (decimal or fraction)</label><input id="inch" inputmode="decimal" placeholder='e.g. 3/4 or 1.5'></div>
      </div>
      <div id="mmout" class="calc-out"></div>
      <p class="small muted" style="margin-bottom:0">Fractions are rounded to the nearest 1/32".</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Epoxy Calculator</h3>
      <div class="grid2">${EPOXY_RATES.map((r, i) => `<div><label>${r.label} <span class="muted" style="font-weight:400">(${r.oz} oz ${r.per})</span></label><input data-ep="${i}" inputmode="numeric" placeholder="0"></div>`).join("")}</div>
      <div id="epout" class="calc-out"></div>
      <p class="small muted" style="margin-bottom:0">Total mixed epoxy, from the shop's whiteboard amounts.</p>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const bf = () => {
    const t = parseLen($("#bt").value), w = parseLen($("#bw").value);
    let l = parseLen($("#bl").value); if ($("#blu").value === "ft") l *= 12;
    const q = parseLen($("#bq").value) || 1;
    if (!(t > 0 && w > 0 && l > 0)) { $("#bfout").innerHTML = '<span class="muted">Enter thickness, width and length.</span>'; return; }
    const each = (t * w * l) / 144;
    $("#bfout").innerHTML = `<div class="calc-big">${fmtN(each * q)} BF</div><div class="small muted">${q > 1 ? `${fmtN(each)} BF each × ${q} pcs · ` : ""}${fmtN(l / 12)} ft long</div>`;
  };
  ["#bt", "#bw", "#bl", "#bq"].forEach((s) => ($(s).oninput = bf));
  $("#blu").onchange = bf;
  el.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { $("#bt").value = b.dataset.q; bf(); }));
  const showIn = (inches, mm) => {
    const frac = toFrac(inches), off = (Math.round(inches * 32) / 32 - inches) * 25.4;
    $("#mmout").innerHTML = `<div class="calc-big">${fmtN(mm)} mm = ${frac}</div><div class="small muted">${fmtN(inches, 4)}" decimal${Math.abs(off) > 0.005 ? ` · fraction is ${off > 0 ? "+" : ""}${fmtN(off)} mm off` : " · exact"}</div>`;
  };
  $("#mm").oninput = () => {
    const mm = parseFloat($("#mm").value);
    if (!(mm >= 0)) { $("#mmout").innerHTML = ""; $("#inch").value = ""; return; }
    $("#inch").value = fmtN(mm / 25.4, 4); showIn(mm / 25.4, mm);
  };
  $("#inch").oninput = () => {
    const i = parseLen($("#inch").value);
    if (!(i >= 0)) { $("#mmout").innerHTML = ""; $("#mm").value = ""; return; }
    $("#mm").value = fmtN(i * 25.4); showIn(i, i * 25.4);
  };
  const ep = () => {
    let tot = 0; const parts = [];
    el.querySelectorAll("[data-ep]").forEach((inp) => {
      const n = parseFloat(inp.value) || 0, r = EPOXY_RATES[+inp.dataset.ep];
      if (n > 0) { tot += n * r.oz; parts.push(`${n} ${r.short} × ${r.oz} oz = ${fmtN(n * r.oz, 1)} oz`); }
    });
    $("#epout").innerHTML = tot ? `<div class="calc-big">${fmtN(tot, 1)} oz epoxy</div><div class="small muted">${parts.join("<br>")}</div>` : '<span class="muted">Enter how many pieces you\'re pouring.</span>';
  };
  el.querySelectorAll("[data-ep]").forEach((i) => (i.oninput = ep));
  bf(); ep();
}

async function renderAsk(root) {
  if (state.askTab === "calc") {
    root.innerHTML = `${topbar("Ask")}<div class="seg" id="asktab" style="margin-bottom:10px"><button data-t="chat">ASK CLAUDE</button><button class="active" data-t="calc">CALCULATORS</button></div><div id="calcs"></div>`;
    wireTopbar(root);
    root.querySelectorAll("#asktab [data-t]").forEach((b) => (b.onclick = () => { state.askTab = b.dataset.t; renderAsk(root); }));
    renderCalcs(root.querySelector("#calcs"));
    return;
  }
  const bubbles = () => state.chat.map((m) => `<div class="bubble ${m.role === "user" ? "me" : "ai"}">${esc(m.content)}</div>`).join("");
  root.innerHTML = `
    ${topbar("Ask Claude", state.chat.length ? '<button class="btn sm" id="clear">New chat</button>' : "")}
    <div class="seg" id="asktab" style="margin-bottom:10px"><button class="active" data-t="chat">ASK CLAUDE</button><button data-t="calc">CALCULATORS</button></div>
    ${state.chat.length ? "" : `<div class="card"><p style="margin-top:0">Ask about procedures, inventory, jobs or reminders. Answers come from the hub's own records.</p>
      <div class="chips" style="flex-wrap:wrap">${["What's the finish schedule for walnut?", "How much 8/4 maple do we have?", "Which jobs are due this week?"].map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`}
    <div class="chat" id="chat">${bubbles()}</div>
    <form class="composer" id="f"><input name="q" placeholder="Ask a question…" autocomplete="off" required><button class="btn primary">Ask</button></form>
    <p class="small muted" id="left"></p>`;
  wireTopbar(root);
  const form = root.querySelector("#f");
  const input = form.querySelector("input");
  root.querySelector("#clear")?.addEventListener("click", () => { state.chat = []; renderAsk(root); });
  root.querySelectorAll("#asktab [data-t]").forEach((b) => (b.onclick = () => { state.askTab = b.dataset.t; renderAsk(root); }));
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
    ...(OFFICE ? [] : [{ k: "hours", label: "My hours & time off" }]),
    { k: "handbook", label: "📘 Employee handbook" },
    ...(isOwner() ? [{ k: "processes", label: "Processes (names & order)" }] : []),
    ...(can("admin") ? [{ k: "timeclock", label: "Time clock & calendar (everyone)" }, { k: "requests", label: "Time card edit requests" }, { k: "admininfo", label: "Admin info (passwords & logins)" }, { k: "team", label: "Team & logins" }, { k: "activity", label: "Activity & usage" }] : []),
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
    await ({ handbook: renderHandbook, processes: renderProcesses, account: renderAccount, hours: renderMyHours, timeclock: renderTimeclockAdmin, requests: renderTimecardRequests, admininfo: renderAdminInfo, suppliers: renderSuppliers, team: renderTeam, activity: renderActivity }[k])(sec);
  };
  root.querySelectorAll("[data-sec]").forEach((b) => (b.onclick = () => open(b.dataset.sec)));
  open(state.moreOpen || "account"); state.moreOpen = null;
}

// Owner: the standard process list new jobs start with. Renaming here renames it on every job too.
async function renderProcesses(root) {
  const { data } = await sb.from("process_names").select("*").order("position");
  let list = data ?? [];
  const { data: used } = await sb.from("job_steps").select("name");
  const counts = {}; (used ?? []).forEach((r) => (counts[r.name] = (counts[r.name] ?? 0) + 1));
  const extra = Object.keys(counts).filter((n) => !list.some((p) => p.name === n)).sort();
  const save = async () => { for (const [i, p] of list.entries()) if (p.position !== i) { await sb.from("process_names").update({ position: i }).eq("name", p.name); p.position = i; } };
  root.innerHTML = `<div class="card stack">
    <h2 style="margin:0">Processes</h2>
    <p class="small muted" style="margin:0">The standard steps every new job starts with, in order. Renaming one renames it on every job, so the time averages stay together. To change a single job, open it and press and hold a step.</p>
    <div class="list">${list.map((p, i) => `<div class="item" style="cursor:default"><div class="row between" style="gap:6px">
      <span class="title" style="flex:1;min-width:0">${i + 1}. ${esc(p.name)} <span class="small muted">${counts[p.name] ? `on ${counts[p.name]} job${counts[p.name] > 1 ? "s" : ""}` : "not used yet"}</span></span>
      <span class="row" style="gap:4px">
        <button class="btn icon sm" data-up="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
        <button class="btn icon sm" data-down="${i}" ${i === list.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
        <button class="btn icon sm" data-ren="${esc(p.name)}" aria-label="Rename">✎</button>
        <button class="btn icon sm" data-del="${esc(p.name)}" aria-label="Remove from standard list">🗑</button></span></div></div>`).join("")}</div>
    <form class="row" id="addp" style="gap:6px"><input name="name" placeholder="New process" required style="flex:1"><button class="btn">+ Add</button></form>
    ${extra.length ? `<div><div class="small muted" style="margin-bottom:4px">Other names used on jobs (not in the standard list). Tap to rename everywhere:</div>
      <div class="chips">${extra.map((n) => `<button class="chip" data-ren="${esc(n)}">${esc(n)} · ${counts[n]}</button>`).join("")}</div></div>` : ""}
  </div>`;
  const again = () => renderProcesses(root);
  const move = async (i, d) => { [list[i], list[i + d]] = [list[i + d], list[i]]; await save(); again(); };
  root.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => move(Number(b.dataset.up), -1)));
  root.querySelectorAll("[data-down]").forEach((b) => (b.onclick = () => move(Number(b.dataset.down), 1)));
  root.querySelectorAll("[data-ren]").forEach((b) => (b.onclick = async () => {
    const old = b.dataset.ren;
    const name = prompt(`Rename "${old}" on every job to:`, old)?.trim();
    if (!name || name === old) return;
    const { data: n, error } = await sb.rpc("rename_process", { p_old: old, p_new: name });
    if (error) return toast(error.message);
    toast(`Renamed. ${n} job step${n === 1 ? "" : "s"} updated.`); again();
  }));
  root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Take "${b.dataset.del}" off the standard list? Jobs that already have it keep it.`)) return;
    const { error } = await sb.from("process_names").delete().eq("name", b.dataset.del);
    if (error) return toast(error.message); again();
  }));
  root.querySelector("#addp").onsubmit = async (e) => {
    e.preventDefault();
    const name = formData(e.target).name.trim(); if (!name) return;
    const { error } = await sb.from("process_names").insert({ name, position: list.length });
    if (error) return toast(error.message.includes("duplicate") ? "That one's already on the list." : error.message); again();
  };
}

async function renderAccount(root) {
  const p = state.profile;
  root.innerHTML = `<div class="card stack">
    <div><div class="title" style="font-weight:700">${esc(p.full_name || p.email)}</div>
      <div class="small muted">${esc(p.email)} · ${ROLE_LABEL[p.role]}${p.title ? " · " + esc(p.title) : ""}</div></div>
    <div class="card" style="padding:10px;margin:0"><div class="row between"><span>🔔 Notifications <span class="small muted" id="nstate"></span></span><button class="btn sm primary" id="notif">Turn on</button></div>
      <p class="small muted" style="margin:4px 0 0">Lets this phone or computer get alerts (like the laser being done), even when it's locked.</p></div>
    <div><label>App colors <span class="small muted">(this phone/computer)</span></label>
      <div class="seg" id="theme">${[["forest", "🌲 Forest green"], ["classic", "Classic walnut"]].map(([k, l]) => `<button type="button" data-t="${k}" class="${getTheme() === k ? "active" : ""}">${l}</button>`).join("")}</div></div>
    <div class="row wrap"><button class="btn" id="pw">Change password</button><button class="btn" id="out">Sign out</button>
      ${OFFICE ? '<button class="btn" id="leaveoffice">Turn off office mode</button>' : ""}</div>
    ${OFFICE ? '<p class="small muted" style="margin:0">This computer is in office mode: no time clock or job timers. It stays signed in until someone taps Sign out.</p>' : ""}
    <p class="small muted" style="margin:0">To install: on iPhone, tap Share → Add to Home Screen. On Android or desktop Chrome, use the install icon in the address bar.</p>
  </div>`;
  root.querySelector("#pw").onclick = () => renderChangePassword(false);
  root.querySelectorAll("#theme [data-t]").forEach((b) => (b.onclick = () => {
    try { localStorage.setItem("mb_theme", b.dataset.t); } catch {}
    applyTheme(b.dataset.t);
    root.querySelectorAll("#theme [data-t]").forEach((x) => x.classList.toggle("active", x === b));
  }));
  root.querySelector("#out").onclick = () => sb.auth.signOut();
  const nState = () => {
    const el = root.querySelector("#nstate"), btn = root.querySelector("#notif");
    const p = "Notification" in window ? Notification.permission : "unsupported";
    el.textContent = p === "granted" ? "· on" : p === "denied" ? "· blocked" : p === "unsupported" ? "· not available here" : "· off";
    btn.textContent = p === "granted" ? "Send test" : "Turn on";
  };
  nState();
  root.querySelector("#notif").onclick = async () => {
    const r = await enablePush(); nState();
    if (r !== "ok") return toast(pushHelp(r));
    try { (await navigator.serviceWorker.ready).showNotification("Montana Block Hub", { body: "Notifications are on for this device. 👍", tag: "test" }); } catch {}
    toast("Notifications are on");
  };
  root.querySelector("#leaveoffice")?.addEventListener("click", () => { location.href = location.pathname + "?office=0"; });
}

// Week starts Monday, shop time
function weekStart(offsetWeeks = 0) {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Denver" }));
  d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offsetWeeks * 7);
  return d;
}
const entryMs = (e) => (e.clock_out ? new Date(e.clock_out) : new Date()) - new Date(e.clock_in) - (e._unpaid ?? 0);
// Unpaid breaks (lunch) come off the shift, same as Square payroll.
async function attachBreaks(entries) {
  const ids = (entries ?? []).map((e) => e.id);
  if (!ids.length) return entries;
  const { data } = await sb.from("time_breaks").select("entry_id, paid, start_at, end_at").in("entry_id", ids);
  const by = {};
  (data ?? []).filter((b) => !b.paid).forEach((b) => (by[b.entry_id] = (by[b.entry_id] ?? 0) + ((b.end_at ? new Date(b.end_at) : new Date()) - new Date(b.start_at))));
  entries.forEach((e) => (e._unpaid = by[e.id] ?? 0));
  return entries;
}
const sqBadge = (e) => e.square_status === "synced" ? '<span class="badge ok">Square ✓</span>' : e.square_status === "error" ? `<span class="badge bad" title="${esc(e.square_error)}">Square ✗</span>` : '<span class="badge">Not in Square yet</span>';

async function renderMyHours(root) {
  await loadProfiles();
  await renderMyHoursInner(root);
  await renderMyTimeOff(root);
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

// ---------------------------------------------------------------- Time off
const dayKey = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/Denver" });
const fmtRange = (a, b) => a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`;
const offKind = (r) => r.paid ? "Paid time off" : "Unpaid day off";
const offStatus = (r) => r.status === "approved" ? '<span class="badge ok">Approved</span>' : r.status === "denied" ? '<span class="badge bad">Denied</span>' : '<span class="badge warn">Waiting</span>';
function workDays(a, b) { let n = 0; for (let d = new Date(a + "T12:00"); d <= new Date(b + "T12:00"); d.setDate(d.getDate() + 1)) if (d.getDay() % 6) n++; return n; }

async function renderMyTimeOff(root) {
  const { data } = await sb.from("time_off_requests").select("*").eq("user_id", state.profile.id).order("start_date", { ascending: false }).limit(20);
  const list = data ?? [];
  root.insertAdjacentHTML("afterbegin", `<div class="card stack" style="margin-bottom:12px" id="tocard">
    <div class="row between"><h2 style="margin:0">🌴 Time off</h2>${RO() ? "" : '<button class="btn sm primary" id="reqoff">Request time off</button>'}</div>
    ${list.length ? `<table><tr><th>Dates</th><th>Type</th><th>Status</th></tr>${list.map((r) => `<tr><td>${fmtRange(r.start_date, r.end_date)}${r.hours ? `<br><span class="small muted">${r.hours} hrs</span>` : ""}</td>
      <td class="small">${offKind(r)}${r.reason ? `<br><span class="muted">${esc(r.reason)}</span>` : ""}${r.decision_note ? `<br><span class="muted">↳ ${esc(r.decision_note)}</span>` : ""}</td>
      <td>${offStatus(r)}${r.status === "pending" && !RO() ? `<br><button class="btn sm" data-cancel="${r.id}" style="margin-top:4px">Cancel</button>` : ""}</td></tr>`).join("")}</table>`
      : '<p class="small muted" style="margin:0">Need a day off? Send a request and Mitchell or Brittany will approve it.</p>'}
  </div>`);
  const card = root.querySelector("#tocard");
  card.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Cancel this time off request?")) return;
    const { error } = await sb.from("time_off_requests").delete().eq("id", b.dataset.cancel);
    if (error) return toast(error.message);
    card.remove(); renderMyTimeOff(root);
  }));
  card.querySelector("#reqoff")?.addEventListener("click", () => timeOffForm(null, () => { card.remove(); renderMyTimeOff(root); }));
}
// Employees request their own; admins can also add time off for anyone (pre-approved).
function timeOffForm(forUser, done) {
  const admin = can("admin") && forUser !== null;
  const people = (state.cache.profiles ?? []).filter((p) => p.active && p.role !== "pending" && !/guest/i.test(p.full_name ?? ""));
  const t = today();
  sheet(`<form class="stack" id="tof"><h2 style="margin:0">${admin ? "Add time off" : "Request time off"}</h2>
    ${admin ? `<div><label>Who</label><select name="user_id">${people.map((p) => `<option value="${p.id}" ${p.id === forUser ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></div>` : ""}
    <div class="grid2"><div><label>First day off</label><input type="date" name="start_date" required value="${t}"></div>
      <div><label>Last day off</label><input type="date" name="end_date" required value="${t}"></div></div>
    <div><label>Type</label><div class="seg" id="tkind"><button type="button" data-p="0" class="active">Unpaid day off</button><button type="button" data-p="1">Paid time off (PTO)</button></div></div>
    <div><label>Partial day? Hours off (optional)</label><input name="hours" type="number" step="0.5" min="0" inputmode="decimal" placeholder="Leave blank for full days"></div>
    <div><label>Reason (optional)</label><input name="reason" placeholder="e.g. Doctor appointment, family trip"></div>
    <div class="row"><button class="btn primary">${admin ? "Add (approved)" : "Send request"}</button><button type="button" class="btn" data-close>Cancel</button></div>
  </form>`, (r, close) => {
    let paid = false;
    r.querySelectorAll("#tkind [data-p]").forEach((b) => (b.onclick = () => { paid = b.dataset.p === "1"; r.querySelectorAll("#tkind [data-p]").forEach((x) => x.classList.toggle("active", x === b)); }));
    const s = r.querySelector('[name="start_date"]'), e2 = r.querySelector('[name="end_date"]');
    s.onchange = () => { if (e2.value < s.value) e2.value = s.value; };
    r.querySelector("#tof").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      if (f.end_date < f.start_date) return toast("Last day is before the first day");
      const row = { user_id: admin ? f.user_id : state.profile.id, start_date: f.start_date, end_date: f.end_date, paid, hours: f.hours ? Number(f.hours) : null, reason: f.reason || null };
      if (admin) Object.assign(row, { status: "approved", decided_by: state.profile.id, decided_at: new Date().toISOString() });
      const { error } = await sb.from("time_off_requests").insert(row);
      if (error) return toast(error.message);
      log("time_off_request", "time_off", null, { dates: fmtRange(row.start_date, row.end_date), paid });
      toast(admin ? "Added to the calendar" : "Sent. You'll see it here when it's approved."); close(); done?.();
    };
  });
}
async function decideTimeOff(r, status, done) {
  const note = status === "denied" ? prompt(`Deny ${nameOf(r.user_id).split(" ")[0]}'s request? Reason (they'll see it):`, "") : "";
  if (note === null) return;
  const { error } = await sb.from("time_off_requests").update({ status, decided_by: state.profile.id, decided_at: new Date().toISOString(), decision_note: note?.trim() || null }).eq("id", r.id);
  if (error) return toast(error.message);
  toast(status === "approved" ? "Approved" : "Denied"); done?.();
}

// Who's working: past days from time clock punches, plus approved/pending time off. Admin only.
let calOffset = 0;
async function renderWorkCalendar(el) {
  await loadProfiles();
  const base = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Denver" }));
  const first = new Date(base.getFullYear(), base.getMonth() + calOffset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const k = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fromK = k(first), toK = k(last), todayK = today();
  const [{ data: punches }, { data: offs }] = await Promise.all([
    sb.from("time_entries").select("user_id, clock_in, clock_out").gte("clock_in", new Date(first.getTime() - 864e5).toISOString()).lte("clock_in", new Date(last.getTime() + 2 * 864e5).toISOString()),
    sb.from("time_off_requests").select("*").lte("start_date", toK).gte("end_date", fromK).neq("status", "denied"),
  ]);
  const worked = {}; (punches ?? []).forEach((p) => { const d = dayKey(p.clock_in); ((worked[d] ??= {})[p.user_id] ??= 0); worked[d][p.user_id] += (p.clock_out ? new Date(p.clock_out) : new Date()) - new Date(p.clock_in); });
  const offOn = (d) => (offs ?? []).filter((r) => r.start_date <= d && r.end_date >= d);
  const first3 = (id) => esc((nameOf(id) || "?").split(" ")[0]);
  const pending = (offs ?? []).filter((r) => r.status === "pending");
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= last.getDate(); d++) {
    const dk = k(new Date(first.getFullYear(), first.getMonth(), d));
    const w = Object.keys(worked[dk] ?? {}), o = offOn(dk);
    cells.push(`<div class="cal-cell ${dk === todayK ? "today" : ""}" data-day="${dk}"><div class="cal-d">${d}</div>
      ${w.length ? `<div class="cal-w">👷 ${w.length}</div>` : ""}
      ${o.map((r) => `<div class="cal-off ${r.status === "pending" ? "pend" : r.paid ? "pto" : "unp"}">${first3(r.user_id)}</div>`).join("")}</div>`);
  }
  el.innerHTML = `<div class="card stack" id="wcal">
    <div class="row between"><h2 style="margin:0">📅 Who's working</h2><button class="btn sm" id="addoff">+ Time off</button></div>
    ${pending.length ? `<div class="stack" style="gap:6px">${pending.map((r) => `<div class="item" style="cursor:default"><div class="row between"><span class="title">${esc(nameOf(r.user_id))} · ${fmtRange(r.start_date, r.end_date)}</span><span class="badge warn">Waiting</span></div>
      <div class="small">${offKind(r)}${r.hours ? ` · ${r.hours} hrs` : ` · ${workDays(r.start_date, r.end_date)} workday${workDays(r.start_date, r.end_date) === 1 ? "" : "s"}`}${r.reason ? ` · ${esc(r.reason)}` : ""}</div>
      <div class="row" style="gap:6px;margin-top:6px"><button class="btn sm primary" data-appr="${r.id}">Approve</button><button class="btn sm" data-deny="${r.id}">Deny</button></div></div>`).join("")}</div>` : ""}
    <div class="row between"><button class="btn sm" id="calprev">‹</button><strong>${first.toLocaleDateString([], { month: "long", year: "numeric" })}</strong><button class="btn sm" id="calnext">›</button></div>
    <div class="cal-grid">${["S", "M", "T", "W", "T", "F", "S"].map((x) => `<div class="cal-h">${x}</div>`).join("")}${cells.join("")}</div>
    <div class="row wrap small" style="gap:10px"><span>👷 worked (time clock)</span><span><span class="cal-off pto">Name</span> paid off</span><span><span class="cal-off unp">Name</span> unpaid off</span><span><span class="cal-off pend">Name</span> requested</span></div>
  </div>`;
  const again = () => renderWorkCalendar(el);
  el.querySelector("#calprev").onclick = () => { calOffset--; again(); };
  el.querySelector("#calnext").onclick = () => { calOffset++; again(); };
  el.querySelector("#addoff").onclick = () => timeOffForm(undefined, again);
  el.querySelectorAll("[data-appr]").forEach((b) => (b.onclick = () => decideTimeOff(pending.find((r) => r.id === b.dataset.appr), "approved", again)));
  el.querySelectorAll("[data-deny]").forEach((b) => (b.onclick = () => decideTimeOff(pending.find((r) => r.id === b.dataset.deny), "denied", again)));
  el.querySelectorAll("[data-day]").forEach((c) => (c.onclick = () => {
    const dk = c.dataset.day, w = worked[dk] ?? {}, o = offOn(dk);
    const guys = (state.cache.profiles ?? []).filter(isGuy);
    const notIn = dk < todayK ? guys.filter((p) => !w[p.id] && !o.some((r) => r.user_id === p.id)) : [];
    sheet(`<div class="stack"><div class="row between"><h2 style="margin:0">${new Date(dk + "T12:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h2><button class="btn sm" data-close>Close</button></div>
      <div><h3 style="margin:0 0 4px">Worked</h3>${Object.entries(w).map(([id, ms]) => `<div class="row between"><span>${esc(nameOf(id) || "Unknown")}</span><span class="small muted">${hm(ms)}</span></div>`).join("") || `<p class="small muted" style="margin:0">${dk > todayK ? "Future day." : "No time clock punches."}</p>`}</div>
      <div><h3 style="margin:0 0 4px">Off</h3>${o.map((r) => `<div class="item" style="cursor:default"><div class="row between"><span>${esc(nameOf(r.user_id))}</span>${r.status === "pending" ? '<span class="badge warn">Requested</span>' : r.paid ? '<span class="badge ok">Paid</span>' : '<span class="badge">Unpaid</span>'}</div>
        <div class="small muted">${fmtRange(r.start_date, r.end_date)}${r.hours ? ` · ${r.hours} hrs` : ""}${r.reason ? ` · ${esc(r.reason)}` : ""}</div>
        <div class="row" style="gap:6px;margin-top:6px">${r.status === "pending" ? `<button class="btn sm primary" data-ok="${r.id}">Approve</button><button class="btn sm" data-no="${r.id}">Deny</button>` : ""}<button class="btn sm" data-flip="${r.id}">Make ${r.paid ? "unpaid" : "paid"}</button><button class="btn sm danger" data-rm="${r.id}">Remove</button></div></div>`).join("") || '<p class="small muted" style="margin:0">Nobody off.</p>'}</div>
      ${notIn.length ? `<div><h3 style="margin:0 0 4px">No punches</h3><p class="small muted" style="margin:0">${notIn.map((p) => esc(p.full_name)).join(", ")}</p></div>` : ""}
    </div>`, (r, close) => {
      const fin = () => { close(); again(); };
      r.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => decideTimeOff(o.find((x) => x.id === b.dataset.ok), "approved", fin)));
      r.querySelectorAll("[data-no]").forEach((b) => (b.onclick = () => decideTimeOff(o.find((x) => x.id === b.dataset.no), "denied", fin)));
      r.querySelectorAll("[data-flip]").forEach((b) => (b.onclick = async () => { const x = o.find((y) => y.id === b.dataset.flip); const { error } = await sb.from("time_off_requests").update({ paid: !x.paid }).eq("id", x.id); if (error) return toast(error.message); fin(); }));
      r.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this time off?")) return; const { error } = await sb.from("time_off_requests").delete().eq("id", b.dataset.rm); if (error) return toast(error.message); fin(); }));
    });
  }));
}

// ---------------------------------------------------------------- Employee handbook
async function renderHandbook(root) {
  const { data: hb } = await sb.from("handbook").select("*").maybeSingle();
  root.innerHTML = `<div class="card stack">
    <div class="row between"><h2 style="margin:0">📘 Employee handbook</h2>${isOwner() ? `<label class="btn sm primary" style="cursor:pointer">${hb ? "Replace" : "Upload"}<input type="file" id="hbfile" accept=".pdf,.doc,.docx,application/pdf" hidden></label>` : ""}</div>
    ${hb ? `<p class="small muted" style="margin:0">${esc(hb.file_name)} · updated ${fmtDate(hb.uploaded_at.slice(0, 10))}</p>
      <div class="row wrap"><button class="btn primary" id="hbopen">Open handbook</button></div>
      <div id="hbview"></div>` : `<p class="small muted" style="margin:0">${isOwner() ? "Upload the handbook (PDF works best) and everyone will see it here." : "The handbook hasn't been posted yet."}</p>`}
  </div>`;
  if (hb) {
    const { data: s } = await sb.storage.from("handbook").createSignedUrl(hb.path, 3600);
    const url = s?.signedUrl;
    root.querySelector("#hbopen").onclick = () => url ? window.open(url, "_blank", "noopener") : toast("Couldn't open the file");
    if (url && /\.pdf$/i.test(hb.path) && matchMedia("(min-width: 700px)").matches) root.querySelector("#hbview").innerHTML = `<iframe src="${url}" title="Employee handbook" style="width:100%;height:75vh;border:1px solid var(--line);border-radius:12px;background:#fff"></iframe>`;
  }
  root.querySelector("#hbfile")?.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const path = `handbook-${Date.now()}.${(f.name.split(".").pop() || "pdf").toLowerCase()}`;
    toast("Uploading…");
    const up = await sb.storage.from("handbook").upload(path, f, { contentType: f.type || "application/pdf", upsert: true });
    if (up.error) return toast(up.error.message);
    const { error } = await sb.from("handbook").upsert({ id: 1, path, file_name: f.name, uploaded_by: state.profile.id, uploaded_at: new Date().toISOString() });
    if (error) return toast(error.message);
    if (hb?.path && hb.path !== path) sb.storage.from("handbook").remove([hb.path]);
    log("handbook_upload", "handbook", null, { file: f.name });
    toast("Handbook posted"); renderHandbook(root);
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
  await attachBreaks(data ?? []);
  const thisWk = weekStart(0);
  const tot = (list) => list.reduce((a, e) => a + entryMs(e), 0);
  const cur = (data ?? []).filter((e) => new Date(e.clock_in) >= thisWk), prev = (data ?? []).filter((e) => new Date(e.clock_in) < thisWk);
  root.innerHTML = `<div class="card stack">
    <div class="row between"><h2 style="margin:0">My hours</h2><span class="badge">This week ${hm(tot(cur))}</span></div>
    <p class="small muted" style="margin:0">Last week: ${hm(tot(prev))}. Payroll uses Square; if something looks wrong, tell Brittany.</p>
    <div class="small" id="myrate"></div>
    <table><tr><th>Day</th><th>In</th><th>Out</th><th>Hours</th><th></th></tr>${(data ?? []).map((e) => `<tr>
      <td>${new Date(e.clock_in).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</td>
      <td>${timeOf(e.clock_in)}</td><td>${e.clock_out ? timeOf(e.clock_out) : '<span class="badge ok">On now</span>'}</td><td>${hm(entryMs(e))}</td><td>${sqBadge(e)}</td></tr>`).join("")
      || '<tr><td colspan="5" class="muted">No punches in the last two weeks.</td></tr>'}</table></div>`;
  // Your own hourly rate from Square. Nobody else's is ever shown.
  fnCall("timeclock", { action: "my_rate" }).then((r) => {
    const el = root.querySelector("#myrate"); if (!el || !r?.rates?.length) return;
    el.innerHTML = "💵 Your rate: " + r.rates.map((x) => `<strong>${usd(x.cents / 100)}/hr</strong>${r.rates.length > 1 && x.title ? ` (${esc(x.title)})` : ""}`).join(", ");
  }).catch(() => {});
  if (!state.profile.extra_clock) return;
  const { data: x } = await sb.from("extra_time_entries").select("*").eq("user_id", state.profile.id).gte("clock_in", since.toISOString()).order("clock_in", { ascending: false });
  const xc = (x ?? []).filter((e) => new Date(e.clock_in) >= thisWk), xp = (x ?? []).filter((e) => new Date(e.clock_in) < thisWk);
  // Your own balance for extra hours (only you and admins can see it).
  const { data: pay } = await sb.rpc("my_extra_pay");
  const kindLabel = { balance: "Carried over", payment: "Paid to you", adjustment: "Time card / adjustment" };
  const payCard = pay ? `<div class="card" style="padding:12px;margin:0">
      <div class="row between"><strong>${Number(pay.owed) > 0 ? "We owe you" : Number(pay.owed) < 0 ? "Paid ahead" : "All paid up"}</strong>
        <span style="font-family:var(--display);font-size:1.6rem">${usd(Math.abs(Number(pay.owed)))}</span></div>
      <div class="small muted">${usd(pay.rate)}/hr · ${Number(pay.hours)} hrs on the extra clock since ${fmtDate(String(pay.since).slice(0, 10))} = ${usd(pay.earned)}</div>
      ${(pay.lines ?? []).length ? `<details style="margin-top:6px"><summary class="small">How we got there</summary>
        <table style="margin-top:6px">${pay.lines.map((l) => `<tr><td class="small">${fmtDate(l.date)}</td><td class="small">${kindLabel[l.kind] ?? l.kind}${l.note ? ` <span class="muted">· ${esc(l.note)}</span>` : ""}</td><td class="small" style="text-align:right;white-space:nowrap">${Number(l.amount) < 0 ? "−" + usd(-l.amount) : usd(l.amount)}</td></tr>`).join("")}</table></details>` : ""}
      <p class="small muted" style="margin:6px 0 0">Something look off? Use Request time card edit on this page.</p></div>` : "";
  root.insertAdjacentHTML("beforeend", `<div class="card stack section">
    <div class="row between"><h2 style="margin:0">Extra hours</h2><span class="badge">This week ${hm(tot(xc))}</span></div>
    ${payCard}
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
  await attachBreaks(week ?? []);
  const byUser = {};
  (week ?? []).forEach((e) => { byUser[e.user_id] = (byUser[e.user_id] ?? 0) + entryMs(e); });
  // Square is the source of truth for who's on right now (covers register punches).
  const open = sq?.ok ? sq.on.map((o) => ({ user_id: o.user_id, clock_in: o.clock_in, name: o.user_id ? nameOf(o.user_id) : "Someone without a hub login" }))
                      : ((await sb.from("time_entries").select("*").is("clock_out", null)).data ?? []);
  const issues = (week ?? []).filter((e) => e.square_status === "error");
  root.innerHTML = `<div id="wcalwrap" style="margin-bottom:12px"></div>
    <div class="card stack"><div class="row between"><h2 style="margin:0">On the clock now</h2><span class="badge ${open?.length ? "ok" : ""}">${open?.length ?? 0}</span></div>
      ${(open ?? []).map((e) => `<div class="row between"><span>${esc(e.name ?? nameOf(e.user_id))}</span><span class="small muted">since ${timeOf(e.clock_in)} · ${hm(entryMs(e))}</span></div>`).join("") || '<p class="small muted" style="margin:0">Nobody is clocked in.</p>'}
    </div>
    <div class="card section"><h2>This week</h2>
      <table><tr><th>Person</th><th>Hours</th></tr>${Object.entries(byUser).sort((a, b) => b[1] - a[1]).map(([id, ms]) => `<tr><td>${esc(nameOf(id))}</td><td>${hm(ms)}</td></tr>`).join("") || '<tr><td colspan="2" class="muted">No punches yet this week.</td></tr>'}</table>
      ${issues.length ? `<p class="small error">${issues.length} punch${issues.length > 1 ? "es" : ""} didn't reach Square: ${issues.map((e) => esc(nameOf(e.user_id)) + " " + new Date(e.clock_in).toLocaleDateString([], { month: "short", day: "numeric" })).join(", ")}. Fix those in Square Team.</p>` : ""}
    </div>`;
  await renderWorkCalendar(root.querySelector("#wcalwrap"));
  await renderExtraPay(root);
  const { data: x } = await sb.from("extra_time_entries").select("*").gte("clock_in", weekStart(-1).toISOString()).order("clock_in", { ascending: false });
  if (!(x ?? []).length) return;
  const sum = (list) => list.reduce((a, e) => a + entryMs(e), 0);
  const thisWk = (x ?? []).filter((e) => new Date(e.clock_in) >= since), lastWk = (x ?? []).filter((e) => new Date(e.clock_in) < since);
  root.insertAdjacentHTML("beforeend", `<div class="card section stack">
    <div class="row between"><h2 style="margin:0">Extra hours (not in Square)</h2><span class="badge">This week ${hm(sum(thisWk))} · Last week ${hm(sum(lastWk))}</span></div>
    ${extraTable(x, true)}</div>`);
}

// What we owe for extra (off-Square) hours: carried-over balance + extra-clock hours x rate - payments.
// Admin/owner only; the database blocks everyone else.
async function renderExtraPay(root) {
  if (!seesMoney()) return;
  const [{ data: settings }, { data: ledger }] = await Promise.all([
    sb.from("extra_pay_settings").select("*"),
    sb.from("extra_pay_ledger").select("*").order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  if (!(settings ?? []).length) return;
  const oldest = settings.reduce((a, s) => (s.counting_from < a ? s.counting_from : a), settings[0].counting_from);
  const { data: hrs } = await sb.from("extra_time_entries").select("user_id, clock_in, clock_out").gte("clock_in", oldest).not("clock_out", "is", null);
  const people = settings.map((s) => {
    const mine = (ledger ?? []).filter((l) => l.user_id === s.user_id);
    const ms = (hrs ?? []).filter((e) => e.user_id === s.user_id && e.clock_in >= s.counting_from).reduce((a, e) => a + (new Date(e.clock_out) - new Date(e.clock_in)), 0);
    const hours = Math.round(ms / 36e5 * 100) / 100;
    const earned = Math.round(hours * Number(s.hourly_rate) * 100) / 100;
    const owed = Math.round((mine.reduce((a, l) => a + Number(l.amount), 0) + earned) * 100) / 100;
    return { s, mine, hours, earned, owed };
  });
  const kindLabel = { balance: "Carried over", payment: "Paid", adjustment: "Adjustment" };
  root.insertAdjacentHTML("beforeend", `<div class="card section stack" id="xpay">
    <div class="row between"><h2 style="margin:0">💲 Extra hours pay</h2><span class="small muted">Admins only</span></div>
    ${people.map((p) => `<div class="item" style="cursor:default">
      <div class="row between"><span class="title">${esc(nameOf(p.s.user_id))}</span>
        <span class="badge ${p.owed > 0 ? "warn" : "ok"}" style="font-size:1rem">${p.owed > 0 ? "We owe " + usd(p.owed) : p.owed < 0 ? "Overpaid " + usd(-p.owed) : "Paid up"}</span></div>
      <div class="small muted">${usd(p.s.hourly_rate)}/hr · ${p.hours} hrs on the extra clock since ${fmtDate(p.s.counting_from.slice(0, 10))} = ${usd(p.earned)}</div>
      <table style="margin-top:6px">${p.mine.slice(0, 8).map((l) => `<tr><td class="small">${fmtDate(l.entry_date)}</td><td class="small">${kindLabel[l.kind]}${l.note ? ` <span class="muted">· ${esc(l.note)}</span>` : ""}</td><td class="small" style="text-align:right;white-space:nowrap">${Number(l.amount) < 0 ? "−" + usd(-l.amount) : usd(l.amount)}</td></tr>`).join("")}</table>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn sm primary" data-xpay="${p.s.user_id}" data-k="payment">Record payment</button>
        <button class="btn sm" data-xpay="${p.s.user_id}" data-k="adjustment">Adjust</button>
        <button class="btn sm" data-xrate="${p.s.user_id}">Rate</button>
      </div></div>`).join("")}
  </div>`);
  const card = root.querySelector("#xpay");
  card.querySelectorAll("[data-xpay]").forEach((b) => (b.onclick = () => {
    const pay = b.dataset.k === "payment", who = nameOf(b.dataset.xpay);
    sheet(`<form class="stack" id="f"><h2>${pay ? "Payment to" : "Adjust balance for"} ${esc(who)}</h2>
      <div><label>${pay ? "Amount paid" : "Amount (+ we owe more, − we owe less)"}</label><input name="amount" type="number" step="0.01" inputmode="decimal" required></div>
      <div><label>Date</label><input name="entry_date" type="date" value="${today()}"></div>
      <div><label>${pay ? "Paid how" : "Why"}</label><input name="note" placeholder="${pay ? "Cash, check #, product (16x20 & wax)…" : "e.g. forgot to clock out"}"></div>
      <div class="row between"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Save</button></div></form>`, (r, close) => {
      r.querySelector("#f").onsubmit = async (e) => {
        e.preventDefault();
        const f = formData(e.target), amt = Number(f.amount);
        if (!amt) return toast("Enter an amount");
        const { error } = await sb.from("extra_pay_ledger").insert({ user_id: b.dataset.xpay, kind: b.dataset.k, amount: pay ? -Math.abs(amt) : amt, entry_date: f.entry_date || today(), note: f.note || null });
        if (error) return toast(error.message);
        toast("Saved"); close(); renderTimeclockAdmin(root);
      };
    });
  }));
  card.querySelectorAll("[data-xrate]").forEach((b) => (b.onclick = async () => {
    const s = settings.find((x) => x.user_id === b.dataset.xrate);
    const v = prompt(`Hourly rate for ${nameOf(s.user_id)}'s extra hours`, s.hourly_rate);
    if (v == null || !Number(v)) return;
    const { error } = await sb.from("extra_pay_settings").update({ hourly_rate: Number(v), updated_at: new Date().toISOString() }).eq("user_id", s.user_id);
    if (error) return toast(error.message);
    toast("Rate saved"); renderTimeclockAdmin(root);
  }));
}

async function renderSuppliers(root) {
  const { data } = await sb.from("suppliers").select("*").order("name");
  root.innerHTML = `<div class="row between"><h2>Suppliers</h2>${can("admin") ? '<button class="btn sm primary" id="new">+ Supplier</button>' : ""}</div>
    <div class="list">${(data ?? []).map((s) => `<div class="item" data-s="${s.id}"><div class="title">${esc(s.name)}</div>
      <div class="small muted">${[s.contact_name, s.phone, s.email, s.email2, s.lead_time_days ? s.lead_time_days + " day lead time" : ""].filter(Boolean).map(esc).join(" · ")}</div>
      ${s.notes ? `<div class="small">${esc(s.notes)}</div>` : ""}</div>`).join("") || '<div class="empty">No suppliers yet.</div>'}</div>`;
  const edit = (s = {}) => sheet(`
    <form class="stack" id="f"><h2>${s.id ? "Edit supplier" : "New supplier"}</h2>
      <div><label>Name</label><input name="name" value="${esc(s.name)}" required></div>
      <div class="grid2">
        <div><label>Contact</label><input name="contact_name" value="${esc(s.contact_name)}"></div>
        <div><label>Phone</label><input name="phone" value="${esc(s.phone)}"></div>
        <div><label>Email</label><input name="email" type="email" value="${esc(s.email)}"></div>
        <div><label>Secondary email</label><input name="email2" type="email" value="${esc(s.email2)}"></div>
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
    <div class="card"><div class="row between"><h2>Ask Claude this month</h2>${seesMoney() ? `<span class="badge">$${total.toFixed(3)}</span>` : ""}</div>
      <table><tr><th>Person</th><th>Questions</th><th>Cost</th></tr>${Object.entries(byUser).map(([id, b]) =>
        `<tr><td>${esc(nameOf(id))}</td><td>${b.n}</td><td>${seesMoney() ? "$" + b.c.toFixed(3) : ""}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">No questions yet.</td></tr>'}</table>
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
