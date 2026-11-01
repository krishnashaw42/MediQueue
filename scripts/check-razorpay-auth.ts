import { store } from "../lib/v2/store";
import { gateway } from "../lib/v2/providers";

// Read-only provider checks: never print secrets, authorization headers, or payments.
const s = store();
const hospitals = await s.hospitals();
for (const hospital of hospitals) {
  try {
    const saved = await s.get("SELECT 1 FROM payment_settings WHERE hospitalId=?", hospital.id);
    const keys = await gateway(hospital.id, s);
    const response = await fetch("https://api.razorpay.com/v1/payments?count=1", {
      headers: { Authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString("base64")}` },
      signal: AbortSignal.timeout(10000), cache: "no-store",
    });
    console.log("RAZORPAY_AUTH_CHECK", JSON.stringify({
      hospital: hospital.name, source: saved ? "saved hospital settings" : "server environment",
      keyIdSuffix: keys.keyId.slice(-6), keyIdLength: keys.keyId.length,
      keySecretLength: keys.keySecret.length,
      surroundingWhitespace: keys.keyId !== keys.keyId.trim() || keys.keySecret !== keys.keySecret.trim(),
      status: response.status, authenticated: response.ok,
    }));
    await response.body?.cancel();
  } catch (error) {
    console.log("RAZORPAY_AUTH_CHECK", JSON.stringify({ hospital: hospital.name, error: error instanceof Error ? error.name : "Unknown error" }));
  }
}
