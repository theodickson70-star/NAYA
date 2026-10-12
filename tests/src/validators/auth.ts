// Uhakiki wa taarifa zinazoingia kwenye /api/auth.
import { z } from 'zod';
import { normalizeTzPhone } from '../utils/phone.js';

export const phoneSchema = z
  .string({ error: 'Weka namba ya simu' })
  .transform((value, ctx) => {
    const phone = normalizeTzPhone(value);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Namba ya simu si sahihi (mfano: 0712 345 678)' });
      return z.NEVER;
    }
    return phone;
  });

export const passwordSchema = z
  .string({ error: 'Weka password' })
  .min(8, 'Password iwe na angalau herufi 8')
  .max(128, 'Password ni ndefu mno');

export const registerSchema = z.object({
  fullName: z
    .string({ error: 'Weka jina kamili' })
    .trim()
    .min(3, 'Jina liwe na angalau herufi 3')
    .max(120, 'Jina ni refu mno'),
  phone: phoneSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'Weka alama kwenye kisanduku kukubali Masharti ya Huduma na Sera ya Faragha' }),
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string({ error: 'Weka password' }).min(1, 'Weka password').max(128),
});

export const codeSchema = z
  .string({ error: 'Weka namba uliyopokea kwa SMS' })
  .trim()
  .regex(/^\d{6}$/, 'Namba ya SMS ina tarakimu 6');
