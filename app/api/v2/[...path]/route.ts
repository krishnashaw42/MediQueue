import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { gatewayForOrder } from "../../../../lib/v2/payment-settings";
import { paymentSettings, candidateSettings, testGateway, savePaymentSettings, } from "../../../../lib/v2/payment-settings";
import { AppError, store, text, type Role, type Order, } from "../../../../lib/v2/store";
import { hashPassword, checkPassword, signatureOK, } from "../../../../lib/v2/security";
import { gateway, gatewayStatus, createGatewayOrder, reconcile, origin, trackingLink, sendSMS, refreshSMS, smsConfigured, } from "../../../../lib/v2/providers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const legacyCookie = "mediqueue_session_v2";
const cookieForRole = (role: Role) => `mediqueue_${role}_session`;
const json = (data: unknown, status = 200) => NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});
async function sessionResponse(userId: string, role: Role) {
    const s = store(), r = json({ user: await s.user(userId) });
    r.cookies.set(cookieForRole(role), await s.newSession(userId), {
        httpOnly: true,
        sameSite: "lax",
        secure: origin().startsWith("https:"),
        path: "/",
        maxAge: 604800,
    });
    r.cookies.set(legacyCookie, "", { maxAge: 0, path: "/" });
    return r;
}
function password(value: unknown) {
    if (typeof value !== "string" || value.length < 12 || value.length > 128)
        throw new AppError("Use a password with 12–128 characters.");
    return value;
}
function existingPassword(value: unknown) {
    if (typeof value !== "string" || !value.length || value.length > 128)
        throw new AppError("Enter your password.");
    return value;
}
async function handle(req: NextRequest, ctx: {
    params: Promise<{
        path: string[];
    }>;
}) {
    try {
        const path = (await ctx.params).path.join("/"), s = store();
        if (req.method === "POST" && path.startsWith("webhook/")) {
            const hospitalId = path.slice(8);
            const raw = await req.text();
            if (raw.length > 65536)
                throw new AppError("Webhook too large.", 413);
            const event = JSON.parse(raw);
            const gatewayId = event.payload?.payment?.entity?.order_id;
            const order = typeof gatewayId === "string"
                ? await s.get<Order>("SELECT * FROM orders WHERE gatewayId=? AND hospitalId=?", gatewayId, hospitalId) : undefined;
            const config = order?.keyId
                ? await gatewayForOrder(s, hospitalId, order.keyId) : await gateway(hospitalId, s);
            if (!signatureOK(raw, req.headers.get("x-razorpay-signature") || "", config.webhookSecret))
                throw new AppError("Invalid webhook signature.", 400);
            if (event.event === "payment.captured" && order)
                await reconcile(s, order);
            return json({ received: true });
        }
        let b: Record<string, unknown> = {};
        if (req.method === "POST") {
            if (req.headers.get("origin") !== origin())
                throw new AppError("Open the app using its configured address, then retry.", 403);
            if (!req.headers.get("content-type")?.startsWith("application/json"))
                throw new AppError("Expected JSON.", 415);
            const raw = await req.text();
            if (raw.length > 16384)
                throw new AppError("Request is too large.", 413);
            const parsed: unknown = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                throw new AppError("Expected a JSON object.");
            b = parsed as Record<string, unknown>;
        }
        const requestedRole = req.headers.get("x-mediqueue-role");
        if (requestedRole &&
            requestedRole !== "patient" &&
            requestedRole !== "hospital")
            throw new AppError("Invalid account type.", 400);
        const roleHint = requestedRole as Role | null;
        const oldRaw = req.cookies.get(legacyCookie)?.value || "";
        const oldUser = oldRaw ? await s.session(oldRaw) : null;
        const newRaw = roleHint
            ? req.cookies.get(cookieForRole(roleHint))?.value || ""
            : req.cookies.get(cookieForRole("patient"))?.value ||
                req.cookies.get(cookieForRole("hospital"))?.value ||
                "";
        const rawSession = newRaw ||
            (oldUser && (!roleHint || oldUser.role === roleHint) ? oldRaw : "");
        const user = await s.session(rawSession);
        if (req.method === "GET") {
            if (path === "me")
                return json({
                    user,
                    hospital: user?.hospitalId ? await s.hospital(user.hospitalId) : null,
                    gateway: user?.hospitalId ? await gatewayStatus(user.hospitalId) : null,
                    smsConfigured: smsConfigured(),
                });
            if (path === "hospitals")
                return json({ hospitals: await s.hospitals() });
            if (path === "services") {
                const id = req.nextUrl.searchParams.get("hospital") || "";
                return json({
                    hospital: await s.hospital(id),
                    services: await s.board(id),
                    gateway: await gatewayStatus(id),
                });
            }
            if (path === "track")
                return json(await s.track(req.nextUrl.searchParams.get("id") || ""));
            if (path === "qr") {
                const id = req.nextUrl.searchParams.get("id") || "";
                await s.token(id);
                const svg = await QRCode.toString(trackingLink(id), {
                    type: "svg",
                    margin: 2,
                    width: 256,
                    errorCorrectionLevel: "M",
                });
                return new NextResponse(svg, {
                    headers: {
                        "Content-Type": "image/svg+xml",
                        "Cache-Control": "no-store",
                        "Referrer-Policy": "no-referrer",
                        "X-Content-Type-Options": "nosniff",
                    },
                });
            }
            if (!user)
                throw new AppError("Please sign in.", 401);
            if (path === "payment-settings")
                return json({
                    ...await paymentSettings(s, user),
                    webhookUrl: `${origin()}/api/v2/webhook/${user.hospitalId}`,
                });
            if (path === "orders")
                return json({ orders: await s.ordersFor(user) });
            if (path === "insights")
                return json(await s.insights(user));
            if (path === "dashboard")
                return json({
                    tokens: await s.hospitalTokens(user),
                    services: await s.board(user.hospitalId!),
                });
        }
        if (req.method === "POST") {
            if (path === "register" || path === "login") {
                const email = text(b.email, "Email", 5, 254).toLowerCase();
                await s.rate(`auth:${email}`, 12);
                await s.rate("auth:global", 150);
                const role = b.role as Role;
                if (!["patient", "hospital"].includes(role))
                    throw new AppError("Choose an account type.");
                if (path === "register") {
                    const u = await s.register(role, text(b.name, "Name", 2, 80), email, text(b.mobile, "Mobile"), await hashPassword(password(b.password)), b.hospitalName as string);
                    const sameRole = req.cookies.get(cookieForRole(role))?.value;
                    if (sameRole)
                        await s.logout(sameRole);
                    return await sessionResponse(u.id, role);
                }
                const account = await s.credentials(email);
                const good = await checkPassword(existingPassword(b.password), account?.password || "");
                if (!account || !good || account.role !== role)
                    throw new AppError("Email, password, or account type is incorrect.", 401);
                const sameRole = req.cookies.get(cookieForRole(role))?.value;
                if (sameRole)
                    await s.logout(sameRole);
                return await sessionResponse(account.id, role);
            }
            if (path === "logout") {
                await s.logout(rawSession);
                const r = json({ ok: true });
                r.cookies.set(cookieForRole(roleHint || user?.role || "patient"), "", {
                    maxAge: 0,
                    path: "/",
                });
                if (rawSession === oldRaw && oldRaw)
                    r.cookies.set(legacyCookie, "", { maxAge: 0, path: "/" });
                return r;
            }
            if (!user)
                throw new AppError("Please sign in.", 401);
            if (path === "payment-settings") {
                const keys = await candidateSettings(s, user, b);
                await s.rate(`payment-settings:${user.id}`, 10, 60000);
                if (!["test", "save"].includes(String(b.action)))
                    throw new AppError("Choose test or save.");
                await testGateway(keys);
                const settings = b.action === "save"
                    ? await savePaymentSettings(s, user, keys) : await paymentSettings(s, user);
                return json({
                    ...settings,
                    webhookUrl: `${origin()}/api/v2/webhook/${user.hospitalId}`,
                });
            }
            if (path === "profile")
                return json({ user: await s.profile(user, b.name, b.mobile) });
            if (path === "password") {
                await s.rate(`password:${user.id}`, 5);
                if (!(await checkPassword(existingPassword(b.currentPassword), (await s.credentials(user.email))!.password)))
                    throw new AppError("Current password is incorrect.");
                await s.changePassword(user.id, await hashPassword(password(b.newPassword)));
                return await sessionResponse(user.id, user.role);
            }
            if (path === "hospital")
                return json({ hospital: await s.updateHospital(user, b) });
            if (path === "service") {
                await s.updateService(user, String(b.id), {
                    price: b.price,
                    status: b.status,
                    minutes: b.minutes,
                });
                return json({ ok: true });
            }
            if (path === "service-status") {
                await s.updateServiceStatus(user, String(b.id), b.status);
                return json({ ok: true });
            }
            if (path === "counter") {
                await s.counter(user, String(b.serviceId), String(b.action), b.tokenId as string | undefined);
                return json({ ok: true });
            }
            if (path === "cancel") {
                await s.cancel(user, String(b.tokenId));
                return json({ ok: true });
            }
            if (path === "order") {
                await s.rate(`orders:${user.id}`, 20);
                await gateway((await s.service(String(b.serviceId))).hospitalId);
                const key = text(b.requestKey, "Request key", 10, 80);
                const existing = await s.get<Order>("SELECT * FROM orders WHERE userId=? AND requestKey=?", user.id, key);
                if (existing && !existing.gatewayId)
                    throw new AppError("Checkout is still being created or failed. Refresh your orders before starting a new booking.", 409);
                const reserved = await s.reserveOrder(user, String(b.serviceId), String(b.priority), key, b.smsConsent === true);
                const o = await createGatewayOrder(s, reserved);
                return json({
                    order: o,
                    key: o.keyId,
                    hospital: (await s.hospital(o.hospitalId)).name,
                });
            }
            if (path === "verify" || path === "reconcile") {
                const o = await s.ownedOrder(user, String(b.orderId));
                await s.rate(`verify:${o.id}`, 30, 60000);
                if (path === "verify" &&
                    (typeof b.paymentId !== "string" || typeof b.signature !== "string"))
                    throw new AppError("Missing payment verification fields.");
                const token = await reconcile(s, o, path === "verify" ? (b.paymentId as string) : undefined, b.signature as string | undefined);
                return json({
                    token,
                    order: await s.order(o.id),
                    link: token ? trackingLink(token.id) : null,
                });
            }
            if (path === "sms") {
                const token = await s.token(String(b.tokenId));
                await s.ownedOrder(user, token.orderId);
                await s.rate(`sms:${token.id}`, 6, 60000);
                if (b.retry === true)
                    await sendSMS(s, token.id);
                return json({ sms: await refreshSMS(s, token.id) });
            }
        }
        throw new AppError("Endpoint not found.", 404);
    }
    catch (error) {
        if (error instanceof AppError)
            return json({ error: error.message }, error.status);
        if (error instanceof SyntaxError)
            return json({ error: "Invalid JSON." }, 400);
        console.error("MediQueue request failed:", error instanceof Error ? error.name : "Unknown error");
        return json({ error: "The request could not be completed. Please retry." }, 500);
    }
}
export const GET = handle;
export const POST = handle;
