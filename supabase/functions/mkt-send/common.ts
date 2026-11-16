import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const ROLE_ORDER = ["pending", "shop", "lead", "admin", "owner"] as const;
export type Role = typeof ROLE_ORDER[number];
export const rank = (r: string) => ROLE_ORDER.indexOf(r as Role);

export interface Caller {
  userClient: SupabaseClient;
  service: SupabaseClient;
  user: { id: string; email?: string };
  profile: { id: string; full_name: string; role: Role; active: boolean; daily_ai_limit: number };
}

/** Resolves the signed-in caller from the request, or returns an error Response. */
export async function getCaller(req: Request): Promise<Caller | Response> {
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Not signed in" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return json({ error: "Not signed in" }, 401);

  const { data: profile } = await service
    .from("profiles")
    .select("id, full_name, role, active, daily_ai_limit")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.active || profile.role === "pending") {
    return json({ error: "Your account isn't active yet. Ask Mitchell to set your role." }, 403);
  }
  return { userClient, service, user, profile };
}
