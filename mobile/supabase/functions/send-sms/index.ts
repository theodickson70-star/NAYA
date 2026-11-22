// Inatuma arifa zote zinazosubiri (pending) kupitia Beem.
// Inaitwa na pg_cron kila dakika 1 (angalia README).
import { admin, json, sendBeemSms } from "../_shared/util.ts";

Deno.serve(async (req) => {
  // Kinga: ni pg_cron tu (yenye CRON_SECRET) inayoruhusiwa kuita function hii
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "forbidden" }, 403);
  const sb = admin();
  const { data: rows } = await sb.from("notifications").select("*")
    .eq("status", "pending").order("created_at").limit(50);
  let sent = 0;
  for (const n of rows ?? []) {
    if (!n.phone) { await sb.from("notifications").update({ status: "skipped" }).eq("id", n.id); continue; }
    const ok = await sendBeemSms(n.phone, n.message);
    await sb.from("notifications").update({ status: ok ? "sent" : "failed", sent_at: new Date().toISOString() }).eq("id", n.id);
    if (ok) sent++;
  }
  return json({ processed: rows?.length ?? 0, sent });
});
