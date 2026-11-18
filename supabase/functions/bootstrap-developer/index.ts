import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
const equalSecret = (a: string, b: string) => {
  const enc = new TextEncoder(), aa = enc.encode(a), bb = enc.encode(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Метод не поддерживается" });
  try {
    const secret = req.headers.get("x-bootstrap-secret") ?? "";
    const expected = Deno.env.get("BOOTSTRAP_SECRET") ?? "";
    if (!expected || !equalSecret(secret, expected)) return json(403, { error: "Начальная настройка не разрешена" });
    const { playerId } = await req.json();
    const id = String(playerId ?? "").trim().toLowerCase();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: devs, error: checkError } = await admin.from("profiles").select("user_id").eq("role", "developer").limit(1);
    if (checkError) return json(500, { error: "Не удалось проверить статус настройки" });
    if (devs?.length) return json(409, { error: "Разработчик уже назначен" });
    const { data: profile, error } = await admin.from("profiles").select("user_id").eq("player_id", id).single();
    if (error || !profile) return json(404, { error: "Сначала зарегистрируй аккаунт с этим ID" });
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
    if (userError || !userData.user) return json(500, { error: "Не удалось открыть аккаунт" });
    const { error: roleError } = await admin.auth.admin.updateUserById(profile.user_id, { app_metadata: { ...userData.user.app_metadata, role: "developer" } });
    if (roleError) return json(500, { error: "Не удалось назначить роль" });
    const { error: profileUpdateError } = await admin.from("profiles").update({ role: "developer" }).eq("user_id", profile.user_id);
    if (profileUpdateError) return json(500, { error: "Роль назначена частично; повтори настройку после проверки" });
    return json(200, { ok: true, message: "Роль разработчика назначена. Войди в аккаунт заново." });
  } catch { return json(400, { error: "Проверь ID и секрет" }); }
});
