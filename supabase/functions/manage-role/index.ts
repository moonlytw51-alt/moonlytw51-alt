import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Метод не поддерживается" });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: caller, error: callerError } = await admin.auth.getUser(token);
    if (callerError || caller.user?.app_metadata?.role !== "developer") return json(403, { error: "Только разработчик может менять роли" });
    const { playerId, role } = await req.json();
    const id = String(playerId ?? "").trim().toLowerCase();
    const allowed = ["member", "deputy", "leader", "developer"];
    if (!/^[a-z0-9_]{3,24}$/.test(id) || !allowed.includes(role)) return json(400, { error: "Проверь ID и роль" });
    const { data: profile, error } = await admin.from("profiles").select("user_id, role").eq("player_id", id).single();
    if (error || !profile) return json(404, { error: "Аккаунт не найден" });
    if (profile.user_id === caller.user.id && role !== "developer") return json(400, { error: "Нельзя снять роль разработчика со своего аккаунта здесь" });
    if (profile.role === "developer" && role !== "developer") {
      const { count, error: countError } = await admin.from("profiles").select("user_id", { count: "exact", head: true }).eq("role", "developer");
      if (countError) return json(500, { error: "Не удалось проверить разработчиков" });
      if ((count ?? 0) < 2) return json(409, { error: "Нельзя убрать последнюю роль разработчика" });
    }
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(profile.user_id);
    if (targetError || !target.user) return json(500, { error: "Не удалось открыть аккаунт" });
    const { error: authError } = await admin.auth.admin.updateUserById(profile.user_id, { app_metadata: { ...target.user.app_metadata, role } });
    if (authError) return json(500, { error: "Не удалось обновить права входа" });
    const { error: profileError } = await admin.from("profiles").update({ role }).eq("user_id", profile.user_id);
    if (profileError) return json(500, { error: "Права входа обновлены; профиль не обновился, проверь панель" });
    return json(200, { ok: true });
  } catch { return json(400, { error: "Не удалось изменить роль" }); }
});
