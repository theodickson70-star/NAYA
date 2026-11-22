// Mmiliki analipia usajili: USSD push ya Snippe inaenda kwenye simu yake.
import { caller, cors, json, normalizePhone } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { user, profile, sb } = await caller(req);
    if (profile.role !== "owner") return json({ error: "Mmiliki pekee" }, 403);

    const { plan, months = 1, phone } = await req.json();
    const m = Math.max(1, Math.min(12, Number(months) || 1));
    const { data: p } = await sb.from("plans").select("*").eq("code", plan).single();
    if (!p) return json({ error: "Mpango haupo" }, 400);
    const amount = p.price_tzs * m;
    const msisdn = normalizePhone(phone ?? profile.phone ?? "");
    if (msisdn.length !== 12) return json({ error: "Namba ya simu si sahihi" }, 400);

    const { data: pay, error } = await sb.from("subscription_payments").insert({
      business_id: profile.business_id, plan, months: m, amount, phone: msisdn,
    }).select().single();
    if (error) return json({ error: error.message }, 400);

    const [first, ...rest] = String(profile.full_name ?? "Mteja WakalaLink").split(" ");
    const res = await fetch("https://api.snippe.sh/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SNIPPE_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": pay.id,
      },
      body: JSON.stringify({
        payment_type: "mobile",
        details: { amount, currency: "TZS" },
        phone_number: msisdn,
        customer: { firstname: first, lastname: rest.join(" ") || first, email: user.email },
        webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/snippe-webhook`,
        metadata: { payment_id: pay.id, business_id: profile.business_id, app: "wakalalink" },
      }),
    });
    const body = await res.json().catch(() => ({}));
    const reference = body?.data?.reference ?? body?.reference;
    if (!res.ok || !reference) {
      await sb.from("subscription_payments").update({ status: "failed", raw: body }).eq("id", pay.id);
      return json({ error: body?.message ?? "Imeshindwa kuanzisha malipo" }, 400);
    }
    await sb.from("subscription_payments").update({ reference, raw: body }).eq("id", pay.id);
    return json({ ok: true, reference, amount, message: "Angalia simu yako, weka PIN kuthibitisha malipo." });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
