// Hesabu ya nauli — functions safi (hazigusi database), kwa hiyo zinajaribiwa kwa urahisi.

export interface Point {
  lat: number;
  lng: number;
}

export interface FareRule {
  vehicleType: 'BODABODA' | 'BAJAJI';
  baseFare: number;
  perKm: number;
  minimumFare: number;
  roundingStep: number;
  roadFactor: number;
}

export interface FareQuote {
  vehicleType: FareRule['vehicleType'];
  fare: number;
  currency: 'TZS';
  distanceKm: number;
  breakdown: { baseFare: number; perKm: number; distanceCharge: number; minimumApplied: boolean };
}

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Umbali wa moja kwa moja (km) kati ya pointi mbili juu ya dunia (haversine). */
export function straightLineKm(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Umbali wa barabarani unaokadiriwa (km, desimali moja). */
export function roadDistanceKm(a: Point, b: Point, roadFactor: number): number {
  return Math.round(straightLineKm(a, b) * roadFactor * 10) / 10;
}

/** Nauli: max(kiwango cha chini, kuanzia + kwa km × km), ikizungushwa JUU hadi hatua ya karibu (mf. 100). */
export function quoteFare(rule: FareRule, from: Point, to: Point): FareQuote {
  const distanceKm = roadDistanceKm(from, to, rule.roadFactor);
  const distanceCharge = Math.round(rule.perKm * distanceKm);
  const raw = rule.baseFare + distanceCharge;
  const minimumApplied = raw < rule.minimumFare;
  const beforeRounding = Math.max(raw, rule.minimumFare);
  const fare = Math.ceil(beforeRounding / rule.roundingStep) * rule.roundingStep;
  return {
    vehicleType: rule.vehicleType,
    fare,
    currency: 'TZS',
    distanceKm,
    breakdown: { baseFare: rule.baseFare, perKm: rule.perKm, distanceCharge, minimumApplied },
  };
}

/** Nauli kwa umbali wa barabarani uliotolewa moja kwa moja (kwa mfano wa bei kwenye ofisi). */
export function fareForDistance(rule: Omit<FareRule, 'vehicleType' | 'roadFactor'>, distanceKm: number): number {
  const raw = rule.baseFare + Math.round(rule.perKm * distanceKm);
  return Math.ceil(Math.max(raw, rule.minimumFare) / rule.roundingStep) * rule.roundingStep;
}
