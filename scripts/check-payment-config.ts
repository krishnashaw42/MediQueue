import { database } from "../lib/v2/database";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Read-only configuration diagnosis. Never log environment values or merchant data.
const value = process.env.PAYMENT_ENCRYPTION_KEY || "";
const db = database();
const settings = await db.query("SELECT COUNT(*) AS count FROM payment_settings");
const history = await db.query("SELECT COUNT(*) AS count FROM payment_settings_history");
const valid = /^[a-f0-9]{64}$/i.test(value);
let encryptionRoundTripOK = false;
if (valid) {
  const key = Buffer.from(value, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = "MediQueue encryption configuration check";
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(cipher.getAuthTag());
  encryptionRoundTripOK = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8") === plaintext;
}
console.log("PAYMENT_CONFIG_CHECK", JSON.stringify({
  configured: !!value,
  length: value.length,
  strictHexValid: /^[a-f0-9]{64}$/i.test(value),
  trimmedHexValid: /^[a-f0-9]{64}$/i.test(value.trim()),
  savedSettingsCount: Number((settings.rows[0] as { count: string | number }).count),
  savedHistoryCount: Number((history.rows[0] as { count: string | number }).count),
  encryptionRoundTripOK,
}));
if (!valid || !encryptionRoundTripOK) throw new Error("Payment encryption configuration must be fixed before deployment.");
