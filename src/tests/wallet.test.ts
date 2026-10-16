// 0.21.0 Wallet ya dereva — kwa kampuni BANDIA ya majaribio (simulator):
//   ada ya kutuma ya bandia = 2%; namba ...0000 → kutuma kunashindwa; ...8888 → mtandao haujui jina.
// Inakagua pesa kwa ukali: ledger = salio, hakuna salio hasi, hakuna kukatwa mara mbili, mashindano ya maombi mawili,
// PIN (dhaifu / makosa / kufungwa / kusahau), saa 24 baada ya kubadilisha namba, ada kwa salio, marekebisho ya ofisi.
// Database ya MAJARIBIO tu.
process.env.PAYMENT_PROVIDER = 'simulator';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { applyResult, checkPendingPayments, insertPayment } from '../src/services/payments/index.js';
import { transaction } from '../src/db/pool.js';
import { lockWallet, postEntry } from '../src/services/wallet-ledger.js';
import { weakPin } from '../src/services/wallet.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const PASSWORD = 'NayaTest#2026';
const PIN = '4827';
const userIds: string[] = [];
const locationIds: string[] = [];
const promoIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.74.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}
const intl = (local: string) => `255${local.slice(1)}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A = { lat: -8.2, lng: 35.4 };
const B = { lat: -8.215, lng: 35.41 };
const NEAR_B = { lat: -8.2145, lng: 35.41 };

async function makeUser(key: string, phone: string, name: string, mode: string | null, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [intl(phone), name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}
async function makeDriver(key: string, phone: string, name: string, plate: string) {
  await makeUser(key, phone, name, 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '10 days')`,
    [ids[key], plate],
  );
}
const wallet = async (who: string) => (await call('GET', '/api/driver/wallet', undefined, who)).json.data;
const ledgerSum = async (key: string) =>
  Number((await db.query('SELECT coalesce(sum(amount), 0) AS s FROM naya.wallet_entries WHERE driver_id = $1', [ids[key]])).rows[0].s);
const dbBalance = async (key: string) => (await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids[key]])).rows[0]?.balance;
const credit = (key: string, amount: number) => call('POST', `/api/admin/wallets/${ids[key]}/adjust`, { amount, reason: 'Majaribio ya wallet' }, 'admin');
const clearHold = (key: string) => db.query('UPDATE naya.wallets SET hold_until = NULL WHERE driver_id = $1', [ids[key]]);
const ride = async (id: string) => (await db.query('SELECT * FROM naya.rides WHERE id = $1', [id])).rows[0];
async function rideState(id: string, until: (r: any) => boolean) {
  for (let i = 0; i < 60; i++) {
    const r = await ride(id);
    if (until(r)) return r;
    await wait(50);
  }
  return ride(id);
}
async function promoRide(driver: string) {
  assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, driver)).status, 200);
  const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
  assert.equal(res.status, 201, res.json.message);
  const rideId = res.json.data.id;
  const offer = (await call('GET', '/api/driver/state', undefined, driver)).json.data.offer;
  assert.equal(offer?.ride.id, rideId, 'dereva hakupata ombi');
  assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, driver)).status, 200);
  await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, driver);
  const pin = (await db.query('SELECT start_pin FROM naya.rides WHERE id = $1', [rideId])).rows[0].start_pin;
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, pin ? { pin } : {}, driver)).status, 200);
  await db.query(`UPDATE naya.rides SET started_at = now() - interval '6 minutes' WHERE id = $1`, [rideId]);
  await call('POST', '/api/driver/location', NEAR_B, driver);
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/complete`, {}, driver)).status, 200);
  await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
  await call('POST', `/api/driver/rides/${rideId}/close`, {}, driver);
  await call('POST', '/api/driver/online', { online: false }, driver);
  return rideId as string;
}

let pausedBefore: string[] = [];
let feeBefore: unknown = null;
before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  pausedBefore = (await db.query(`UPDATE naya.promotions SET status = 'PAUSED' WHERE status = 'ACTIVE' RETURNING id`)).rows.map((r) => r.id);
  feeBefore = (await db.query(`SELECT value FROM naya.settings WHERE key = 'subscription'`)).rows[0]?.value ?? null;
  await db.query(
    `INSERT INTO naya.settings (key, value) VALUES ('subscription', '{"monthlyFee": 5000, "trialDays": 30, "graceDays": 3, "paymentInstructions": "Lipa ofisini."}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  await db.query(`DELETE FROM naya.settings WHERE key = 'driver_wallet'`); // chaguo-msingi: ofa → wallet
  for (const [name, p] of [[`Pickup W${s}`, A], [`Dest W${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 3000, 0, 3000, 100, 1.3), ('BAJAJI', 4000, 0, 4000, 100, 1.3)`,
  );
  await makeUser('admin', `0730${s}`, 'Ofisi Wallet', null, 'ADMIN');
  await makeUser('p1', `0731${s}`, `Abiria Wallet ${s}`, 'PASSENGER');
  await makeDriver('d1', `0754${s}`, `Boda Wallet ${s}`, `MC ${s.slice(-3)} WL1`);
  await makeDriver('d2', `0757${s}`, `Boda Wallet Pili ${s}`, `MC ${s.slice(-3)} WL2`);
  const promo = await call('POST', '/api/admin/promotions', { name: `Wallet ${s}`, title: 'Nusu bei', audience: 'ALL', discountPercent: 50 }, 'admin');
  promoIds.push(promo.json.data.id);
  await call('POST', `/api/admin/promotions/${promo.json.data.id}/status`, { status: 'ACTIVE' }, 'admin');
});

after(async () => {
  await db.query('DELETE FROM naya.wallet_entries WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.promo_payouts WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.subscription_payments WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.rides SET promo_payment_id = NULL WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.payments WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.promotions WHERE id = ANY($1::uuid[])', [promoIds]);
  await db.query(`UPDATE naya.promotions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [pausedBefore]);
  if (feeBefore) await db.query(`UPDATE naya.settings SET value = $1 WHERE key = 'subscription'`, [JSON.stringify(feeBefore)]);
  await db.query(`DELETE FROM naya.settings WHERE key = 'driver_wallet'`);
  await db.query(`UPDATE naya.settings SET updated_by = NULL WHERE updated_by = ANY($1::uuid[])`, [userIds]);
  await db.query(`DELETE FROM naya.phone_names WHERE phone LIKE $1`, [`%${s}`]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('Wallet — kufunguliwa na PIN', () => {
  it('dereva aliyethibitishwa ana wallet ya TSh 0; kutoa kumefungwa mpaka aweke PIN; asiye dereva → hapana', async () => {
    const w = await wallet('d1');
    assert.equal(w.balance, 0);
    assert.equal(w.pin.set, false);
    assert.equal(w.canWithdraw, false);
    assert.match(w.withdrawBlock, /PIN/);
    assert.notEqual((await call('GET', '/api/driver/wallet', undefined, 'p1')).status, 200);
  });

  it('PIN dhaifu zinakataliwa; password mbaya → 400; PIN inawekwa mara moja tu', async () => {
    assert.equal(weakPin('1234'), true);
    assert.equal(weakPin('0000'), true);
    assert.equal(weakPin('9876'), true);
    assert.equal(weakPin('4827'), false);
    for (const bad of ['1234', '0000', '5555', '7890', s.slice(-4)]) {
      if (!weakPin(bad, intl(`0754${s}`))) continue;
      assert.equal((await call('POST', '/api/driver/wallet/pin', { pin: bad, password: PASSWORD }, 'd1')).status, 400, bad);
    }
    assert.equal((await call('POST', '/api/driver/wallet/pin', { pin: PIN, password: 'kosa-kosa' }, 'd1')).status, 400);
    const ok = await call('POST', '/api/driver/wallet/pin', { pin: PIN, password: PASSWORD }, 'd1');
    assert.equal(ok.status, 200, ok.json.message);
    assert.equal(ok.json.data.pin.set, true);
    assert.equal((await call('POST', '/api/driver/wallet/pin', { pin: '5831', password: PASSWORD }, 'd1')).status, 409);
    const hash = (await db.query('SELECT pin_hash FROM naya.wallets WHERE driver_id = $1', [ids.d1])).rows[0].pin_hash;
    assert.ok(hash.startsWith('$2') && !hash.includes(PIN), 'PIN haihifadhiwi wazi');
  });
});

describe('Wallet — malipo ya ofa yanaingia kwenye wallet', () => {
  it('safari safi ya ofa → +punguzo kwenye wallet, safari PAID, NAYA haidaiwi tena; kurudia hakuongezi', async () => {
    const rideId = await promoRide('d1');
    const r = await rideState(rideId, (x) => x.promo_payout_state === 'PAID');
    assert.equal(r.promo_payout_state, 'PAID');
    const w = await wallet('d1');
    assert.equal(w.balance, r.promo_discount);
    assert.equal(w.entries[0].kind, 'PROMO_EARNING');
    assert.equal(await ledgerSum('d1'), w.balance);
    const pw = (await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data;
    assert.equal(pw.balance, 0); // NAYA haidaiwi — imeingia kwenye wallet
    // payout ya wallet haifutiki kwa "futa malipo" (ingeleta deni mara mbili)
    const payout = (await db.query(`SELECT id FROM naya.promo_payouts WHERE driver_id = $1 AND network = 'WALLET'`, [ids.d1])).rows[0];
    const v = await call('POST', `/api/admin/promo-payouts/void/${payout.id}`, { reason: 'Majaribio ya kufuta' }, 'admin');
    assert.equal(v.status, 409, v.json.message);
    // worker ikizunguka tena: hakuna kuongeza
    await checkPendingPayments();
    assert.equal((await wallet('d1')).balance, r.promo_discount);
  });
});

describe('Wallet — kutoa pesa', () => {
  it('bila namba ya malipo → haiwezekani; namba ikithibitishwa (bila saa 24 kwa namba ya kwanza) → inawezekana', async () => {
    await credit('d1', 20000);
    let w = await wallet('d1');
    assert.match(w.withdrawBlock, /namba/);
    const acc = await call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone: `0754${s}`, pin: PIN }, 'd1');
    assert.equal(acc.status, 200, acc.json.message);
    w = await wallet('d1');
    assert.equal(w.holdUntil, null, 'namba ya kwanza haina saa 24');
    assert.equal(w.canWithdraw, true, w.withdrawBlock);
    assert.equal(w.account.verified, true);
  });

  it('preview: ada (2% ya bandia) na kiasi atakachopokea; kiasi kidogo / juu ya salio / juu ya kikomo → kukataliwa', async () => {
    const p = await call('GET', '/api/driver/wallet/withdraw/preview?amount=10000', undefined, 'd1');
    assert.equal(p.status, 200, p.json.message);
    assert.equal(p.json.data.fee, 200);
    assert.equal(p.json.data.receive, 9800);
    assert.equal((await call('GET', '/api/driver/wallet/withdraw/preview?amount=500', undefined, 'd1')).status, 400);
    assert.equal((await call('GET', '/api/driver/wallet/withdraw/preview?amount=99000', undefined, 'd1')).status, 409);
    assert.equal((await call('GET', '/api/driver/wallet/withdraw/preview?amount=200000', undefined, 'd1')).status, 400);
  });

  it('PIN mbaya → 400 (majaribio yanabaki); mara 5 → imefungwa dakika 30 (423); ofisi inafungua', async () => {
    const before = await wallet('d1');
    const r1 = await call('POST', '/api/driver/wallet/withdraw', { amount: 5000, pin: '1111' }, 'd1');
    assert.equal(r1.status, 400);
    assert.match(r1.json.message, /majaribio 4/);
    for (let i = 0; i < 3; i++) await call('POST', '/api/driver/wallet/withdraw', { amount: 5000, pin: '1112' }, 'd1');
    const r5 = await call('POST', '/api/driver/wallet/withdraw', { amount: 5000, pin: '1113' }, 'd1');
    assert.equal(r5.status, 423);
    assert.equal((await call('POST', '/api/driver/wallet/withdraw', { amount: 5000, pin: PIN }, 'd1')).status, 423, 'hata PIN sahihi wakati imefungwa');
    assert.equal((await wallet('d1')).balance, before.balance, 'hakuna kilichokatwa');
    assert.equal((await call('POST', `/api/admin/wallets/${ids.d1}/unlock-pin`, {}, 'admin')).status, 200);
  });

  it('PIN sahihi → kiasi kinakatwa, pesa inatumwa (kiasi − ada), ledger = salio', async () => {
    const before = await wallet('d1');
    const r = await call('POST', '/api/driver/wallet/withdraw', { amount: 10000, pin: PIN }, 'd1');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.balance, before.balance - 10000);
    const p = (await db.query(`SELECT * FROM naya.payments WHERE user_id = $1 AND kind = 'WALLET_WITHDRAWAL' ORDER BY created_at DESC LIMIT 1`, [ids.d1])).rows[0];
    assert.equal(p.status, 'SUCCESS');
    assert.equal(p.amount, 10000);
    assert.equal(p.meta.receive, 9800);
    assert.equal(p.phone, intl(`0754${s}`));
    assert.equal(await ledgerSum('d1'), await dbBalance('d1'));
    const note = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND kind = 'wallet_withdrawal'`, [ids.d1]);
    assert.equal(note.rowCount, 1);
  });

  it('kutuma kukishindwa (kampuni imekataa) → pesa yote inarudi kwenye wallet, mara moja tu', async () => {
    // Namba ...0000: simulator inakataa kutuma. Ni namba kuu mpya → saa 24 (tunaiondoa kwa majaribio)
    const acc = await call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone: '0754990000', primary: true, pin: PIN }, 'd1');
    assert.equal(acc.status, 200, acc.json.message);
    assert.ok((await wallet('d1')).holdUntil, 'namba kuu mpya → saa 24');
    assert.match((await call('POST', '/api/driver/wallet/withdraw', { amount: 2000, pin: PIN }, 'd1')).json.message, /usalama/i);
    await clearHold('d1');
    const before = (await wallet('d1')).balance;
    const r = await call('POST', '/api/driver/wallet/withdraw', { amount: 2000, pin: PIN }, 'd1');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.balance, before, 'imerudishwa');
    const kinds = (await db.query(`SELECT kind FROM naya.wallet_entries WHERE driver_id = $1 ORDER BY id DESC LIMIT 2`, [ids.d1])).rows.map((x) => x.kind);
    assert.deepEqual(kinds, ['WITHDRAWAL_REVERSAL', 'WITHDRAWAL']);
    // matokeo yakija tena (webhook/worker) → hakuna kurudisha mara ya pili
    const p = (await db.query(`SELECT reference FROM naya.payments WHERE user_id = $1 AND kind = 'WALLET_WITHDRAWAL' ORDER BY created_at DESC LIMIT 1`, [ids.d1])).rows[0];
    await call('POST', `/api/payments/simulator/${p.reference}`, { success: false });
    assert.equal((await wallet('d1')).balance, before);
    assert.equal(await ledgerSum('d1'), await dbBalance('d1'));
    // rudisha namba nzuri kuwa kuu
    const list = (await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data.accounts;
    const good = list.find((a: any) => a.phone === intl(`0754${s}`));
    assert.equal((await call('POST', '/api/driver/payout-accounts', { id: good.id, network: 'MPESA', phone: `0754${s}`, primary: true, pin: PIN }, 'd1')).status, 200);
    await clearHold('d1');
  });

  it('kubadilisha namba ya malipo bila PIN → kukataliwa', async () => {
    const r = await call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone: `0755${s}` }, 'd1');
    assert.equal(r.status, 400);
  });

  it('maombi mawili kwa wakati mmoja: moja tu linapita, salio halishuki chini ya 0', async () => {
    const bal = (await wallet('d1')).balance;
    const amount = Math.floor((bal * 0.6) / 1000) * 1000;
    const [a, b] = await Promise.all([
      call('POST', '/api/driver/wallet/withdraw', { amount, pin: PIN }, 'd1'),
      call('POST', '/api/driver/wallet/withdraw', { amount, pin: PIN }, 'd1'),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], `${a.json.message} / ${b.json.message}`);
    const now = await dbBalance('d1');
    assert.equal(now, bal - amount);
    assert.ok(now >= 0);
    assert.equal(await ledgerSum('d1'), now);
  });

  it('kikomo cha siku kinazuia hata salio likiwepo', async () => {
    await call('PUT', '/api/admin/settings/driver-wallet', { dailyWithdrawLimit: 15000 }, 'admin');
    await credit('d1', 30000);
    const r = await call('POST', '/api/driver/wallet/withdraw', { amount: 10000, pin: PIN }, 'd1');
    assert.equal(r.status, 409);
    assert.match(r.json.message, /kikomo/);
    await call('PUT', '/api/admin/settings/driver-wallet', { dailyWithdrawLimit: 100000 }, 'admin');
  });

  it('ofisi ikisimamisha wallet → kutoa kunazuiwa; ikifungua → kunaruhusiwa', async () => {
    assert.equal((await call('POST', `/api/admin/wallets/${ids.d1}/suspend`, { reason: 'Uchunguzi' }, 'admin')).status, 200);
    const r = await call('POST', '/api/driver/wallet/withdraw', { amount: 1000, pin: PIN }, 'd1');
    assert.equal(r.status, 409);
    assert.match(r.json.message, /imesimamishwa/);
    assert.equal((await call('POST', `/api/admin/wallets/${ids.d1}/activate`, {}, 'admin')).status, 200);
    assert.equal((await wallet('d1')).canWithdraw, true);
  });
});

describe('Wallet — ada ya mwezi kwa salio', () => {
  it('ada inalipwa kwa salio (PIN), siku 30 zinaongezwa; ofisi ikibatilisha → pesa inarudi kwenye wallet', async () => {
    const pu = async () => new Date((await db.query('SELECT paid_until FROM naya.drivers WHERE user_id = $1', [ids.d1])).rows[0].paid_until).getTime();
    const before = await pu();
    const bal = (await wallet('d1')).balance;
    assert.equal((await call('POST', '/api/driver/wallet/subscription', { months: 1, pin: '9999' }, 'd1')).status, 400);
    const r = await call('POST', '/api/driver/wallet/subscription', { months: 1, pin: PIN }, 'd1');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.balance, bal - 5000);
    assert.ok(Math.abs((await pu()) - before - 30 * 86400_000) < 120_000);
    const sp = (await db.query(`SELECT id, method FROM naya.subscription_payments WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 1`, [ids.d1])).rows[0];
    assert.equal(sp.method, 'WALLET');
    const v = await call('POST', `/api/admin/drivers/${ids.d1}/subscription/payments/${sp.id}/void`, { reason: 'Majaribio ya kubatilisha' }, 'admin');
    assert.equal(v.status, 200, v.json.message);
    assert.equal((await wallet('d1')).balance, bal);
    assert.equal(await ledgerSum('d1'), await dbBalance('d1'));
  });

  it('salio lisipotosha → 409, hakuna kinachokatwa', async () => {
    await call('POST', '/api/driver/wallet/pin', { pin: PIN, password: PASSWORD }, 'd2');
    const r = await call('POST', '/api/driver/wallet/subscription', { months: 1, pin: PIN }, 'd2');
    assert.equal(r.status, 409);
    assert.equal((await wallet('d2')).balance, 0);
  });
});

describe('Wallet — kusahau PIN na ofisi', () => {
  it('"Nimesahau PIN" → ofisi inaruhusu → dereva anaweka PIN mpya kwa password; kutoa kunasubiri saa 24', async () => {
    assert.equal((await call('POST', '/api/driver/wallet/pin/forgot', {}, 'd2')).status, 200);
    assert.equal((await call('GET', '/api/admin/wallets/summary', undefined, 'admin')).json.data.pinResets >= 1, true);
    assert.equal((await call('POST', '/api/driver/wallet/pin', { pin: '5831', password: PASSWORD }, 'd2')).status, 409, 'kabla ofisi haijaruhusu');
    assert.equal((await call('POST', `/api/admin/wallets/${ids.d2}/allow-pin-reset`, {}, 'admin')).status, 200);
    const r = await call('POST', '/api/driver/wallet/pin', { pin: '5831', password: PASSWORD }, 'd2');
    assert.equal(r.status, 200, r.json.message);
    assert.ok(r.json.data.holdUntil);
    assert.equal(r.json.data.pin.resetAllowed, false);
  });

  it('ofisi: muhtasari (deni la wallet zote), orodha, wallet moja na historia; si ofisi → 403', async () => {
    const sum = (await call('GET', '/api/admin/wallets/summary', undefined, 'admin')).json.data;
    const total = Number((await db.query('SELECT coalesce(sum(balance), 0) AS s FROM naya.wallets')).rows[0].s);
    assert.equal(sum.owed, total);
    const list = (await call('GET', `/api/admin/wallets?q=${s}`, undefined, 'admin')).json.data;
    assert.ok(list.some((x: any) => x.id === ids.d1));
    const one = (await call('GET', `/api/admin/wallets/${ids.d1}`, undefined, 'admin')).json.data;
    assert.equal(one.balance, await dbBalance('d1'));
    assert.ok(one.entries.length > 3);
    assert.ok(!JSON.stringify(one).includes('pin_hash') && !JSON.stringify(one).includes('$2'));
    assert.equal((await call('GET', '/api/admin/wallets/summary', undefined, 'd1')).status, 403);
    // marekebisho ya kupunguza zaidi ya salio → yanakataliwa (database inazuia salio hasi)
    const big = await credit('d2', -1_000_000);
    assert.equal(big.status, 409);
  });

  it('salio la kila wallet = jumla ya ledger yake (madereva wote wa majaribio)', async () => {
    for (const k of ['d1', 'd2']) assert.equal(await ledgerSum(k), await dbBalance(k), k);
  });
});

describe('Wallet — kinga za ziada (ukaguzi huru)', () => {
  it('namba kuu ikibadilishwa → saa 24 zinaanza ndani ya transaction ileile (hata bila hatua ya pili)', async () => {
    await clearHold('d1');
    const { savePayoutAccount } = await import('../src/services/promotions.js');
    await savePayoutAccount(ids.d1, { network: 'MPESA', phone: intl(`0756${s}`), accountName: 'Mteja Majaribio', primary: true, verifiedName: 'MTEJA MAJARIBIO' });
    const w = (await db.query('SELECT hold_until, hold_reason FROM naya.wallets WHERE driver_id = $1', [ids.d1])).rows[0];
    assert.ok(w.hold_until && new Date(w.hold_until) > new Date(Date.now() + 23 * 3600_000), 'saa 24 zimeanza');
    assert.equal(w.hold_reason, 'namba mpya ya malipo');
    // kuthibitisha upya namba ileile kuu → hakuna saa 24 mpya
    await clearHold('d1');
    const list = (await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data.accounts;
    const cur = list.find((a: any) => a.primary);
    await savePayoutAccount(ids.d1, { id: cur.id, network: cur.network, phone: cur.phone, accountName: 'Mteja Majaribio', primary: true, verifiedName: 'MTEJA MAJARIBIO' });
    assert.equal((await db.query('SELECT hold_until FROM naya.wallets WHERE driver_id = $1', [ids.d1])).rows[0].hold_until, null);
    // kufuta namba kuu (nyingine ikiwa kuu) → saa 24, kwa PIN
    assert.equal((await call('POST', `/api/driver/payout-accounts/${cur.id}/delete`, {}, 'd1')).status, 400, 'bila PIN');
    assert.equal((await call('POST', `/api/driver/payout-accounts/${cur.id}/delete`, { pin: PIN }, 'd1')).status, 200);
    assert.ok((await wallet('d1')).holdUntil, 'kufuta namba kuu → saa 24');
    await clearHold('d1');
  });

  it('kutoa kulikoripotiwa "kumeshindwa" kukiripotiwa baadaye "kumefika" → hakuna kinachobadilika kiotomatiki, ofisi inajulishwa', async () => {
    const failed = (await db.query(`SELECT * FROM naya.payments WHERE user_id = $1 AND kind = 'WALLET_WITHDRAWAL' AND status = 'FAILED' LIMIT 1`, [ids.d1])).rows[0];
    assert.ok(failed, 'kuna kutoa kulikoshindwa (jaribio la juu)');
    const bal = await dbBalance('d1');
    await applyResult(failed.reference, { status: 'SUCCESS', providerRef: 'LATE-1' });
    await applyResult(failed.reference, { status: 'SUCCESS', providerRef: 'LATE-1' }); // mara mbili → alama moja
    const p = (await db.query('SELECT status, meta FROM naya.payments WHERE id = $1', [failed.id])).rows[0];
    assert.equal(p.status, 'FAILED');
    assert.equal(p.meta.lateSuccess, true);
    assert.equal(await dbBalance('d1'), bal, 'salio halijaguswa');
    let sum = (await call('GET', '/api/admin/wallets/summary', undefined, 'admin')).json.data;
    assert.ok(sum.lateSuccess >= 1);
    const one = (await call('GET', `/api/admin/wallets/${ids.d1}`, undefined, 'admin')).json.data;
    assert.ok(one.entries.some((e: any) => e.lateSuccess && e.kind === 'WITHDRAWAL'));
    const audit = await db.query(`SELECT 1 FROM naya.audit_logs WHERE action = 'wallet.withdrawal_late_success' AND target_id = $1`, [ids.d1]);
    assert.equal(audit.rowCount, 1);
    assert.equal((await call('POST', `/api/admin/wallets/withdrawals/${failed.id}/late-reviewed`, {}, 'admin')).status, 200);
    sum = (await call('GET', '/api/admin/wallets/summary', undefined, 'admin')).json.data;
    const again = (await call('GET', `/api/admin/wallets/${ids.d1}`, undefined, 'admin')).json.data;
    assert.ok(!again.entries.some((e: any) => e.lateSuccess));
  });

  it('kutoa kulikokwama (jibu la kampuni lilipotea): ofisi inathibitisha "haikufika" → pesa inarudi mara moja tu; mapema → 409', async () => {
    await credit('d2', 8000);
    const stuck = await transaction(async (client) => {
      await lockWallet(client, ids.d2);
      const pay = await insertPayment(client, {
        kind: 'WALLET_WITHDRAWAL', direction: 'OUT', userId: ids.d2, amount: 5000, network: 'MPESA', phone: intl(`0757${s}`), provider: 'simulator', meta: { sendAmount: 5000, receive: 4900 },
      });
      await postEntry(client, ids.d2, { amount: -5000, kind: 'WITHDRAWAL', paymentId: pay.id, note: 'Majaribio: imekwama' });
      return pay;
    });
    const early = await call('POST', `/api/admin/wallets/withdrawals/${stuck.id}/resolve`, { outcome: 'FAILED', note: 'Haipo kwenye Abliner' }, 'admin');
    assert.equal(early.status, 409, 'chini ya dakika 30');
    await db.query(`UPDATE naya.payments SET created_at = now() - interval '2 hours' WHERE id = $1`, [stuck.id]);
    let sum = (await call('GET', '/api/admin/wallets/summary', undefined, 'admin')).json.data;
    assert.ok(sum.stuck >= 1);
    const bal = await dbBalance('d2');
    const r = await call('POST', `/api/admin/wallets/withdrawals/${stuck.id}/resolve`, { outcome: 'FAILED', note: 'Haipo kwenye dashibodi ya Abliner' }, 'admin');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(await dbBalance('d2'), bal + 5000);
    assert.equal((await call('POST', `/api/admin/wallets/withdrawals/${stuck.id}/resolve`, { outcome: 'FAILED', note: 'Mara ya pili' }, 'admin')).status, 409);
    assert.equal(await dbBalance('d2'), bal + 5000, 'hakuna kurudisha mara mbili');
    assert.equal((await call('POST', `/api/admin/wallets/withdrawals/${stuck.id}/resolve`, { outcome: 'FAILED', note: 'Si ofisi' }, 'd2')).status, 403);
    assert.equal(await ledgerSum('d2'), await dbBalance('d2'));
  });

  it('safari ya ofa iliyokamilika bila kushughulikiwa (seva ilizimika) → worker inaiweka kwenye wallet, mara moja tu', async () => {
    await clearHold('d2');
    const rideId = await promoRide('d2');
    const r = await rideState(rideId, (x) => x.promo_payout_state === 'PAID');
    assert.equal(r.promo_payout_state, 'PAID');
    // iga: hali haikuandikwa na mapato hayakuingia
    const entry = (await db.query(`SELECT id, amount FROM naya.wallet_entries WHERE ride_id = $1 AND kind = 'PROMO_EARNING'`, [rideId])).rows[0];
    assert.ok(entry);
    await transaction(async (client) => {
      await lockWallet(client, ids.d2);
      await client.query('DELETE FROM naya.wallet_entries WHERE id = $1', [entry.id]);
      await client.query('UPDATE naya.wallets SET balance = balance - $2 WHERE driver_id = $1', [ids.d2, entry.amount]);
      await client.query(`DELETE FROM naya.promo_payouts WHERE driver_id = $1 AND network = 'WALLET' AND amount = $2 AND paid_at > now() - interval '5 minutes'`, [ids.d2, entry.amount]);
    });
    await db.query(`UPDATE naya.rides SET promo_payout_state = NULL, completed_at = now() - interval '20 minutes' WHERE id = $1`, [rideId]);
    const bal = await dbBalance('d2');
    await checkPendingPayments();
    await checkPendingPayments();
    assert.equal((await ride(rideId)).promo_payout_state, 'PAID');
    assert.equal(await dbBalance('d2'), bal + entry.amount);
    assert.equal(await ledgerSum('d2'), await dbBalance('d2'));
  });

  it('mwisho: salio = ledger kwa madereva wote wa majaribio', async () => {
    for (const k of ['d1', 'd2']) assert.equal(await ledgerSum(k), await dbBalance(k), k);
  });
});
