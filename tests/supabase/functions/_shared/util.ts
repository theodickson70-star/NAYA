import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Rudisha mtumiaji aliyeingia (kutoka kwenye Authorization header) na profile yake. */
export async function caller(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const sb = admin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new Error("Hujaingia");
  const { data: profile } = await sb.from("profiles").select("*").eq("id", data.user.id).single();
  if (!profile) throw new Error("Akaunti haijasajiliwa");
  return { user: data.user, profile, sb };
}

/** 07xxxxxxxx / +2557xxxxxxxx -> 2557xxxxxxxx */
export function normalizePhone(p: string): string {
  let d = (p ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "255" + d.slice(1);
  if (d.length === 9) d = "255" + d;
  return d;
}

/** Tuma SMS kupitia Beem Africa */
export async function sendBeemSms(phone: string, message: string): Promise<boolean> {
  const key = Deno.env.get("BEEM_API_KEY");
  const secret = Deno.env.get("BEEM_SECRET_KEY");
  const sender = Deno.env.get("BEEM_SENDER_ID") ?? "INFO";
  if (!key || !secret) { console.log("Beem keys hazipo — SMS haikutumwa:", message); return false; }
  const res = await fetch("https://apisms.beem.africa/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${key}:${secret}`) },
    body: JSON.stringify({
      source_addr: sender, encoding: 0, schedule_time: "", message,
      recipients: [{ recipient_id: 1, dest_addr: normalizePhone(phone) }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok && (body?.successful === true || body?.code === 100);
}
