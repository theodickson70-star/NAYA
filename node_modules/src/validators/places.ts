// Uhakiki wa maeneo, kanuni za nauli na maombi ya makadirio.
import { z } from 'zod';
import { VEHICLE_TYPES } from './drivers.js';

export const LOCATION_CATEGORIES = ['STAND', 'MARKET', 'HOSPITAL', 'SCHOOL', 'OFFICE', 'WORSHIP', 'NEIGHBORHOOD', 'OTHER'] as const;

// Tanzania nzima (pamoja na ukingo mdogo): kuzuia koordinati zilizogeuzwa au za nchi nyingine kwa makosa.
const lat = z.number({ error: 'Latitude si sahihi' }).min(-12.5, 'Mahali hapa pako nje ya Tanzania').max(-0.5, 'Mahali hapa pako nje ya Tanzania');
const lng = z.number({ error: 'Longitude si sahihi' }).min(29, 'Mahali hapa pako nje ya Tanzania').max(41, 'Mahali hapa pako nje ya Tanzania');

export const locationSchema = z.object({
  name: z.string({ error: 'Weka jina la eneo' }).trim().min(2, 'Weka jina la eneo').max(80, 'Jina ni refu mno'),
  area: z
    .string()
    .trim()
    .max(80, 'Jina la mtaa ni refu mno')
    .optional()
    .transform((v) => (v ? v : null)),
  category: z.enum(LOCATION_CATEGORIES, { error: 'Chagua aina ya eneo' }).default('OTHER'),
  lat,
  lng,
});
export type LocationInput = z.infer<typeof locationSchema>;

export const locationIdParam = z.object({ id: z.uuid({ error: 'Eneo halijapatikana' }) });

export const locationQuery = z.object({ q: z.string().trim().max(60).optional() });

const tzs = (label: string) =>
  z
    .number({ error: `Weka ${label}` })
    .int(`${label} iwe namba kamili ya shilingi`)
    .min(0, `${label} haiwezi kuwa chini ya 0`)
    .max(1_000_000, `${label} ni kubwa mno`);

export const fareRuleSchema = z
  .object({
    baseFare: tzs('Bei ya kuanzia'),
    perKm: tzs('Bei kwa kilomita'),
    minimumFare: tzs('Nauli ya chini kabisa'),
    roundingStep: z.union([z.literal(50), z.literal(100), z.literal(200), z.literal(500), z.literal(1000)], {
      error: 'Chagua kuzungusha: 50, 100, 200, 500 au 1000',
    }),
    roadFactor: z.number({ error: 'Weka kizidisho cha barabara' }).min(1, 'Kizidisho kiwe kati ya 1.0 na 2.0').max(2, 'Kizidisho kiwe kati ya 1.0 na 2.0'),
    isActive: z.boolean().default(true),
  })
  .refine((r) => r.baseFare + r.perKm + r.minimumFare > 0, { message: 'Weka bei — zote haziwezi kuwa 0' });
export type FareRuleInput = z.infer<typeof fareRuleSchema>;

export const vehicleTypeParam = z.object({ vehicleType: z.enum(VEHICLE_TYPES, { error: 'Aina ya chombo haijulikani' }) });

const placeRef = z.union([
  z.object({ locationId: z.uuid({ error: 'Eneo halijapatikana' }) }),
  z.object({ lat, lng }),
]);

export const estimateSchema = z.object({
  pickup: placeRef,
  destination: z.object({ locationId: z.uuid({ error: 'Chagua unakoenda' }) }),
});

// Bei maalum kati ya maeneo (ofisi). Kisanduku kitupu = hakuna bei maalum (kanuni ya km inatumika).
const routeFare = z
  .number({ error: 'Bei iwe namba' })
  .int('Bei iwe namba kamili ya shilingi')
  .min(0, 'Bei haiwezi kuwa chini ya 0')
  .max(1_000_000, 'Bei ni kubwa mno')
  .nullable();

export const routeFaresSchema = z.object({
  routes: z
    .array(
      z.object({
        toId: z.uuid({ error: 'Eneo halijapatikana' }),
        fares: z.object({ BODABODA: routeFare.optional(), BAJAJI: routeFare.optional() }),
      }),
    )
    .max(500, 'Njia nyingi mno kwa mara moja'),
});
