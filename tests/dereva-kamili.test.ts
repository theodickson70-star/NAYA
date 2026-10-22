// 0.27.0 Taarifa kamili za dereva: bonus za ofa safari kwa safari (zimekwenda wapi), wallet, malipo, na maelezo ya kumweleza dereva.
// DB ya majaribio tu.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const PASSWORD = 'NayaTest#2026';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const userIds: string[] = [];
const rideIds: Record<string, string> = {};
let locationId = '';
let ip = 0;

async function call(method: 'GET' | 'POST', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.81.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}
const intl = (local: string) => `255${local.slice(1)}`;
async function makeUser(key: string, phone: string, name: string, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, phone_verified_at) VALUES ($1, $2, $3, $4, now()) RETURNING id`,
    [intl(phone), name, role, await hashPassword(PASSWORD)],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}
async function promoRide(key: string, discount: number, state: string | null, note: string | null) {
  const r = await db.query(
    `INSERT INTO naya.rides (passenger_id, driver_id, vehicle_type, pickup_location_id, pickup_name, pickup_lat, pickup_lng, dest_location_id, dest_name, dest_lat, dest_lng,
                             distance_km, fare, status, accepted_at, completed_at, promo_discount, promo_title, promo_payout_state, promo_payout_note, passenger_closed, driver_closed)
     VALUES ($1, $2, 'BODABODA', $3, 'Stendi DK', -8.2, 35.4, $3, 'Soko DK', -8.21, 35.41, 1, 3000, 'COMPLETED', now(), now() - ($4 || ' minutes')::interval, $5, 'Nusu bei', $6, $7, true, true)
     RETURNING id`,
    [ids.p1, ids.d1, locationId, String(Object.keys(rideIds).length * 10), discount, state, note],
  );
  rideIds[key] = r.rows[0].id;
}

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  await db.query(`DELETE FROM naya.settings WHERE key = 'driver_wallet'`); // chaguo-msingi: ofa → wallet
  locationId = (await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', -8.2, 35.4) RETURNING id`, [`DK ${s}`])).rows[0].id;
  await makeUser('admin', `0790${s}`, 'Ofisi Kamili', 'ADMIN');
  await makeUser('p1', `0791${s}`, `Abiria Kamili ${s}`);
  await makeUser('d1', `0792${s}`, `Juma Kamili ${s}`);
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, license_number, paid_until, reviewed_at) VALUES ($1, 'APPROVED', 'BODABODA', $2, 'DL1', now() + interval '9 days', now())`,
    [ids.d1, `MC ${s.slice(-3)} DKM`],
  );
  await db.query(
    `INSERT INTO naya.driver_payout_accounts (driver_id, network, phone, account_name, is_primary) VALUES ($1, 'MPESA', $2, 'JUMA KAMILI', true)`,
    [ids.d1, intl(`0792${s}`)],
  );
  await promoRide('held', 1000, 'HELD', 'PIN haikuingizwa');
  await promoRide('failed', 500, 'FAILED', 'Abliner imekataa');
  await promoRide('none', 700, null, null);
});

after(async () => {
  await db.query('DELETE FROM naya.wallet_entries WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.wallets WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.promo_payouts WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.driver_payout_accounts WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[]) OR target_id = ANY($2::uuid[])', [userIds, Object.values(rideIds)]);
  await db.query('DELETE FROM naya.drivers WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = $1', [locationId]);
  await app.close();
  await db.end();
});

describe('NAYA 0.27.0 — taarifa kamili za dereva', () => {
  it('bonus: kila safari na hali yake; ofisi ikilipa iliyoshikiliwa → inaonekana imeingia wallet', async () => {
    const before = (await call('GET', `/api/admin/drivers/${ids.d1}/full`, undefined, 'admin')).json.data;
    assert.equal(before.bonus.trips.length, 3);
    assert.equal(before.bonus.rides, 3);
    assert.equal(before.bonus.earned, 2200);
    assert.equal(before.bonus.balance, 2200);
    assert.deepEqual(Object.keys(before.bonus.byState).sort(), ['FAILED', 'HELD', 'NONE']);
    assert.equal(before.wallet, null, 'bado hana wallet');

    const ok = await call('POST', `/api/admin/payments/rides/${rideIds.held}/approve`, {}, 'admin');
    assert.equal(ok.status, 200, ok.json.message);

    const res = await call('GET', `/api/admin/drivers/${ids.d1}/full`, undefined, 'admin');
    assert.equal(res.status, 200, res.json.message);
    const d = res.json.data;
    const held = d.bonus.trips.find((r: any) => r.id === rideIds.held);
    assert.equal(held.state, 'PAID');
    assert.equal(held.destination.how, 'WALLET');
    assert.equal(d.bonus.paid, 1000);
    assert.equal(d.bonus.paidToWallet, 1000);
    assert.equal(d.bonus.balance, 1200);
    assert.equal(d.bonus.byState.FAILED.amount, 500);
    assert.equal(d.bonus.trips.find((r: any) => r.id === rideIds.failed).note, 'Abliner imekataa');
    assert.equal(d.wallet.balance, 1000);
    assert.equal(d.wallet.promoIn, 1000);
    assert.equal(d.wallet.entries[0].kind, 'PROMO_EARNING');
    assert.equal(d.bonus.payouts[0].how, 'WALLET');
  });

  it('maelezo ya kumweleza dereva yanasema pesa iko kwenye wallet na nini bado kinasubiri', async () => {
    const d = (await call('GET', `/api/admin/drivers/${ids.d1}/full`, undefined, 'admin')).json.data;
    const text = d.explanation.join('\n');
    assert.match(text, /amekamilisha safari 3 za ofa\. Bonus yake yote ni TSh 2,200; NAYA imeshalipa TSh 1,000/);
    assert.match(text, /NAYA bado inamdai TSh 1,200/);
    assert.match(text, /TSh 1,000 ya bonus iliingia kwenye WALLET/);
    assert.match(text, /TSh 1,000 iko kwenye wallet yake — aingie app: Wallet yangu → Toa pesa/);
    assert.match(text, /Safari 1 \(TSh 500\): Kutuma kumeshindwa/);
    assert.match(text, /Safari 1 \(TSh 700\): Bado haijashughulikiwa/);
  });

  it('wasifu, safari, namba za malipo na historia ya ofisi', async () => {
    const d = (await call('GET', `/api/admin/drivers/${ids.d1}/full`, undefined, 'admin')).json.data;
    assert.equal(d.profile.plate, `MC ${s.slice(-3)} DKM`);
    assert.equal(d.rides.completed, 3);
    assert.equal(d.rides.fareTotal, 9000);
    assert.equal(d.rides.promoTrips, 3);
    assert.equal(d.recentRides.length, 3);
    assert.equal(d.accounts[0].phone, intl(`0792${s}`));
    assert.ok(d.history.some((h: any) => h.action === 'promo_payout.approved'));
  });

  it('ruhusa: ofisi tu; dereva asiyekuwepo → 404', async () => {
    assert.equal((await call('GET', `/api/admin/drivers/${ids.d1}/full`, undefined, 'd1')).status, 403);
    assert.equal((await call('GET', `/api/admin/drivers/${ids.p1}/full`, undefined, 'admin')).status, 404);
  });
});
