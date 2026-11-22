// Uhakiki wa taarifa za dereva na chombo chake.
import { z } from 'zod';

export const VEHICLE_TYPES = ['BODABODA', 'BAJAJI'] as const;
export const DOCUMENT_TYPES = ['PROFILE_PHOTO', 'DRIVING_LICENSE', 'NATIONAL_ID', 'VEHICLE_PHOTO', 'INSURANCE'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** "mc123abc", "MC-123-ABC", "mc 123 abc" → "MC 123 ABC". Inarudisha null kama si plate ya Tanzania. */
export function normalizePlate(input: string): string | null {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = /^(MC|T)(\d{3})([A-Z]{2,3})$/.exec(compact);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : null;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'Maelezo ni marefu mno')
    .optional()
    .transform((v) => (v ? v : null));

export const vehicleSchema = z.object({
  vehicleType: z.enum(VEHICLE_TYPES, { error: 'Chagua aina ya chombo: bodaboda au bajaji' }),
  plateNumber: z.string({ error: 'Weka namba ya plate' }).transform((value, ctx) => {
    const plate = normalizePlate(value);
    if (!plate) {
      ctx.addIssue({ code: 'custom', message: 'Namba ya plate si sahihi (mfano: MC 123 ABC)' });
      return z.NEVER;
    }
    return plate;
  }),
  vehicleMake: z
    .string({ error: 'Weka aina ya chombo (mf. Boxer, TVS, Bajaj)' })
    .trim()
    .min(2, 'Weka aina ya chombo (mf. Boxer, TVS, Bajaj)')
    .max(60, 'Aina ya chombo ni ndefu mno'),
  vehicleModel: optionalText(60),
  vehicleColor: z
    .string({ error: 'Weka rangi ya chombo' })
    .trim()
    .min(3, 'Weka rangi ya chombo')
    .max(40, 'Rangi ni ndefu mno'),
  licenseNumber: z
    .string({ error: 'Weka namba ya leseni ya udereva' })
    .trim()
    .toUpperCase()
    .min(5, 'Namba ya leseni si sahihi')
    .max(30, 'Namba ya leseni ni ndefu mno'),
  nationalIdNumber: z
    .string()
    .optional()
    .transform((value, ctx) => {
      const digits = (value ?? '').replace(/[\s-]/g, '');
      if (!digits) return null;
      if (!/^\d{20}$/.test(digits)) {
        ctx.addIssue({ code: 'custom', message: 'Namba ya NIDA iwe na tarakimu 20' });
        return z.NEVER;
      }
      return digits;
    }),
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

export const documentTypeParam = z.object({
  type: z.enum(DOCUMENT_TYPES, { error: 'Aina ya nyaraka haijulikani' }),
});

export const driverIdParam = z.object({ id: z.uuid({ error: 'Dereva hajapatikana' }) });

export const driverListQuery = z.object({
  status: z.enum(['INCOMPLETE', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ALL']).default('ALL'),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const rejectSchema = z.object({
  reason: z
    .string({ error: 'Andika sababu ya kukataa' })
    .trim()
    .min(5, 'Andika sababu ya kukataa (angalau herufi 5) ili dereva ajue cha kurekebisha')
    .max(500, 'Sababu ni ndefu mno'),
  documents: z.array(z.enum(DOCUMENT_TYPES)).max(DOCUMENT_TYPES.length).default([]),
});

export const suspendSchema = z.object({
  reason: z
    .string({ error: 'Andika sababu ya kusimamisha' })
    .trim()
    .min(5, 'Andika sababu ya kusimamisha (angalau herufi 5)')
    .max(500, 'Sababu ni ndefu mno'),
});
