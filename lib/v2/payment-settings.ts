import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppError, requireRole, type Store, type User } from "./store";
export type GatewayKeys = {
    keyId: string;
    keySecret: string;
    webhookSecret: string;
};
type Row = {
    hospitalId: string;
    keyId: string;
    encrypted: string;
    verifiedAt: string;
};
function encryptionKey(create: boolean) {
    const configured = process.env.PAYMENT_ENCRYPTION_KEY;
    if (configured) {
        if (!/^[a-f0-9]{64}$/i.test(configured))
            throw new AppError("Payment encryption configuration is invalid.", 503);
        return Buffer.from(configured, "hex");
    }
    if (process.env.VERCEL || process.env.DATABASE_URL)
        throw new AppError("PAYMENT_ENCRYPTION_KEY must be configured on the server.", 503);
    const path = process.env.MEDIQUEUE_PAYMENT_KEY_PATH ||
        join(process.cwd(), "data", "payment-encryption.key");
    // This is runtime secret material, never a build asset.
    if (create && !existsSync(/* turbopackIgnore: true */ path)) {
        mkdirSync(dirname(path), { recursive: true });
        try {
            writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST")
                throw new AppError("Unable to create the local encryption key.", 503);
        }
    }
    try {
        const key = readFileSync(/* turbopackIgnore: true */ path);
        if (key.length !== 32)
            throw new Error();
        return key;
    }
    catch {
        throw new AppError("The payment encryption key is missing. Restore it from your backup.", 503);
    }
}
function decrypt(hospitalId: string, encrypted: string): GatewayKeys {
    try {
        const packed = JSON.parse(encrypted);
        const decipher = createDecipheriv("aes-256-gcm", encryptionKey(false), Buffer.from(packed.iv, "base64"));
        decipher.setAAD(Buffer.from(hospitalId));
        decipher.setAuthTag(Buffer.from(packed.tag, "base64"));
        return JSON.parse(Buffer.concat([
            decipher.update(Buffer.from(packed.data, "base64")),
            decipher.final(),
        ]).toString("utf8"));
    }
    catch {
        throw new AppError("Saved payment credentials cannot be read. Restore the encryption key backup.", 503);
    }
}
function encrypt(hospitalId: string, keys: GatewayKeys) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(true), iv);
    cipher.setAAD(Buffer.from(hospitalId));
    const data = Buffer.concat([
        cipher.update(JSON.stringify(keys), "utf8"),
        cipher.final(),
    ]);
    return JSON.stringify({
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        data: data.toString("base64"),
    });
}
export async function storedGateway(s: Store, hospitalId: string): Promise<GatewayKeys | null> {
    const r = await s.get<Row>("SELECT * FROM payment_settings WHERE hospitalId=?", hospitalId);
    return r ? decrypt(hospitalId, r.encrypted) : null;
}
export async function gatewayForOrder(s: Store, hospitalId: string, keyId: string): Promise<GatewayKeys> {
    const current = await storedGateway(s, hospitalId) || legacyGateway(hospitalId);
    if (current?.keyId === keyId)
        return current;
    const old = await s.get<{
        encrypted: string;
    }>("SELECT encrypted FROM payment_settings_history WHERE hospitalId=? AND keyId=?", hospitalId, keyId);
    if (old)
        return decrypt(hospitalId, old.encrypted);
    throw new AppError("Original merchant credentials for this payment are unavailable. Contact the hospital.", 409);
}
export function legacyGateway(hospitalId: string): GatewayKeys | null {
    try {
        const g = JSON.parse(process.env.HOSPITAL_RAZORPAY_ACCOUNTS || "{}")[hospitalId];
        return g?.keyId && g?.keySecret ? g : null;
    }
    catch {
        return null;
    }
}
export async function paymentSettings(s: Store, u: User) {
    requireRole(u, "hospital");
    const g = await storedGateway(s, u.hospitalId!) || legacyGateway(u.hospitalId!);
    const r = await s.get<Row>("SELECT * FROM payment_settings WHERE hospitalId=?", u.hospitalId!);
    return {
        keyId: g?.keyId || "",
        mode: g?.keyId.startsWith("rzp_live_") ? "live" : "test",
        secretConfigured: !!g?.keySecret,
        webhookConfigured: !!g?.webhookSecret,
        verifiedAt: r?.verifiedAt || null,
    };
}
export async function candidateSettings(s: Store, u: User, input: Record<string, unknown>): Promise<GatewayKeys> {
    requireRole(u, "hospital");
    const keyId = typeof input.keyId === "string" ? input.keyId.trim() : "";
    if (!["test", "live"].includes(String(input.mode)) ||
        !new RegExp(`^rzp_${input.mode}_[A-Za-z0-9]{4,}$`).test(keyId))
        throw new AppError("Key ID must match the selected Test or Live mode.");
    const old = await storedGateway(s, u.hospitalId!) || legacyGateway(u.hospitalId!);
    const secret = typeof input.keySecret === "string" ? input.keySecret.trim() : "";
    const hook = typeof input.webhookSecret === "string" ? input.webhookSecret.trim() : "";
    const keySecret = secret || (old?.keyId === keyId ? old.keySecret : "");
    const webhookSecret = hook || (old?.keyId === keyId ? old.webhookSecret : "") || "";
    if (!keySecret || keySecret.length > 256 || webhookSecret.length > 256)
        throw new AppError("Enter a Key Secret (maximum 256 characters).");
    const archived = await s.get<{
        encrypted: string;
    }>("SELECT encrypted FROM payment_settings_history WHERE hospitalId=? AND keyId=?", u.hospitalId!, keyId);
    const priorForKey = old?.keyId === keyId
        ? old
        : archived
            ? decrypt(u.hospitalId!, archived.encrypted)
            : null;
    if (priorForKey &&
        (priorForKey.keySecret !== keySecret ||
            priorForKey.webhookSecret !== webhookSecret) && await s.get("SELECT id FROM orders WHERE hospitalId=? AND keyId=? AND status='pending' LIMIT 1", u.hospitalId!, keyId))
        throw new AppError("Resolve pending payments before replacing this Key ID's secrets.", 409);
    return { keyId, keySecret, webhookSecret };
}
export async function testGateway(keys: GatewayKeys) {
    let r: Response;
    try {
        r = await fetch("https://api.razorpay.com/v1/payments?count=1", {
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
            headers: {
                Authorization: `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString("base64")}`,
            },
        });
    }
    catch {
        throw new AppError("Could not reach Razorpay. Check your connection and retry.", 502);
    }
    if (r.status === 401 || r.status === 403)
        throw new AppError("Razorpay rejected these credentials. Check the Key ID and Key Secret.");
    if (!r.ok)
        throw new AppError("Razorpay could not verify the connection. Please retry later.", 502);
    // Do not return merchant payment records to the browser.
    await r.body?.cancel();
}
export async function savePaymentSettings(s: Store, u: User, keys: GatewayKeys) {
    requireRole(u, "hospital");
    await s.tx(async () => {
        // Recheck after the network call, then retain the prior account for its orders.
        await candidateSettings(s, u, {
            ...keys,
            mode: keys.keyId.startsWith("rzp_live_") ? "live" : "test",
        });
        const old = await storedGateway(s, u.hospitalId!) || legacyGateway(u.hospitalId!);
        if (old && old.keyId !== keys.keyId) {
            const historic = await s.get<{
                encrypted: string;
            }>("SELECT encrypted FROM payment_settings_history WHERE hospitalId=? AND keyId=?", u.hospitalId!, old.keyId);
            if (historic &&
                decrypt(u.hospitalId!, historic.encrypted).keySecret !==
                    old.keySecret && await s.get("SELECT id FROM orders WHERE hospitalId=? AND keyId=? AND status='pending' LIMIT 1", u.hospitalId!, old.keyId))
                throw new AppError("Resolve older pending payments before reusing this merchant Key ID.", 409);
            await s.run("INSERT INTO payment_settings_history VALUES(?,?,?) ON CONFLICT(hospitalId,keyId) DO UPDATE SET encrypted=excluded.encrypted", u.hospitalId!, old.keyId, encrypt(u.hospitalId!, old));
        }
        await s.run("INSERT INTO payment_settings VALUES(?,?,?,?) ON CONFLICT(hospitalId) DO UPDATE SET keyId=excluded.keyId,encrypted=excluded.encrypted,verifiedAt=excluded.verifiedAt", u.hospitalId!, keys.keyId, encrypt(u.hospitalId!, keys), new Date().toISOString());
    });
    return await paymentSettings(s, u);
}
