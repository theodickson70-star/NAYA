// Majina ya Kiswahili ya hali na nyaraka — sehemu moja kwa kurasa zote.

export const DRIVER_STATUS = {
  INCOMPLETE: { label: 'Hajamaliza usajili', tone: 'muted' },
  PENDING: { label: 'Anasubiri uthibitisho', tone: 'warn' },
  APPROVED: { label: 'Amethibitishwa', tone: 'ok' },
  REJECTED: { label: 'Amekataliwa', tone: 'bad' },
  SUSPENDED: { label: 'Amesimamishwa', tone: 'bad' },
};

export const DOCUMENTS = {
  PROFILE_PHOTO: { label: 'Picha yako', hint: 'Picha ya uso wako, wazi, bila miwani ya jua wala kofia.' },
  DRIVING_LICENSE: { label: 'Leseni ya udereva', hint: 'Upande wa mbele wa leseni, maandishi yasomeke.' },
  NATIONAL_ID: { label: 'Kitambulisho cha NIDA', hint: 'Kitambulisho cha taifa au namba ya NIDA iliyochapishwa.' },
  VEHICLE_PHOTO: { label: 'Picha ya chombo', hint: 'Chombo kizima, namba ya plate ionekane wazi.' },
  INSURANCE: { label: 'Bima ya chombo', hint: 'Si lazima, lakini inaongeza imani ya wateja.' },
};
export const DOCUMENT_ORDER = ['PROFILE_PHOTO', 'DRIVING_LICENSE', 'NATIONAL_ID', 'VEHICLE_PHOTO', 'INSURANCE'];

export const DOCUMENT_STATUS = {
  PENDING: { label: 'Imepakiwa', tone: 'muted' },
  APPROVED: { label: 'Imekubaliwa', tone: 'ok' },
  REJECTED: { label: 'Ibadilishe', tone: 'bad' },
};

export const VEHICLE_TYPES = { BODABODA: 'Bodaboda', BAJAJI: 'Bajaji' };

export const AUDIT_ACTIONS = {
  'location.created': 'Eneo limeongezwa',
  'location.updated': 'Eneo limebadilishwa',
  'location.deactivated': 'Eneo limezimwa',
  'location.activated': 'Eneo limewashwa',
  'fare.updated': 'Bei zimebadilishwa',
  'driver.applied': 'Aliomba kuwa dereva',
  'driver.submitted': 'Alituma taarifa kwa uthibitisho',
  'driver.approved': 'Alithibitishwa',
  'driver.rejected': 'Alikataliwa',
  'driver.suspended': 'Alisimamishwa',
  'driver.reinstated': 'Alirudishwa kazini',
};

export function formatDate(value, withTime = false) {
  if (!value) return '–';
  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(options, { hour: '2-digit', minute: '2-digit' });
  return new Date(value).toLocaleString('sw-TZ', options);
}

/** 255712345678 → 0712 345 678 */
export function formatPhone(phone) {
  if (!phone || phone.length !== 12) return phone ?? '';
  return `0${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`;
}

export const LOCATION_CATEGORIES = {
  STAND: 'Stendi',
  MARKET: 'Soko',
  HOSPITAL: 'Hospitali / zahanati',
  SCHOOL: 'Shule / chuo',
  OFFICE: 'Ofisi / taasisi',
  WORSHIP: 'Kanisa / msikiti',
  NEIGHBORHOOD: 'Mtaa',
  OTHER: 'Mengine',
};

/** 1700 → "TSh 1,700" */
export function formatTsh(amount) {
  return `TSh ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;
}
