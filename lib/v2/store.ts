import { AsyncLocalStorage } from "node:async_hooks";
import { database, sqlForPostgres, type Database, type Query } from "./database";
type SQLInputValue = string | number | null;
import { randomUUID, randomBytes, createHash } from "node:crypto";
export type Role = "patient" | "hospital";
export type User = {
    id: string;
    role: Role;
    name: string;
    email: string;
    mobile: string;
    hospitalId: string | null;
    createdAt: string;
};
export type Hospital = {
    id: string;
    name: string;
    address: string;
    phone: string;
    upiId: string;
    payeeName: string;
};
export type Service = {
    id: string;
    hospitalId: string;
    name: string;
    prefix: string;
    price: number;
    minutes: number;
    status: string;
    sequence: number;
    streak: number;
};
export type Order = {
    id: string;
    userId: string;
    hospitalId: string;
    serviceId: string;
    amount: number;
    priority: string;
    name: string;
    mobile: string;
    smsConsent: number;
    status: string;
    gatewayId: string | null;
    keyId: string | null;
    paymentId: string | null;
    tokenId: string | null;
    createdAt: string;
    requestKey: string;
};
export type Token = {
    id: string;
    orderId: string;
    userId: string;
    hospitalId: string;
    serviceId: string;
    number: string;
    priority: string;
    status: string;
    createdAt: string;
    calledAt: string | null;
    completedAt: string | null;
};
export type Payment = {
    id: string;
    order_id: string;
    amount: number;
    currency: string;
    status: string;
    amount_refunded: number;
};
export type SMS = {
    tokenId: string;
    status: string;
    sid: string | null;
    error: string | null;
    attempts: number;
    updatedAt: string;
};
export class AppError extends Error {
    constructor(message: string, public status = 400) {
        super(message);
    }
}
const stamp = () => new Date().toISOString();
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export function requireRole(u: User, role: Role) {
    if (u.role !== role)
        throw new AppError("This account cannot perform that action.", 403);
}
export function text(value: unknown, label: string, min = 1, max = 120) {
    if (typeof value !== "string" ||
        value.trim().length < min ||
        value.trim().length > max)
        throw new AppError(`${label}: enter ${min}–${max} characters.`);
    return value.trim();
}
export function phone(value: unknown) {
    const n = text(value, "Mobile number", 10, 16).replace(/\s/g, "");
    const p = /^[6-9]\d{9}$/.test(n) ? `+91${n}` : n;
    if (!/^\+[1-9]\d{9,14}$/.test(p))
        throw new AppError("Use a mobile number with country code, for example +919876543210.");
    return p;
}
export class Store {
    private context = new AsyncLocalStorage<Query>();
    constructor(private db: Database = database()) { }
    async get<T>(sql: string, ...params: SQLInputValue[]): Promise<T | undefined> {
        return (await this.all<T>(sql, ...params))[0];
    }
    async all<T>(sql: string, ...params: SQLInputValue[]): Promise<T[]> {
        const result = await (this.context.getStore() || this.db.query)(sqlForPostgres(sql), params);
        return result.rows as T[];
    }
    async run(sql: string, ...params: SQLInputValue[]) {
        const result = await (this.context.getStore() || this.db.query)(sqlForPostgres(sql), params);
        return { changes: result.rowCount || 0 };
    }
    async tx<T>(fn: () => Promise<T>): Promise<T> {
        if (this.context.getStore())
            return fn();
        return this.db.transaction(q => this.context.run(q, fn));
    }
    async rate(key: string, max = 15, window = 900000) {
        await this.tx(async () => {
            await this.run("DELETE FROM limits WHERE until < ?", Date.now());
            const r = await this.get<{
                count: number;
            }>("SELECT count FROM limits WHERE key=?", key);
            if (r && r.count >= max)
                throw new AppError("Too many requests. Try again later.", 429);
            await this.run("INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=limits.count+1", key, Date.now() + window);
        });
    }
    async register(role: Role, name: string, email: string, mobile: string, passwordHash: string, hospitalName?: string): Promise<User> {
        if (!["patient", "hospital"].includes(role))
            throw new AppError("Choose patient or hospital.");
        name = text(name, "Name", 2, 80);
        email = text(email, "Email", 5, 254).toLowerCase();
        mobile = phone(mobile);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            throw new AppError("Enter a valid email.");
        return await this.tx(async () => {
            if (await this.get("SELECT id FROM users WHERE email=?", email))
                throw new AppError("This email already has an account. Sign in instead.", 409);
            const id = randomUUID();
            const hospitalId = role === "hospital" ? randomUUID() : null;
            if (hospitalId) {
                await this.run("INSERT INTO hospitals(id,name,phone) VALUES(?,?,?)", hospitalId, text(hospitalName, "Hospital name", 2, 100), mobile);
                for (const [name, prefix, minutes] of [
                    ["Doctor OPD", "A", 8],
                    ["Pharmacy", "B", 4],
                    ["Priority assistance", "P", 6],
                ] as const) {
                    await this.run("INSERT INTO services(id,hospitalId,name,prefix,minutes) VALUES(?,?,?,?,?)", randomUUID(), hospitalId, name, prefix, minutes);
                }
            }
            await this.run("INSERT INTO users VALUES(?,?,?,?,?,?,?,?)", id, role, name, email, mobile, passwordHash, hospitalId, stamp());
            return (await this.user(id))!;
        });
    }
    async user(id: string) {
        return await this.get<User>("SELECT id,role,name,email,mobile,hospitalId,createdAt FROM users WHERE id=?", id);
    }
    async credentials(email: string) {
        return await this.get<User & {
            password: string;
        }>("SELECT * FROM users WHERE email=?", email.toLowerCase());
    }
    async newSession(userId: string) {
        const raw = randomBytes(32).toString("hex");
        await this.run("DELETE FROM sessions WHERE expires<?", Date.now());
        await this.run("INSERT INTO sessions VALUES(?,?,?)", digest(raw), userId, Date.now() + 7 * 86400000);
        return raw;
    }
    async session(raw: string): Promise<User | null> {
        const r = await this.get<{
            userId: string;
        }>("SELECT userId FROM sessions WHERE hash=? AND expires>?", digest(raw), Date.now());
        return r ? await this.user(r.userId) || null : null;
    }
    async logout(raw: string) {
        await this.run("DELETE FROM sessions WHERE hash=?", digest(raw));
    }
    async changePassword(id: string, password: string) {
        await this.tx(async () => {
            await this.run("UPDATE users SET password=? WHERE id=?", password, id);
            await this.run("DELETE FROM sessions WHERE userId=?", id);
        });
    }
    async profile(u: User, name: unknown, mobile: unknown) {
        await this.run("UPDATE users SET name=?,mobile=? WHERE id=?", text(name, "Name", 2, 80), phone(mobile), u.id);
        return (await this.user(u.id))!;
    }
    async hospitals() {
        return await this.all<Hospital>("SELECT * FROM hospitals ORDER BY name");
    }
    async hospital(id: string) {
        const h = await this.get<Hospital>("SELECT * FROM hospitals WHERE id=?", id);
        if (!h)
            throw new AppError("Hospital not found.", 404);
        return h;
    }
    async updateHospital(u: User, input: Record<string, unknown>) {
        requireRole(u, "hospital");
        const upi = text(input.upiId, "UPI ID", 0, 100);
        if (upi && !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/.test(upi))
            throw new AppError("Enter a valid UPI ID.");
        await this.run("UPDATE hospitals SET name=?,address=?,phone=?,upiId=?,payeeName=? WHERE id=?", text(input.name, "Hospital name", 2, 100), text(input.address, "Address", 0, 300), phone(input.phone), upi, text(input.payeeName, "Payee name", 0, 100), u.hospitalId!);
        return await this.hospital(u.hospitalId!);
    }
    async services(hospitalId: string) {
        return await this.all<Service>("SELECT * FROM services WHERE hospitalId=? ORDER BY prefix,id", hospitalId);
    }
    async service(id: string) {
        const s = await this.get<Service>("SELECT * FROM services WHERE id=?", id);
        if (!s)
            throw new AppError("Service not found.", 404);
        return s;
    }
    async ownService(u: User, id: string) {
        requireRole(u, "hospital");
        const s = await this.service(id);
        if (s.hospitalId !== u.hospitalId)
            throw new AppError("Service not found.", 404);
        return s;
    }
    async updateService(u: User, id: string, input: {
        price: unknown;
        status: unknown;
        minutes: unknown;
    }) {
        await this.ownService(u, id);
        if (!Number.isSafeInteger(input.price) ||
            Number(input.price) < 100 ||
            Number(input.price) > 1000000)
            throw new AppError("Token price must be ₹1–₹10,000.");
        if (!Number.isInteger(input.minutes) ||
            Number(input.minutes) < 1 ||
            Number(input.minutes) > 180)
            throw new AppError("Service duration must be 1–180 minutes.");
        if (!["open", "paused", "closed"].includes(String(input.status)))
            throw new AppError("Invalid service status.");
        await this.run("UPDATE services SET price=?,status=?,minutes=? WHERE id=?", Number(input.price), String(input.status), Number(input.minutes), id);
    }
    async updateServiceStatus(u: User, id: string, status: unknown) {
        await this.ownService(u, id);
        if (!['open', 'paused', 'closed'].includes(String(status)))
            throw new AppError('Invalid service status.');
        await this.run('UPDATE services SET status=? WHERE id=?', String(status), id);
    }
    async order(id: string) {
        const o = await this.get<Order>("SELECT * FROM orders WHERE id=?", id);
        if (!o)
            throw new AppError("Order not found.", 404);
        return o;
    }
    async ownedOrder(u: User, id: string) {
        const o = await this.order(id);
        if (o.userId !== u.id &&
            !(u.role === "hospital" && o.hospitalId === u.hospitalId))
            throw new AppError("Order not found.", 404);
        return o;
    }
    async ordersFor(u: User) {
        return await this.all<Order & {
            hospitalName: string;
            serviceName: string;
            number: string | null;
            tokenStatus: string | null;
            smsStatus: string | null;
        }>(`SELECT o.*,h.name AS hospitalName,s.name AS serviceName,t.number,t.status AS tokenStatus,m.status AS smsStatus FROM orders o JOIN hospitals h ON h.id=o.hospitalId JOIN services s ON s.id=o.serviceId LEFT JOIN tokens t ON t.id=o.tokenId LEFT JOIN sms m ON m.tokenId=t.id WHERE ${u.role === "hospital" ? "o.hospitalId" : "o.userId"}=? ORDER BY o.createdAt DESC,o.id DESC LIMIT 200`, u.role === "hospital" ? u.hospitalId! : u.id);
    }
    async reserveOrder(u: User, serviceId: string, priority: string, requestKey: string, smsConsent: boolean) {
        requireRole(u, "patient");
        if (!["general", "senior", "pregnant", "disability"].includes(priority))
            throw new AppError("Choose a valid priority category.");
        text(requestKey, "Request key", 1, 80);
        return await this.tx(async () => {
            const previous = await this.get<Order>("SELECT * FROM orders WHERE userId=? AND requestKey=?", u.id, requestKey);
            if (previous) {
                if (previous.serviceId !== serviceId || previous.priority !== priority)
                    throw new AppError("Booking details changed. Start a new booking.", 409);
                return previous;
            }
            const s = await this.service(serviceId);
            if (s.status !== "open" || s.price < 100)
                throw new AppError("This service is not accepting bookings.", 409);
            if (s.prefix === "P" && priority === "general")
                throw new AppError("Select an assistance category for this service.");
            const id = randomUUID();
            await this.run("INSERT INTO orders(id,userId,hospitalId,serviceId,amount,priority,name,mobile,smsConsent,status,createdAt,requestKey) VALUES(?,?,?,?,?,?,?,?,?,'creating',?,?)", id, u.id, s.hospitalId, s.id, s.price, priority, u.name, u.mobile, smsConsent ? 1 : 0, stamp(), requestKey);
            return await this.order(id);
        });
    }
    async attachGateway(id: string, gatewayId: string, keyId: string) {
        await this.run("UPDATE orders SET gatewayId=?,keyId=?,status='pending' WHERE id=? AND gatewayId IS NULL", gatewayId, keyId, id);
    }
    async settle(id: string, p: Payment): Promise<Token> {
        return await this.tx(async () => {
            const o = await this.order(id);
            if (p.order_id !== o.gatewayId ||
                p.amount !== o.amount ||
                p.currency !== "INR" ||
                p.status !== "captured" ||
                p.amount_refunded !== 0 ||
                !p.id)
                throw new AppError("Payment is not a matching captured payment.", 409);
            if (o.tokenId) {
                if (o.paymentId !== p.id)
                    throw new AppError("Order already paid.", 409);
                return await this.token(o.tokenId);
            }
            const service = await this.service(o.serviceId);
            const tokenId = randomBytes(24).toString("hex");
            const number = `${service.prefix}-${String(service.sequence + 1).padStart(3, "0")}`;
            await this.run("UPDATE services SET sequence=sequence+1 WHERE id=?", service.id);
            await this.run("INSERT INTO tokens(id,orderId,userId,hospitalId,serviceId,number,priority,status,createdAt) VALUES(?,?,?,?,?,?,?,'waiting',?)", tokenId, o.id, o.userId, o.hospitalId, o.serviceId, number, o.priority, stamp());
            await this.run("UPDATE orders SET status='paid',paymentId=?,tokenId=? WHERE id=?", p.id, tokenId, o.id);
            await this.run("INSERT INTO sms(tokenId,status,updatedAt) VALUES(?,?,?)", tokenId, o.smsConsent ? "pending" : "opted_out", stamp());
            return await this.token(tokenId);
        });
    }
    async token(id: string) {
        const t = await this.get<Token>("SELECT * FROM tokens WHERE id=?", id);
        if (!t)
            throw new AppError("Token not found.", 404);
        return t;
    }
    async waiting(serviceId: string) {
        const s = await this.service(serviceId);
        const waiting = await this.all<Token>("SELECT * FROM tokens WHERE serviceId=? AND status='waiting' ORDER BY createdAt,number,id", serviceId);
        const urgent = waiting.filter((t) => t.priority === "urgent");
        const general = waiting.filter((t) => t.priority === "general");
        const priority = waiting.filter((t) => !["urgent", "general"].includes(t.priority));
        let streak = s.streak;
        const result = [...urgent];
        while (general.length || priority.length) {
            if (priority.length && (streak >= 2 || !general.length)) {
                result.push(priority.shift()!);
                streak = 0;
            }
            else {
                result.push(general.shift()!);
                streak = Math.min(2, streak + 1);
            }
        }
        return result;
    }
    async average(serviceId: string) {
        const completed = await this.all<{
            duration: number;
        }>("SELECT EXTRACT(EPOCH FROM (completedAt::timestamptz-calledAt::timestamptz))/60.0 AS duration FROM tokens WHERE serviceId=? AND status='completed' ORDER BY completedAt DESC LIMIT 20", serviceId);
        return completed.length
            ? Math.max(1, Math.round(completed.reduce((n, t) => n + t.duration, 0) / completed.length))
            : (await this.service(serviceId)).minutes;
    }
    async board(hospitalId: string) {
        await this.hospital(hospitalId);
        return await Promise.all((await this.services(hospitalId)).map(async (s) => {
            const current = await this.get<Token>("SELECT * FROM tokens WHERE serviceId=? AND status='called'", s.id);
            const waiting = await this.waiting(s.id);
            return {
                ...s,
                current: current?.number || null,
                waiting: waiting.length,
                upcoming: waiting.slice(0, 4).map((t) => t.number),
                average: await this.average(s.id),
            };
        }));
    }
    async insights(u: User) {
        requireRole(u, 'hospital');
        const hospitalId = u.hospitalId!;
        const totals = (await this.get<{
            waiting: number;
            completed: number;
            missed: number;
            averageWaitMinutes: number;
            averageServiceMinutes: number;
        }>(`SELECT
      SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END) AS missed,
      AVG(CASE WHEN status='completed' AND calledAt IS NOT NULL THEN EXTRACT(EPOCH FROM (calledAt::timestamptz-createdAt::timestamptz))/60.0 END) AS averageWaitMinutes,
      AVG(CASE WHEN status='completed' AND calledAt IS NOT NULL AND completedAt IS NOT NULL THEN EXTRACT(EPOCH FROM (completedAt::timestamptz-calledAt::timestamptz))/60.0 END) AS averageServiceMinutes
      FROM tokens WHERE hospitalId=?`, hospitalId))!;
        const metrics = {
            waiting: totals.waiting || 0,
            completed: totals.completed || 0,
            missed: totals.missed || 0,
            averageWaitMinutes: Math.max(0, Math.round(totals.averageWaitMinutes || 0)),
            averageServiceMinutes: Math.max(0, Math.round(totals.averageServiceMinutes || 0)),
        };
        const arrivals = await this.all<{
            hour: number;
            count: number;
        }>("SELECT EXTRACT(HOUR FROM createdAt::timestamptz AT TIME ZONE 'Asia/Kolkata')::integer AS hour,COUNT(*) AS count FROM tokens WHERE hospitalId=? GROUP BY hour", hospitalId);
        const counts = new Map(arrivals.map((row) => [row.hour, row.count]));
        const hours = Array.from({ length: 24 }, (_, hour) => ({
            hour, label: String(hour).padStart(2, '0'), count: counts.get(hour) || 0,
        }));
        const activity = await this.all<{
            at: string;
            message: string;
        }>(`SELECT at,message FROM (
      SELECT t.createdAt AS at,t.number || ' joined ' || s.name AS message FROM tokens t JOIN services s ON s.id=t.serviceId WHERE t.hospitalId=?
      UNION ALL
      SELECT t.calledAt AS at,t.number || ' called for ' || s.name AS message FROM tokens t JOIN services s ON s.id=t.serviceId WHERE t.hospitalId=? AND t.calledAt IS NOT NULL
      UNION ALL
      SELECT t.completedAt AS at,t.number || CASE WHEN t.status='missed' THEN ' marked missed' ELSE ' completed' END AS message FROM tokens t WHERE t.hospitalId=? AND t.completedAt IS NOT NULL AND t.status IN ('completed','missed')
    ) AS events ORDER BY at DESC LIMIT 15`, hospitalId, hospitalId, hospitalId);
        const services = await this.board(hospitalId);
        return { metrics, openQueues: services.filter((s) => s.status === 'open').length, services, hours, activity, updatedAt: stamp() };
    }
    async track(id: string) {
        const t = await this.token(id), s = await this.service(t.serviceId);
        const current = await this.get<Token>("SELECT * FROM tokens WHERE serviceId=? AND status='called'", s.id);
        const ahead = t.status === "waiting"
            ? (await this.waiting(s.id)).findIndex((v) => v.id === id)
            : 0;
        return {
            id: t.id,
            number: t.number,
            status: t.status,
            hospital: (await this.hospital(t.hospitalId)).name,
            service: s.name,
            serviceStatus: s.status,
            ahead: Math.max(0, ahead),
            estimatedMinutes: t.status === "waiting"
                ? (Math.max(0, ahead) + (current ? 1 : 0)) * await this.average(s.id)
                : 0,
            current: current?.number || null,
            createdAt: t.createdAt,
        };
    }
    async hospitalTokens(u: User) {
        requireRole(u, "hospital");
        return await this.all<Token & {
            name: string;
        }>("SELECT t.*,o.name FROM tokens t JOIN orders o ON o.id=t.orderId WHERE t.hospitalId=? ORDER BY t.createdAt DESC,t.id DESC LIMIT 500", u.hospitalId!);
    }
    async counter(u: User, serviceId: string, action: string, tokenId?: string) {
        await this.ownService(u, serviceId);
        return await this.tx(async () => {
            const current = await this.get<Token>("SELECT * FROM tokens WHERE serviceId=? AND status='called'", serviceId);
            if (action === "next") {
                if ((await this.service(serviceId)).status !== "open")
                    throw new AppError("Open the service before calling the next token.", 409);
                if (current)
                    throw new AppError("Complete the current token first.", 409);
                const next = (await this.waiting(serviceId))[0];
                if (!next)
                    throw new AppError("Queue is empty.", 409);
                await this.run("UPDATE tokens SET status='called',calledAt=? WHERE id=?", stamp(), next.id);
                if (next.priority !== "urgent")
                    await this.run("UPDATE services SET streak=? WHERE id=?", next.priority === "general"
                        ? Math.min(2, (await this.service(serviceId)).streak + 1)
                        : 0, serviceId);
                return;
            }
            if (!current || current.id !== tokenId)
                throw new AppError("The queue changed. Refresh before trying again.", 409);
            if (action === "recall")
                return;
            if (!["complete", "missed"].includes(action))
                throw new AppError("Unknown counter action.");
            await this.run("UPDATE tokens SET status=?,completedAt=? WHERE id=?", action === "complete" ? "completed" : "missed", stamp(), current.id);
        });
    }
    async cancel(u: User, tokenId: string) {
        const t = await this.token(tokenId);
        if (t.userId !== u.id)
            throw new AppError("Token not found.", 404);
        if ((await this.run("UPDATE tokens SET status='cancelled' WHERE id=? AND status='waiting'", t.id)).changes !== 1)
            throw new AppError("Only waiting tokens can be cancelled.", 409);
    }
    async sms(tokenId: string) {
        return (await this.get<SMS>("SELECT * FROM sms WHERE tokenId=?", tokenId))!;
    }
}
const globalStore = globalThis as unknown as {
    mediqueueV2?: Store;
};
export function store() { return (globalStore.mediqueueV2 ||= new Store()); }
