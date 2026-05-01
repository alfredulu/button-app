import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SALT_BYTES = 16;

export function generatePhoneCodeSalt(): string {
  return randomBytes(SALT_BYTES).toString("hex");
}

export function hashPhoneCode(code: string, saltHex: string): string {
  const salt = Buffer.from(saltHex, "hex");
  const derived = scryptSync(code.normalize("NFKC"), salt, 32);
  return derived.toString("hex");
}

export function verifyPhoneCode(code: string, saltHex: string, storedHashHex: string): boolean {
  try {
    const candidate = Buffer.from(hashPhoneCode(code, saltHex), "hex");
    const stored = Buffer.from(storedHashHex, "hex");
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

/** E.164: + followed by 10–15 digits (ITU-T E.164 max 15 digits total including country). */
export const E164_REGEX = /^\+[1-9]\d{9,14}$/;

export function isE164Phone(s: string): boolean {
  return E164_REGEX.test(s.trim());
}
