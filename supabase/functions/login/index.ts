import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Метод не поддерживается" });
  try {
    const { playerId, password } = await req.json();
    const id = String(playerId ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(id) || typeof password !== "string") return json(400, { error: "Неверный ID или пароль" });
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data, error } = await client.auth.signInWithPassword({ email: `${id}@members.askorbinki.invalid`, password });
    if (error || !data.session) return json(401, { error: "Неверный ID или пароль" });
    return json(200, { session: data.session });
  } catch { return json(400, { error: "Не удалось выполнить вход" }); }
});
