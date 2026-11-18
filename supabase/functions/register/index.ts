import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Метод не поддерживается" });
  try {
    const { playerId, nickname, password } = await req.json();
    const id = String(playerId ?? "").trim().toLowerCase();
    const nick = String(nickname ?? "").trim();
    if (!/^[a-z0-9_]{3,24}$/.test(id)) return json(400, { error: "ID: 3–24 символа, латинские буквы, цифры и _" });
    if (nick.length < 2 || nick.length > 32) return json(400, { error: "Ник должен быть длиной 2–32 символа" });
    if (typeof password !== "string" || password.length < 10 || password.length > 128) return json(400, { error: "Пароль должен быть длиной 10–128 символов" });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const email = `${id}@members.askorbinki.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { player_id: id } });
    if (error || !data.user) return json(400, { error: "Этот ID уже занят или данные не приняты" });
    const { error: profileError } = await admin.from("profiles").insert({ user_id: data.user.id, player_id: id, nickname: nick, role: "member" });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return json(400, { error: "Не удалось создать профиль; попробуй другой ID" });
    }
    return json(201, { ok: true });
  } catch { return json(400, { error: "Проверь поля регистрации" }); }
});
