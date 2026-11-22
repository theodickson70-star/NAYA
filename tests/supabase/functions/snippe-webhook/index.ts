// Snippe inatuma taarifa ya malipo hapa. Hatuamini body moja kwa moja:
// tunauliza Snippe hali halisi ya malipo kwa reference kabla ya kuwasha usajili.
// Deploy kwa: supabase functions deploy snippe-webhook --no-verify-jwt
import { admin, json, sendBeemSms } from "../_shared/util.ts";

Deno.serve(async (req) => {
  try {
    const evt = await req.json().catch(() => ({}));
    const reference = evt?.data?.reference ?? evt?.reference;
    if (!reference) return json({ ok: true });

    const sb = admin();
    const { data: pay } = await sb.from("subscription_payments").select("*").eq("reference", reference).maybeSingle();
    if (!pay || pay.status === "completed") return json({ ok: true });

    // Thibitisha moja kwa moja kwa Snippe
    const res = await fetch(`https://api.snippe.sh/v1/payments/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("SNIPPE_API_KEY")}` },
    });
    const body = await res.json().catch(() => ({}));
    const status = String(body?.data?.status ?? body?.status ?? "").toLowerCase();
    const paid = Number(body?.data?.amount?.value ?? body?.data?.amount ?? 0);

    if (status === "completed" && paid >= pay.amount) {
      const { data: biz } = await sb.from("businesses").select("*").eq("id", pay.business_id).single();
      const base = new Date(Math.max(Date.now(), new Date(biz.subscription_until).getTime()));
      base.setMonth(base.getMonth() + pay.months);
      await sb.from("businesses").update({ plan: pay.plan, subscription_until: base.toISOString() }).eq("id", pay.business_id);
      await sb.from("subscription_payments").update({ status: "completed", completed_at: new Date().toISOString(), raw: body }).eq("id", pay.id);
      if (biz.owner_phone) {
        await sendBeemSms(biz.owner_phone,
          `WakalaLink: Malipo ya TSh ${pay.amount.toLocaleString("en")} yamepokelewa. Usajili wako upo hai hadi ${base.toISOString().slice(0, 10)}. Asante!`);
      }
    } else if (status === "failed" || status === "cancelled" || status === "expired") {
      await sb.from("subscription_payments").update({ status: "failed", raw: body }).eq("id", pay.id);
    }
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: false }, 200);
  }
});
