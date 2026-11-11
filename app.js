import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// ---------------------------------------------------------------- helpers
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ROLES = ["pending", "shop", "lead", "admin", "owner"];
const ROLE_LABEL = { pending: "Pending", shop: "Shop", lead: "Lead", admin: "Admin", owner: "Owner" };
const can = (min) => state.profile && ROLES.indexOf(state.profile.role) >= ROLES.indexOf(min);
const JOB_STATUSES = ["Queued", "Milling", "Glue-up", "Machining", "Sanding", "Finishing", "QC", "Ready", "Shipped", "Hold"];
const CHANNELS = ["Web", "Retail", "Commercial", "Government", "Custom"];
const INV_CATS = ["Lumber", "Finished goods", "Finish", "Abrasives", "Hardware", "Shop supplies"];
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
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of lines) {
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { closeList(); const n = m[1].length + 1; html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
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
  ask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};

// ---------------------------------------------------------------- state & routing
const state = { session: null, profile: null, view: "home", cache: {}, chat: [] };

const VIEWS = {
  home: { label: "Home", icon: I.home, render: renderHome },
  jobs: { label: "Jobs", icon: I.jobs, render: renderJobs },
  inventory: { label: "Inventory", icon: I.inv, render: renderInventory },
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
  <div class="auth"><form class="card stack" id="login">
    <div class="brand"><img src="icons/icon-192.png" alt=""> Montana Block Hub</div>
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
  <div class="auth"><div class="card stack">
    <div class="brand"><img src="icons/icon-192.png" alt=""> Montana Block Hub</div>
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
    $app.innerHTML = `<div class="auth"><div class="card">${html}</div></div>`;
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
    <nav class="sidebar"><div class="brand"><img src="icons/icon-192.png" alt=""> MB Hub</div>${nav("sidebar")}<div class="spacer"></div>
      <div class="small muted" style="padding:0 12px">${esc(state.profile.full_name || state.profile.email)}<br>${ROLE_LABEL[state.profile.role]}</div></nav>
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
  return `<div class="topbar"><div class="row"><div class="brand"><img src="icons/icon-192.png" alt=""></div><h1>${esc(title)}</h1></div>
    <div class="row">${actions}<button class="btn icon sm" data-go-more aria-label="Account and team" title="Account">${I.more.replace("<svg", '<svg width="20" height="20"')}</button></div></div>`;
}
function wireTopbar(root) {
  root.querySelector("[data-go-more]")?.addEventListener("click", () => go("more"));
}

// ---------------------------------------------------------------- data loaders
async function loadProfiles() {
  const { data } = await sb.from("profiles").select("id, full_name, email, title, role, active, daily_ai_limit").order("full_name");
  state.cache.profiles = data ?? [];
  return state.cache.profiles;
}
const nameOf = (id) => state.cache.profiles?.find((p) => p.id === id)?.full_name || "";

// ---------------------------------------------------------------- Home
async function renderHome(root) {
  const [ann, jobs, inv] = await Promise.all([
    sb.from("announcements").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(20),
    sb.from("jobs").select("*").not("status", "in", "(Shipped)").order("due_date", { ascending: true, nullsFirst: false }),
    sb.from("inventory_items").select("*"),
  ]);
  await loadProfiles();
  const first = (state.profile.full_name || "").split(" ")[0];
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/Denver", hour: "numeric", hour12: false }));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const myJobs = (jobs.data ?? []).filter((j) => j.assigned_to === state.profile.id);
  const dueSoon = (jobs.data ?? []).filter((j) => j.due_date && daysUntil(j.due_date) <= 7);
  const low = (inv.data ?? []).filter(isLow);

  root.innerHTML = `
    ${topbar(`${greet}${first ? ", " + first : ""}`, can("admin") ? '<button class="btn sm" id="addAnn">+ Note</button>' : "")}
    <div class="stack">
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
    </div>
    <div class="card section"><div class="row between"><h2>Low stock</h2><span class="badge ${low.length ? "warn" : "ok"}">${low.length}</span></div>
      ${low.length ? `<table><tr><th>Item</th><th>On hand</th><th>Reorder at</th></tr>${low.map((i) =>
        `<tr><td>${esc(i.name)}${i.species ? ` <span class="muted small">${esc(i.species)} ${esc(i.thickness ?? "")}</span>` : ""}</td><td>${i.quantity} ${esc(i.unit)}</td><td>${i.reorder_point}</td></tr>`).join("")}</table>`
        : '<p class="muted small">Everything is above its reorder point.</p>'}
    </div>`;
  wireTopbar(root);
  root.querySelector("#addAnn")?.addEventListener("click", () => editAnnouncement());
  root.querySelectorAll("[data-edit-ann]").forEach((b) => (b.onclick = () => editAnnouncement((ann.data ?? []).find((a) => a.id === b.dataset.editAnn))));
  root.querySelectorAll("[data-job]").forEach((b) => (b.onclick = () => editJob((jobs.data ?? []).find((j) => j.id === b.dataset.job))));
}

function jobRows(list) {
  if (!list.length) return "";
  return `<div class="list" style="margin-top:6px">${list.map((j) => {
    const d = j.due_date ? daysUntil(j.due_date) : null;
    const dueCls = d === null ? "" : d < 0 ? "bad" : d <= 2 ? "warn" : "";
    return `<div class="item" data-job="${j.id}"><div class="row between"><span class="title">${esc(j.title)}</span>
      <span class="badge">${esc(j.status)}</span></div>
      <div class="small muted">${esc(j.customer ?? "")}${j.due_date ? ` · <span class="badge ${dueCls}">Due ${fmtDate(j.due_date)}</span>` : ""}${j.priority === "Rush" ? ' · <span class="badge bad">Rush</span>' : ""}</div></div>`;
  }).join("")}</div>`;
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
let jobFilter = "Active";
async function renderJobs(root) {
  const [{ data: jobs }] = await Promise.all([
    sb.from("jobs").select("*").order("due_date", { ascending: true, nullsFirst: false }),
    loadProfiles(),
  ]);
  state.cache.jobs = jobs ?? [];
  const filters = ["Active", "Mine", ...JOB_STATUSES];
  const list = (jobs ?? []).filter((j) =>
    jobFilter === "Active" ? !["Shipped"].includes(j.status) :
    jobFilter === "Mine" ? j.assigned_to === state.profile.id && j.status !== "Shipped" :
    j.status === jobFilter);
  root.innerHTML = `
    ${topbar("Jobs", can("lead") ? '<button class="btn sm primary" id="new">+ Job</button>' : "")}
    <div class="chips">${filters.map((f) => `<button class="chip ${f === jobFilter ? "active" : ""}" data-f="${f}">${f}</button>`).join("")}</div>
    <div style="margin-top:12px">${jobRows(list) || '<div class="empty">No jobs here.</div>'}</div>`;
  wireTopbar(root);
  root.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { jobFilter = b.dataset.f; renderJobs(root); }));
  root.querySelector("#new")?.addEventListener("click", () => editJob());
  root.querySelectorAll("[data-job]").forEach((b) => (b.onclick = () => editJob(jobs.find((j) => j.id === b.dataset.job))));
}

function editJob(j = {}) {
  const full = can("lead") || !j.id; // shop employees can change status, assignee and notes only
  const people = (state.cache.profiles ?? []).filter((p) => p.active && p.role !== "pending");
  sheet(`
    <form class="stack" id="f">
      <h2>${j.id ? esc(j.title) : "New job"}</h2>
      ${full ? `
      <div><label>Job</label><input name="title" value="${esc(j.title)}" required placeholder="e.g. 3 walnut cutting boards"></div>
      <div class="grid2">
        <div><label>Customer</label><input name="customer" value="${esc(j.customer)}"></div>
        <div><label>Channel</label><select name="channel">${CHANNELS.map((c) => `<option ${j.channel === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div><label>Due date</label><input type="date" name="due_date" value="${esc(j.due_date)}"></div>
        <div><label>Priority</label><select name="priority">${["Low", "Normal", "Rush"].map((p) => `<option ${(j.priority ?? "Normal") === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      </div>` : `<p class="muted small" style="margin:0">${esc(j.customer ?? "")} · ${esc(j.channel)}${j.due_date ? " · Due " + fmtDate(j.due_date) : ""}</p>`}
      <div class="grid2">
        <div><label>Status</label><select name="status">${JOB_STATUSES.map((s) => `<option ${(j.status ?? "Queued") === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div><label>Assigned to</label><select name="assigned_to"><option value="">Unassigned</option>${people.map((p) => `<option value="${p.id}" ${j.assigned_to === p.id ? "selected" : ""}>${esc(p.full_name || p.email)}</option>`).join("")}</select></div>
      </div>
      <div><label>Notes</label><textarea name="notes">${esc(j.notes)}</textarea></div>
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>
        ${j.id && can("admin") ? '<button type="button" class="btn danger" id="del">Delete</button>' : ""}</div>
      ${j.updated_at ? `<p class="small muted" style="margin:0">Last updated ${new Date(j.updated_at).toLocaleString()}${j.updated_by ? " by " + esc(nameOf(j.updated_by)) : ""}</p>` : ""}
    </form>`, (root, close) => {
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const row = { status: f.status, assigned_to: f.assigned_to || null, notes: f.notes || null };
      if (full) Object.assign(row, { title: f.title, customer: f.customer || null, channel: f.channel, due_date: f.due_date || null, priority: f.priority });
      const res = j.id ? await sb.from("jobs").update(row).eq("id", j.id).select().single() : await sb.from("jobs").insert(row).select().single();
      if (res.error) return toast(res.error.message);
      log(j.id ? "update_job" : "create_job", "job", res.data.id, j.id && j.status !== f.status ? { from: j.status, to: f.status } : null);
      close(); renderShell();
    };
    root.querySelector("#del")?.addEventListener("click", async () => {
      if (!confirm("Delete this job? This can't be undone.")) return;
      await sb.from("jobs").delete().eq("id", j.id);
      log("delete_job", "job", j.id, { title: j.title });
      close(); renderShell();
    });
  });
}

// ---------------------------------------------------------------- Inventory
let invCat = "All", invQ = "";
async function renderInventory(root) {
  const { data: items } = await sb.from("inventory_items").select("*").order("category").order("name");
  state.cache.inventory = items ?? [];
  let suppliers = [];
  if (can("lead")) suppliers = (await sb.from("suppliers").select("id, name").order("name")).data ?? [];
  state.cache.suppliers = suppliers;
  const q = invQ.toLowerCase();
  const list = (items ?? []).filter((i) =>
    (invCat === "All" || (invCat === "Low" ? isLow(i) : i.category === invCat)) &&
    (!q || [i.name, i.species, i.thickness, i.location].join(" ").toLowerCase().includes(q)));
  root.innerHTML = `
    ${topbar("Inventory", can("lead") ? '<button class="btn sm primary" id="new">+ Item</button>' : "")}
    <input id="q" placeholder="Search walnut, 8/4, finish…" value="${esc(invQ)}" style="margin-bottom:10px">
    <div class="chips">${["All", "Low", ...INV_CATS].map((c) => `<button class="chip ${c === invCat ? "active" : ""}" data-c="${c}">${c}</button>`).join("")}</div>
    <div class="list" style="margin-top:12px">${list.map((i) => `
      <div class="item" data-id="${i.id}">
        <div class="row between">
          <div style="min-width:0" data-open="${i.id}"><div class="title">${esc(i.name)} ${isLow(i) ? '<span class="badge warn">Low</span>' : ""}</div>
            <div class="small muted">${[i.species, i.thickness, i.location].filter(Boolean).map(esc).join(" · ") || esc(i.category)}</div></div>
          <div class="qty">
            <button class="btn icon sm" data-adj="-1" aria-label="Decrease">−</button>
            <span class="n">${Number(i.quantity)} <span class="small muted">${esc(i.unit)}</span></span>
            <button class="btn icon sm" data-adj="1" aria-label="Increase">+</button>
          </div>
        </div>
      </div>`).join("") || '<div class="empty">No items yet.</div>'}</div>`;
  wireTopbar(root);
  const qEl = root.querySelector("#q");
  qEl.oninput = () => { invQ = qEl.value; clearTimeout(qEl._t); qEl._t = setTimeout(() => { renderInventory(root).then(() => { const n = root.querySelector("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 250); };
  root.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { invCat = b.dataset.c; renderInventory(root); }));
  root.querySelector("#new")?.addEventListener("click", () => editItem());
  root.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => editItem(items.find((i) => i.id === b.dataset.open))));
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

function editItem(i = {}) {
  const full = can("lead");
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
        <div class="small muted">Updated ${fmtDate(s.updated_at)}${s.min_role !== "shop" ? ` · ${ROLE_LABEL[s.min_role]}s+` : ""}</div></div>`).join("")}</div>`).join("")
      || '<div class="empty">No SOPs yet.</div>'}`;
  wireTopbar(root);
  const qEl = root.querySelector("#q");
  qEl.oninput = () => { sopQ = qEl.value; clearTimeout(qEl._t); qEl._t = setTimeout(() => renderSops(root).then(() => { const n = root.querySelector("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }), 250); };
  root.querySelector("#new")?.addEventListener("click", () => editSop());
  root.querySelectorAll("[data-sop]").forEach((b) => (b.onclick = () => viewSop(sops.find((s) => s.id === b.dataset.sop))));
}

function viewSop(s) {
  log("view_sop", "sop", s.id, { title: s.title });
  sheet(`
    <div class="row between"><span class="badge">${esc(s.category)}</span><button class="btn sm" data-close>Close</button></div>
    <h1 style="margin-top:10px">${esc(s.title)}</h1>
    <div class="prose">${md(s.body)}</div>
    ${can("admin") ? '<div class="row" style="margin-top:14px"><button class="btn" id="edit">Edit</button></div>' : ""}`,
  (root, close) => root.querySelector("#edit")?.addEventListener("click", () => { close(); editSop(s); }));
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
      <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button>
        ${s.id ? '<button type="button" class="btn danger" id="del">Delete</button>' : ""}</div>
    </form>`, (root, close) => {
    root.querySelector("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const row = { title: f.title, category: f.category || "General", min_role: f.min_role, body: f.body };
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
    ...(can("lead") ? [{ k: "suppliers", label: "Suppliers" }] : []),
    ...(can("admin") ? [{ k: "team", label: "Team & logins" }, { k: "activity", label: "Activity & usage" }] : []),
  ];
  root.innerHTML = `${topbar("More")}
    <div class="list">${sections.map((s) => `<div class="item" data-sec="${s.k}"><div class="title">${s.label}</div></div>`).join("")}</div>
    <div id="sec" class="section"></div>`;
  wireTopbar(root);
  const sec = root.querySelector("#sec");
  const open = async (k) => {
    root.querySelectorAll("[data-sec]").forEach((el) => (el.style.borderColor = el.dataset.sec === k ? "var(--accent)" : ""));
    sec.innerHTML = '<div class="empty">Loading…</div>';
    await ({ account: renderAccount, suppliers: renderSuppliers, team: renderTeam, activity: renderActivity }[k])(sec);
  };
  root.querySelectorAll("[data-sec]").forEach((b) => (b.onclick = () => open(b.dataset.sec)));
  open("account");
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
  const assignable = state.profile.role === "owner" ? ["shop", "lead", "admin"] : ["shop", "lead"];
  root.innerHTML = `<div class="row between"><h2>Team & logins</h2><button class="btn sm primary" id="new">+ Person</button></div>
    <div class="list">${people.map((p) => `<div class="item" data-p="${p.id}"><div class="row between">
      <div><div class="title">${esc(p.full_name || p.email)}</div><div class="small muted">${esc(p.email)}${p.title ? " · " + esc(p.title) : ""}</div></div>
      <div class="row"><span class="badge ${p.active ? "" : "bad"}">${p.active ? ROLE_LABEL[p.role] : "Inactive"}</span></div></div></div>`).join("")}</div>
    <p class="small muted">Shop: jobs, inventory counts, SOPs, Ask. Lead: also adds jobs and items, sees suppliers. Admin: also edits SOPs, notes and the team, sees activity and usage.</p>`;
  root.querySelector("#new").onclick = () => sheet(`
    <form class="stack" id="f"><h2>Add a person</h2>
      <div><label>Full name</label><input name="full_name" required></div>
      <div><label>Email (their login)</label><input name="email" type="email" required autocomplete="off"></div>
      <div class="grid2">
        <div><label>Job title</label><input name="title" placeholder="Finisher, CNC…"></div>
        <div><label>Role</label><select name="role">${assignable.map((r) => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join("")}</select></div>
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
        <div class="row wrap"><button class="btn primary">Save</button><button type="button" class="btn" id="reset">Reset password</button><button type="button" class="btn" data-close>Cancel</button></div>
      </form>`, (r, close) => {
      r.querySelector("#f").onsubmit = async (e) => {
        e.preventDefault();
        const f = formData(e.target);
        const ok = await adminCall({ action: "update", id: p.id, ...f, daily_ai_limit: Number(f.daily_ai_limit) });
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
    update_sop: "edited SOP", create_sop: "created SOP", delete_sop: "deleted SOP", password_changed: "changed password" };
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
