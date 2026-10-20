// 0.26.1 SMS kwenye matukio muhimu yaliyokuwa na arifa ya app tu: akaunti kusimamishwa/kufunguliwa, password kubadilishwa,
// wallet ya dereva kusimamishwa/kufunguliwa/kurekebishwa, ada iliyorekodiwa na ofisi, pesa za mteja (salio, kurudishiwa salio,
// marejesho ya mkono), jibu la msaada (mara moja kila saa 6), na password ya muda ya dereva aliyesajiliwa na NAYA Staff.
// SMS halisi hazitumwi (setSmsSenderForTests). DB ya majaribio tu.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { changePassword, hashPassword } from '../src/services/auth.js';
import { reactivateUser, suspendUser } from '../src/services/admin-users.js';
import { adjustWallet, setWalletActive } from '../src/services/wallet.js';
import { recordPayment } from '../src/services/subscriptions.js';
import { refundCustomer } from '../src/services/refunds.js';
import { markCashoutDone, requestCashout } from '../src/services/customer-wallet.js';
import { markRefunded } from '../src/services/ride-payments.js';
import { createTicket, replyAsStaff } from '../src/services/support.js';
import { registerDriver } from '../src/services/staff.js';
import { setSmsSenderForTests } from '../src/services/sms.js';

const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const PASSWORD = 'NayaTest#2026';
const ids: Record<string, string> = {};
const userIds: string[] = [];
const sent: Array<{ phone: string; message: string }> = [];
const intl = (local: string) => `255${local.slice(1)}`;
const phoneOf: Record<string, string> = {};

async function makeUser(key: string, phone: string, name: string, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, phone_verified_at) VALUES ($1, $2, $3, $4, now()) RETURNING id`,
    [intl(phone), name, role, await hashPassword(PASSWORD)],
  );
  ids[key] = row.rows[0].id;
  phoneOf[key] = intl(phone);
  userIds.push(row.rows[0].id);
}
/** SMS za mtu huyu tangu `from`. */
const smsTo = (key: string, from: number) => sent.slice(from).filter((m) => m.phone === phoneOf[key]).map((m) => m.message);
async function waitSms(key: string, from: number, n = 1) {
  for (let i = 0; i < 50; i++) {
    if (smsTo(key, from).length >= n) return smsTo(key, from);
    await new Promise((r) => setTimeout(r, 20));
  }
  return smsTo(key, from);
}

before(async () => {
  await runMigrations(() => {});
  setSmsSenderForTests(async (phone, message) => {
    sent.push({ phone, message });
    return { ok: true, requestId: 'test' };
  });
  await makeUser('admin', `0780${s}`, 'Ofisi Pengo', 'ADMIN');
  await makeUser('p1', `0781${s}`, `Amina Pengo ${s}`);
  await makeUser('d1', `0782${s}`, `Rashidi Pengo ${s}`);
  await makeUser('staff', `0783${s}`, `Staff Pengo ${s}`, 'STAFF');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, license_number, paid_until) VALUES ($1, 'APPROVED', 'BODABODA', $2, 'DL1', now() + interval '5 days')`,
    [ids.d1, `MC ${s.slice(-3)} PNG`],
  );
});

after(async () => {
  setSmsSenderForTests(null);
  const all = [...userIds];
  const newDriver = (await db.query('SELECT id FROM naya.users WHERE phone = $1', [intl(`0784${s}`)])).rows[0]?.id;
  if (newDriver) all.push(newDriver);
  await db.query('DELETE FROM naya.support_messages WHERE ticket_id IN (SELECT id FROM naya.support_tickets WHERE user_id = ANY($1::uuid[]))', [all]).catch(() => {});
  await db.query('DELETE FROM naya.support_tickets WHERE user_id = ANY($1::uuid[])', [all]).catch(() => {});
  await db.query('DELETE FROM naya.wallet_entries WHERE driver_id = ANY($1::uuid[])', [all]);
  await db.query('DELETE FROM naya.wallets WHERE driver_id = ANY($1::uuid[])', [all]);
  await db.query('DELETE FROM naya.subscription_payments WHERE driver_id = ANY($1::uuid[])', [all]);
  await db.query('DELETE FROM naya.customer_wallet_entries WHERE user_id = ANY($1::uuid[])', [all]);
  await db.query('DELETE FROM naya.customer_wallets WHERE user_id = ANY($1::uuid[])', [all]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[])', [all]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [all]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [all]);
  await db.query('DELETE FROM naya.sms_log WHERE phone IN (SELECT phone FROM naya.users WHERE id = ANY($1::uuid[]))', [all]);
  await db.query('DELETE FROM naya.drivers WHERE user_id = ANY($1::uuid[])', [all]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [all]);
  await db.end();
});

describe('NAYA 0.26.1 — SMS kwenye matukio muhimu', () => {
  it('akaunti kusimamishwa (pamoja na sababu na namba ya ofisi) na kufunguliwa', async () => {
    let from = sent.length;
    await suspendUser(ids.admin, ids.p1, 'Malalamiko ya madereva');
    let m = await waitSms('p1', from);
    assert.equal(m.length, 1);
    assert.match(m[0], /Akaunti yako imesimamishwa: Malalamiko ya madereva\. .*0628 986 770/);
    from = sent.length;
    await reactivateUser(ids.admin, ids.p1);
    m = await waitSms('p1', from);
    assert.match(m[0], /imefunguliwa tena/);
  });

  it('password ikibadilishwa → SMS ya tahadhari', async () => {
    const from = sent.length;
    await changePassword(ids.p1, PASSWORD, 'NayaMpya#2026');
    const m = await waitSms('p1', from);
    assert.match(m[0], /Password ya akaunti yako imebadilishwa\. Kama si wewe/);
  });

  it('wallet ya dereva: kusimamishwa, kufunguliwa, na marekebisho ya ofisi', async () => {
    const from = sent.length;
    await setWalletActive(ids.admin, ids.d1, false, 'Ukaguzi wa muamala');
    await setWalletActive(ids.admin, ids.d1, true, null);
    await adjustWallet(ids.admin, ids.d1, { amount: 2500, reason: 'Fidia ya safari' });
    const m = await waitSms('d1', from, 3);
    assert.equal(m.length, 3);
    assert.match(m[0], /Wallet yako imesimamishwa kwa muda: Ukaguzi wa muamala\. Salio lako liko salama/);
    assert.match(m[1], /Wallet yako imefunguliwa tena/);
    assert.match(m[2], /Ofisi imeongeza TSh 2,500 kwenye wallet yako: Fidia ya safari/);
  });

  it('ada iliyorekodiwa na ofisi kwa mkono → SMS', async () => {
    const from = sent.length;
    await recordPayment(ids.admin, ids.d1, { months: 1, method: 'CASH', reference: null, note: null });
    const m = await waitSms('d1', from);
    assert.match(m[0], /^NAYA: TSh [\d,]+ imerekodiwa\. Ada yako iko hai mpaka/);
  });

  it('pesa za mteja: kurudishiwa kwenye salio, salio kurudishwa kwenye simu, marejesho ya mkono', async () => {
    let from = sent.length;
    await refundCustomer(ids.admin, ids.p1, { amount: 1500, to: 'SALIO', reason: 'COMPENSATION', note: 'Dereva alichelewa' });
    let m = await waitSms('p1', from);
    assert.match(m[0], /Umerudishiwa TSh 1,500 kwenye Salio lako la NAYA\. Salio sasa: TSh 1,500/);

    from = sent.length;
    await requestCashout(ids.p1, phoneOf.p1);
    await markCashoutDone(ids.admin, ids.p1, 1500, 'ABL-1');
    m = await waitSms('p1', from);
    assert.match(m[0], /Tumekutumia TSh 1,500 kutoka Salio lako la NAYA/);

    const loc = await db.query(`SELECT id, name, lat, lng FROM naya.locations LIMIT 1`);
    if (loc.rows.length) {
      const l = loc.rows[0];
      const r = await db.query(
        `INSERT INTO naya.rides (passenger_id, vehicle_type, pickup_location_id, pickup_name, pickup_lat, pickup_lng, dest_location_id, dest_name, dest_lat, dest_lng,
                                 distance_km, fare, status, cancelled_at, cancelled_by, fare_settlement, fare_refund)
         VALUES ($1, 'BODABODA', $2, $3, $4, $5, $2, $3, $4, $5, 1, 2000, 'CANCELLED', now(), 'PASSENGER', 'MOBILE', 'NEEDED') RETURNING id`,
        [ids.p1, l.id, l.name, l.lat, l.lng],
      );
      from = sent.length;
      await markRefunded(ids.admin, r.rows[0].id, 'Send ABL-2');
      m = await waitSms('p1', from);
      assert.match(m[0], /Tumekurudishia pesa uliyolipa kwa safari ambayo haikufanyika/);
    }
  });

  it('jibu la msaada → SMS fupi, lakini mara moja tu kila saa 6', async () => {
    const t = await createTicket(ids.p1, { category: 'APP', message: 'App haifunguki', role: 'PASSENGER' });
    const ticketId = (t as any).id ?? (t as any).ticket?.id ?? (await db.query('SELECT id FROM naya.support_tickets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [ids.p1])).rows[0].id;
    const from = sent.length;
    await replyAsStaff(ids.admin, ticketId, { body: 'Pakua toleo jipya kutoka ukurasa wa kupakua.' });
    await waitSms('p1', from);
    await replyAsStaff(ids.admin, ticketId, { body: 'Je, imefanya kazi?' });
    await new Promise((r) => setTimeout(r, 100));
    const m = smsTo('p1', from);
    assert.equal(m.length, 1, 'jibu la pili ndani ya saa 6 halileti SMS');
    assert.match(m[0], /Ofisi ya NAYA imejibu ombi lako la msaada/);
    assert.equal(m[0].includes('Pakua'), false, 'maandishi ya jibu hayatumwi kwa SMS');
  });

  it('dereva aliyesajiliwa na NAYA Staff → password ya muda kwa SMS', async () => {
    const from = sent.length;
    const r = await registerDriver(ids.staff, {
      fullName: `Hassani Mpya ${s}`,
      phone: intl(`0784${s}`),
      vehicle: { vehicleType: 'BODABODA', plateNumber: `MC ${s.slice(-3)} PNH`, vehicleMake: 'Boxer', vehicleModel: null, vehicleColor: 'Nyeusi', licenseNumber: 'DL9', nationalIdNumber: null },
    });
    assert.equal(r.smsSent, true);
    const m = sent.slice(from).filter((x) => x.phone === intl(`0784${s}`));
    assert.equal(m.length, 1);
    assert.ok(m[0].message.includes(r.tempPassword), 'password ya muda iko kwenye SMS');
    assert.match(m[0].message, /Akaunti yako ya dereva imefunguliwa/);
  });

  it('SMS zote mpya ni SMS 1 (herufi ≤ 160)', () => {
    const long = sent.filter((m) => m.message.length > 160 && m.message.startsWith('NAYA'));
    assert.deepEqual(long.map((m) => m.message), []);
  });
});
