// Mmiliki anaunda akaunti ya wakala (barua pepe + nenosiri) na kumpangia kibanda.
import { caller, cors, json } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile, sb } = await caller(req);
    if (profile.role !== "owner") return json({ error: "Mmiliki pekee anaweza kuongeza wakala" }, 403);

    const { email, password, full_name, phone, outlet_id } = await req.json();
    if (!email || !password || !full_name) return json({ error: "Jaza jina, barua pepe na nenosiri" }, 400);
    if (String(password).length < 6) return json({ error: "Nenosiri liwe na herufi 6 au zaidi" }, 400);

    if (outlet_id) {
      const { data: o } = await sb.from("outlets").select("id").eq("id", outlet_id)
        .eq("business_id", profile.business_id).maybeSingle();
      if (!o) return json({ error: "Kibanda hakipo" }, 400);
    }

    const { data: created, error } = await sb.auth.admin.createUser({
      email: String(email).trim().toLowerCase(), password, email_confirm: true,
      user_metadata: { full_name },
    });
    if (error) return json({ error: error.message.includes("already") ? "Barua pepe hii tayari inatumika" : error.message }, 400);

    const { error: pErr } = await sb.from("profiles").insert({
      id: created.user.id, business_id: profile.business_id, full_name, phone,
      email: String(email).trim().toLowerCase(), role: "agent", outlet_id: outlet_id ?? null,
    });
    if (pErr) {
      await sb.auth.admin.deleteUser(created.user.id);
      return json({ error: pErr.message }, 400);
    }
    return json({ ok: true, id: created.user.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
