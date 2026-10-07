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
  'driver.forced_offline': 'Alitolewa online na ofisi',
  'user.suspended': 'Akaunti ilisimamishwa',
  'user.reactivated': 'Akaunti ilirudishwa',
  'user.phone_verified': 'Namba ilithibitishwa na ofisi',
  'user.temp_password': 'Alipewa password ya muda',
  'user.messaged': 'Alitumiwa ujumbe na ofisi',
  'support.replied': 'Ofisi ilijibu ombi la msaada',
  'support.resolved': 'Ombi la msaada lilitatuliwa',
  'support.reopened': 'Ombi la msaada lilifunguliwa upya',
  'feedback.reviewed': 'Maoni yake yalisomwa',
  'feedback.acted': 'Maoni yake yalifanyiwa kazi',
  'subscription.paid': 'Malipo ya ada yalirekodiwa',
  'subscription.voided': 'Malipo ya ada yalibatilishwa',
};

export const SUPPORT_CATEGORIES = {
  RIDE: 'Tatizo la safari',
  FARE: 'Nauli',
  DRIVER: 'Kuhusu dereva',
  PASSENGER: 'Kuhusu abiria',
  LOST_ITEM: 'Nimesahau kitu',
  SAFETY: 'Usalama',
  APP: 'App haifanyi kazi vizuri',
  ACCOUNT: 'Akaunti yangu',
  OTHER: 'Mengineyo',
};

export const FEEDBACK_TOPICS = {
  GENERAL: 'Kwa ujumla',
  APP: 'App ya NAYA',
  PRICES: 'Bei',
  DRIVERS: 'Madereva / abiria',
  SAFETY: 'Usalama',
  IDEA: 'Wazo jipya',
};

export const FEEDBACK_STATUS = {
  NEW: { label: 'Mapya', tone: 'warn' },
  REVIEWED: { label: 'Yamesomwa', tone: 'muted' },
  ACTED: { label: 'Yamefanyiwa kazi', tone: 'ok' },
};

export const SUPPORT_STATUS = {
  OPEN: { label: 'Inasubiri ofisi', tone: 'warn' },
  ANSWERED: { label: 'Imejibiwa', tone: 'ok' },
  RESOLVED: { label: 'Imetatuliwa', tone: 'muted' },
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
