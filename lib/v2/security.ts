import { randomBytes, scrypt, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  const hash = (await derive(
    password,
    salt || "missing-account",
    64,
  )) as Buffer;
  const target = Buffer.from(expected || "", "hex");
  return target.length === hash.length && timingSafeEqual(target, hash);
}
export function signatureOK(body: string, signature: string, secret: string) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
