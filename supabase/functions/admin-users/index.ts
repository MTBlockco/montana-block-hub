// Team management: create logins, change roles, deactivate, reset passwords.
// Owner and admins can manage shop/lead accounts; only the owner can manage admins.
import { cors, json, getCaller, rank } from "./common.ts";

const ROLES = ["pending", "shop", "lead", "admin", "owner"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const caller = await getCaller(req);
  if (caller instanceof Response) return caller;
  const { service, user, profile } = caller;

  if (rank(profile.role) < rank("admin")) return json({ error: "Only Mitchell or an admin can manage the team." }, 403);
  const isOwner = profile.role === "owner";

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  // Can the caller assign this role / manage this person?
  const canAssign = (role: string) => ROLES.includes(role) && role !== "owner" && (isOwner || rank(role) < rank("admin"));
  const canManage = async (id: string) => {
    if (id === user.id) return false; // nobody edits their own access
    const { data } = await service.from("profiles").select("role").eq("id", id).single();
    if (!data) return false;
    return isOwner ? data.role !== "owner" : rank(data.role) < rank("admin");
  };

  if (action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const role = String(body.role ?? "shop");
    if (!email.includes("@")) return json({ error: "Enter a valid email" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (!canAssign(role)) return json({ error: "You can't assign that role" }, 403);

    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: String(body.full_name ?? "").trim() },
      app_metadata: { initial_role: role },
    });
    if (error) return json({ error: error.message }, 400);

    await service.from("profiles").update({
      full_name: String(body.full_name ?? "").trim(),
      title: body.title ? String(body.title).trim() : null,
      role,
      must_change_password: true,
    }).eq("id", data.user.id);

    return json({ ok: true, id: data.user.id });
  }

  if (action === "update") {
    const id = String(body.id ?? "");
    if (!(await canManage(id))) return json({ error: "You can't edit that person" }, 403);
    const patch: Record<string, unknown> = {};
    if (body.full_name !== undefined) patch.full_name = String(body.full_name).trim();
    if (body.title !== undefined) patch.title = body.title ? String(body.title).trim() : null;
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (body.daily_ai_limit !== undefined) patch.daily_ai_limit = Math.max(0, Math.min(200, Number(body.daily_ai_limit) || 0));
    if (body.role !== undefined) {
      if (!canAssign(String(body.role))) return json({ error: "You can't assign that role" }, 403);
      patch.role = String(body.role);
    }
    const { error } = await service.from("profiles").update(patch).eq("id", id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "set_password") {
    const id = String(body.id ?? "");
    const password = String(body.password ?? "");
    if (!(await canManage(id))) return json({ error: "You can't edit that person" }, 403);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    const { error } = await service.auth.admin.updateUserById(id, { password });
    if (error) return json({ error: error.message }, 400);
    await service.from("profiles").update({ must_change_password: true }).eq("id", id);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
