// Taarifa za papo hapo.
// Kila simu iliyo wazi inashikilia muunganisho mmoja wa Server-Sent Events (/api/stream). Kitu kikibadilika
// (safari, ombi, udereva) tunatuma tukio dogo kwa mtumiaji husika — "{type, rideId}" tu, bila data binafsi —
// na app inajichukulia hali mpya kupitia API ya kawaida (yenye ukaguzi wa ruhusa).
//
// Railway ikiendesha nakala zaidi ya moja ya server, tukio linapita kwenye Postgres NOTIFY/LISTEN
// (teknolojia ile ile ya Supabase Realtime) ili kila server iwafikishie watumiaji wake.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { connectionConfig, db } from '../db/pool.js';

export type EventType = 'ride' | 'offer' | 'driver' | 'account' | 'admin';

export interface RealtimeMessage {
  type: EventType;
  userId?: string; // mtumiaji mmoja
  admins?: boolean; // ofisi yote
  rideId?: string | null;
}

interface StreamClient {
  userId: string;
  admin: boolean;
  send: (type: string, data: object) => void;
  end: () => void;
}

const CHANNEL = 'naya_events';
const instanceId = randomUUID();
const clients = new Set<StreamClient>();
let listener: pg.Client | null = null;
let stopping = false;

export function addClient(client: StreamClient): () => void {
  clients.add(client);
  return () => clients.delete(client);
}

export const connectedClients = () => clients.size;

/** Server ikizimwa: funga mistreams yote (app zitaunganisha tena zenyewe kwenye server mpya). */
export function closeAllClients(): void {
  for (const client of clients) client.end();
  clients.clear();
}

/** Fikisha tukio kwa watumiaji walio kwenye server HII. */
function deliver(message: RealtimeMessage) {
  const payload = { type: message.type, rideId: message.rideId ?? null };
  for (const client of clients) {
    if ((message.userId && client.userId === message.userId) || (message.admins && client.admin)) {
      client.send(message.type, payload);
    }
  }
}

/** Tuma tukio: papo hapo kwa server hii, na kupitia Postgres kwa servers nyingine. Halitupi kosa kamwe. */
export async function publish(message: RealtimeMessage): Promise<void> {
  deliver(message);
  try {
    await db.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ ...message, origin: instanceId })]);
  } catch {
    // Database ikisita, watumiaji wa server hii tayari wamepata tukio; wengine watapata hali mpya kwa refresh ya kawaida.
  }
}

/** Sikiliza matukio ya servers nyingine. Muunganisho ukikatika, unajaribu tena wenyewe. */
export async function startListener(log: { info: (m: string) => void; warn: (m: string) => void }): Promise<void> {
  stopping = false;
  let delay = 1000;
  const connect = async () => {
    if (stopping) return;
    const client = new pg.Client(connectionConfig);
    let retried = false;
    const retry = (reason: string) => {
      if (retried || stopping) return;
      retried = true;
      listener = null;
      log.warn(`[realtime] ${reason}; najaribu tena baada ya ${delay / 1000}s`);
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    };
    client.on('notification', (msg) => {
      try {
        const data = JSON.parse(msg.payload ?? '{}') as RealtimeMessage & { origin?: string };
        if (data.origin !== instanceId) deliver(data);
      } catch {
        // tukio lisilosomeka — lipuuze
      }
    });
    client.on('error', () => retry('muunganisho wa LISTEN umepata hitilafu'));
    client.on('end', () => retry('muunganisho wa LISTEN umekatika'));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      listener = client;
      delay = 1000;
      log.info('[realtime] inasikiliza matukio (LISTEN/NOTIFY)');
    } catch (error) {
      retry(`LISTEN imeshindwa (${(error as Error).message})`);
      await client.end().catch(() => {});
    }
  };
  await connect();
}

export async function stopListener(): Promise<void> {
  stopping = true;
  await listener?.end().catch(() => {});
  listener = null;
}
