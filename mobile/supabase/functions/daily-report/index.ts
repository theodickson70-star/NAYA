// Ripoti ya siku kwa SMS kwa kila mmiliki. Inaitwa na pg_cron saa 3:00 usiku (21:00 EAT).
import { admin, json } from "../_shared/util.ts";

const fmt = (n: number) => "TSh " + Math.round(n).toLocaleString("en");

Deno.serve(async (req) => {
  // Kinga: ni pg_cron tu (yenye CRON_SECRET) inayoruhusiwa kuita function hii
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);
  const sb = admin();
  // Tarehe ya leo kwa saa za Afrika Mashariki
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const from = `${today}T00:00:00+03:00`, to = `${today}T23:59:59+03:00`;

  const { data: businesses } = await sb.from("businesses").select("*")
    .eq("sms_daily_report", true).gt("subscription_until", new Date().toISOString());

  let queued = 0;
  for (const b of businesses ?? []) {
    if (!b.owner_phone) continue;
    const { data: tx } = await sb.from("transactions").select("tx_type, amount, commission")
      .eq("business_id", b.id).eq("voided", false).gte("created_at", from).lte("created_at", to);
    const { data: sessions } = await sb.from("sessions").select("id, status, cash_variance, outlet_id")
      .eq("business_id", b.id).eq("work_date", today);
    const ids = (sessions ?? []).map((s) => s.id);
    const { data: floats } = ids.length
      ? await sb.from("session_floats").select("variance").in("session_id", ids)
      : { data: [] as { variance: number | null }[] };

    const dep = (tx ?? []).filter((t) => t.tx_type === "deposit").reduce((a, t) => a + Number(t.amount), 0);
    const wd = (tx ?? []).filter((t) => t.tx_type === "withdrawal").reduce((a, t) => a + Number(t.amount), 0);
    const comm = (tx ?? []).reduce((a, t) => a + Number(t.commission), 0);
    const variance = (sessions ?? []).reduce((a, s) => a + Number(s.cash_variance ?? 0), 0)
      + (floats ?? []).reduce((a, f) => a + Number(f.variance ?? 0), 0);
    const open = (sessions ?? []).filter((s) => s.status === "open").length;

    const msg = `PayPoint ${today}: Miamala ${tx?.length ?? 0}. Kuweka ${fmt(dep)}, Kutoa ${fmt(wd)}. ` +
      `Kamisheni ${fmt(comm)}. ${variance < 0 ? "Upungufu" : "Tofauti"}: ${fmt(variance)}.` +
      (open ? ` Vibanda ${open} bado havijafunga siku.` : "");

    await sb.from("notifications").insert({
      business_id: b.id, kind: "daily_report", message: msg, phone: b.owner_phone, status: "pending",
    });
    queued++;
  }
  return json({ queued });
});
