// Namba za simu za Tanzania → muundo mmoja: 2557XXXXXXXX au 2556XXXXXXXX.
// Inakubali: 0712345678, 712345678, +255712345678, 255712345678, "0712 345 678".

export function normalizeTzPhone(input: string): string | null {
  let digits = input.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;

  if (digits.startsWith('255')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);

  // Baada ya kuondoa kiambishi: tarakimu 9, zinaanza na 6 au 7.
  if (!/^[67]\d{8}$/.test(digits)) return null;
  return `255${digits}`;
}

/** 255712345678 → +255 712 345 678 */
export function formatTzPhone(phone: string): string {
  return `+${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`;
}
