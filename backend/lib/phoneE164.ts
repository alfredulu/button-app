import { z } from "zod";

/** E.164: + then 1–15 digits, first digit after + is country code 1–9 */
export const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export const e164PhoneSchema = z
  .string()
  .trim()
  .regex(E164_REGEX, "Phone must be E.164 format (e.g. +15551234567)");

export function normalizeE164(phone: string): string {
  const t = phone.trim();
  if (!t.startsWith("+")) {
    const digits = t.replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  }
  return t;
}
