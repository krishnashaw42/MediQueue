import { AppError, store, type Order, type Payment, type Store } from "./store";
import { storedGateway, gatewayForOrder } from "./payment-settings";
import { signatureOK } from "./security";
type Gateway = {
    keyId: string;
    keySecret: string;
    webhookSecret: string;
};
export function origin() {
    const url = new URL(process.env.APP_ORIGIN || "http://127.0.0.1:3001");
    if (!["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/")
        throw new AppError("APP_ORIGIN must be a plain HTTP(S) origin.", 503);
    return url.origin;
}
export function trackingLink(id: string) {
    return `${origin()}/track/${encodeURIComponent(id)}`;
}
export async function gateway(hospitalId: string, s: Store = store()): Promise<Gateway> {
    const saved = await storedGateway(s, hospitalId);
    if (saved)
        return saved;
    let map: Record<string, Gateway>;
    try {
        map = JSON.parse(process.env.HOSPITAL_RAZORPAY_ACCOUNTS || "{}");
    }
    catch {
        throw new AppError("Payment configuration needs attention.", 503);
    }
    const g = map[hospitalId];
    if (!g?.keyId || !g.keySecret)
        throw new AppError("This hospital has not connected its payment gateway yet.", 503);
    return g;
}
export async function gatewayStatus(hospitalId: string) {
    try {
        const g = await gateway(hospitalId);
        return {
            connected: true,
            mode: g.keyId.startsWith("rzp_test_") ? "test" : "live",
            webhooksConfigured: !!g.webhookSecret,
        };
    }
    catch {
        return {
            connected: false,
            mode: "unconfigured",
            webhooksConfigured: false,
        };
    }
}
async function razor<T>(s: Store, hospitalId: string, path: string, data?: unknown, credentials?: Gateway): Promise<T> {
    const g = credentials || await gateway(hospitalId, s);
    let r: Response;
    try {
        r = await fetch(`https://api.razorpay.com/v1/${path}`, {
            method: data ? "POST" : "GET",
            cache: "no-store",
            signal: AbortSignal.timeout(12000),
            headers: {
                Authorization: `Basic ${Buffer.from(`${g.keyId}:${g.keySecret}`).toString("base64")}`,
                "Content-Type": "application/json",
            },
            ...(data ? { body: JSON.stringify(data) } : {}),
        });
    }
    catch {
        throw new AppError("Payment provider is temporarily unreachable. Check this order before paying again.", 502);
    }
    if (!r.ok)
        throw new AppError("Payment provider rejected the request. Check gateway settings or retry payment verification.", 502);
    return (await r.json()) as T;
}
export async function createGatewayOrder(s: Store, order: Order) {
    if (order.gatewayId)
        return order;
    const g = await gateway(order.hospitalId, s);
    try {
        const r = await razor<{
            id: string;
            amount: number;
            currency: string;
        }>(s, order.hospitalId, "orders", {
            amount: order.amount,
            currency: "INR",
            receipt: order.id,
            partial_payment: false,
            notes: { mediqueue_order: order.id },
        });
        if (!/^order_[a-zA-Z0-9]+$/.test(r.id) ||
            r.amount !== order.amount ||
            r.currency !== "INR")
            throw new AppError("Unexpected payment order response.", 502);
        await s.attachGateway(order.id, r.id, g.keyId);
        return await s.order(order.id);
    }
    catch (e) {
        await s.run("UPDATE orders SET status='setup_failed' WHERE id=? AND gatewayId IS NULL", order.id);
        throw e;
    }
}
export async function reconcile(s: Store, o: Order, paymentId?: string, signature?: string) {
    if (o.tokenId) {
        await sendSMS(s, o.tokenId);
        return await s.token(o.tokenId);
    }
    if (!o.gatewayId)
        throw new AppError("This order has no payment checkout. Start a new booking.", 409);
    const g = await gatewayForOrder(s, o.hospitalId, o.keyId!);
    let payment: Payment | undefined;
    if (paymentId) {
        if (!/^pay_[a-zA-Z0-9]+$/.test(paymentId) ||
            !signatureOK(`${o.gatewayId}|${paymentId}`, signature || "", g.keySecret))
            throw new AppError("Invalid payment signature.", 400);
        payment = await razor<Payment>(s, o.hospitalId, `payments/${paymentId}`, undefined, g);
    }
    else {
        const result = await razor<{
            items: Payment[];
        }>(s, o.hospitalId, `orders/${encodeURIComponent(o.gatewayId)}/payments`, undefined, g);
        payment = result.items.find((p) => p.status === "captured" && p.amount_refunded === 0);
    }
    if (!payment || payment.status !== "captured")
        return null;
    const token = await s.settle(o.id, payment);
    await sendSMS(s, token.id);
    return token;
}
export function smsConfigured() {
    return !!(process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID));
}
function twilioAuth() {
    return `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}
function smsLinkReady() {
    const u = new URL(origin());
    return (u.protocol === "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
        !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname) &&
        !u.hostname.endsWith(".local"));
}
export async function sendSMS(s: Store, tokenId: string) {
    const job = await s.sms(tokenId);
    if (!job ||
        !["pending", "failed", "needs_configuration"].includes(job.status))
        return;
    if (!smsConfigured() || !smsLinkReady()) {
        await s.run("UPDATE sms SET status='needs_configuration',error=?,updatedAt=? WHERE tokenId=?", "SMS needs provider credentials and a publicly reachable HTTPS tracking address.", new Date().toISOString(), tokenId);
        return;
    }
    if (job.attempts >= 3)
        return;
    const claimed = await s.run("UPDATE sms SET status='sending',attempts=attempts+1,updatedAt=? WHERE tokenId=? AND status IN ('pending','failed','needs_configuration')", new Date().toISOString(), tokenId);
    if (!claimed.changes)
        return;
    const t = await s.token(tokenId), o = await s.order(t.orderId);
    const template = process.env.TWILIO_SMS_TEMPLATE ||
        "MediQueue: Your token is {token}. Track your turn: {link}";
    const body = template
        .replaceAll("{token}", t.number)
        .replaceAll("{link}", trackingLink(t.id))
        .replaceAll("{hospital}", (await s.hospital(t.hospitalId)).name);
    const form = new URLSearchParams({ To: o.mobile, Body: body });
    if (process.env.TWILIO_MESSAGING_SERVICE_SID)
        form.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
    else
        form.set("From", process.env.TWILIO_FROM!);
    try {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID!)}/Messages.json`, {
            method: "POST",
            headers: {
                Authorization: twilioAuth(),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form,
            signal: AbortSignal.timeout(12000),
        });
        const result = (await r.json()) as {
            sid?: string;
            status?: string;
            code?: number;
        };
        if (!r.ok || !result.sid) {
            await s.run("UPDATE sms SET status=?,error=?,updatedAt=? WHERE tokenId=?", r.status >= 500 ? "unknown" : "failed", `SMS provider error ${result.code || r.status}.`, new Date().toISOString(), tokenId);
            return;
        }
        await s.run("UPDATE sms SET status=?,sid=?,error=NULL,updatedAt=? WHERE tokenId=?", result.status || "queued", result.sid, new Date().toISOString(), tokenId);
    }
    catch {
        // A timeout may happen AFTER Twilio accepts the SMS. Do not blindly resend it.
        await s.run("UPDATE sms SET status='unknown',error=?,updatedAt=? WHERE tokenId=?", "Delivery submission is uncertain. Check Twilio before resending.", new Date().toISOString(), tokenId);
    }
}
export async function refreshSMS(s: Store, tokenId: string) {
    const job = await s.sms(tokenId);
    if (job.status === "sending" &&
        Date.now() - Date.parse(job.updatedAt) > 90000) {
        await s.run("UPDATE sms SET status='unknown',error='Submission interrupted. Check Twilio before resending.' WHERE tokenId=?", tokenId);
    }
    if (!job.sid ||
        !smsConfigured() ||
        ["delivered", "failed", "undelivered"].includes(job.status))
        return await s.sms(tokenId);
    try {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID!)}/Messages/${encodeURIComponent(job.sid)}.json`, {
            headers: { Authorization: twilioAuth() },
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
            const result = (await r.json()) as {
                status: string;
                error_code?: number;
            };
            await s.run("UPDATE sms SET status=?,error=?,updatedAt=? WHERE tokenId=?", result.status, result.error_code ? `SMS error ${result.error_code}` : null, new Date().toISOString(), tokenId);
        }
    }
    catch {
        /* Keep the last known provider status on a temporary network error. */
    }
    return await s.sms(tokenId);
}
