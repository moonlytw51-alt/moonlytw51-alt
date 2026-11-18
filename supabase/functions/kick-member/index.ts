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
    const callerRole = caller.user?.app_metadata?.role;
    if (callerError || !caller.user || !["leader", "deputy", "developer"].includes(callerRole)) {
      return json(403, { error: "Только штаб может исключать участников" });
    }

    const { playerId } = await req.json();
    const id = String(playerId ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(id)) return json(400, { error: "Проверь ID участника" });
    const { data: target, error: targetError } = await admin.from("profiles")
      .select("user_id,player_id,role,kicked_at").eq("player_id", id).maybeSingle();
    if (targetError) {
      console.error("kick-member profile lookup failed", targetError.code, targetError.message);
      return json(500, { error: "Не удалось найти аккаунт" });
    }
    if (!target || target.kicked_at) return json(404, { error: "Аккаунт не найден в активном составе" });
    if (target.user_id === caller.user.id) return json(400, { error: "Нельзя исключить свой аккаунт" });

    const allowed = callerRole === "leader" ? ["member", "deputy"]
      : callerRole === "deputy" ? ["member"]
      : ["member", "deputy", "leader"];
    if (!allowed.includes(target.role)) return json(403, { error: "Твоя роль не может исключить этот аккаунт" });

    const { data: updated, error: updateError } = await admin.from("profiles")
      .update({ kicked_at: new Date().toISOString(), kicked_by: caller.user.id })
      .eq("user_id", target.user_id).is("kicked_at", null).select("user_id").maybeSingle();
    if (updateError || !updated) {
      console.error("kick-member profile update failed", updateError?.code, updateError?.message);
      return json(500, { error: "Не удалось исключить аккаунт" });
    }

    const { data: targetAuth, error: getUserError } = await admin.auth.admin.getUserById(target.user_id);
    if (getUserError || !targetAuth.user) {
      console.error("kick-member auth lookup failed", getUserError?.message);
      return json(200, { ok: true, message: "Участник исключён из состава" });
    }
    const { error: banError } = await admin.auth.admin.updateUserById(target.user_id, {
      ban_duration: "876000h",
      app_metadata: { ...targetAuth.user.app_metadata, role: "kicked" },
    });
    if (banError) console.error("kick-member auth ban failed", banError.message);
    return json(200, { ok: true, message: "Участник исключён из состава" });
  } catch (error) {
    console.error("kick-member request failed", error instanceof Error ? error.message : String(error));
    return json(400, { error: "Не удалось выполнить исключение" });
  }
});

