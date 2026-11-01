import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
const axios = createRequire(import.meta.url)("axios") as typeof import("axios").default;
import { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { POST } from "../app/api/v2/[...path]/route";
import { Store } from "../lib/v2/store";
import { schema, type Query } from "../lib/v2/database";
import { legacyGateway, gatewayForOrder } from "../lib/v2/payment-settings";
import { createGatewayOrder, gateway, reconcile } from "../lib/v2/providers";

test("shared environment credentials complete authenticated hospital checkout safely", async (t) => {
  const oldEnv = { ...process.env };
  const globals = globalThis as unknown as { mediqueueV2?: Store };
  const previousStore = globals.mediqueueV2;
  const adapter = axios.defaults.adapter;
  const db = new PGlite();
  await db.exec(schema);
  const query: Query = async (sql, params = []) => { const r = await db.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows }; };
  const s = new Store({ query, transaction: async fn => db.transaction(async tx => fn(async (sql, params = []) => { const r = await tx.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows }; })) });
  try {
    process.env.RAZORPAY_KEY_ID = "rzp_test_shared";
    process.env.RAZORPAY_KEY_SECRET = "unit-test-only-secret";
    delete process.env.HOSPITAL_RAZORPAY_ACCOUNTS;
    assert.equal(legacyGateway("hospital-a")?.keyId, "rzp_test_shared");
    assert.equal(legacyGateway("hospital-b")?.keyId, "rzp_test_shared");
    const owner = await s.register("hospital", "Owner", "owner@payments.test", "+919876543210", "hash", "Test Hospital");
    const patient = await s.register("patient", "Patient", "patient@payments.test", "+919876543211", "hash");
    const stranger = await s.register("patient", "Other", "other@payments.test", "+919876543212", "hash");
    assert.equal((await gateway(owner.hospitalId!, s)).keyId, "rzp_test_shared");
    assert.equal((await gatewayForOrder(s, owner.hospitalId!, "rzp_test_shared")).keySecret, process.env.RAZORPAY_KEY_SECRET);
    const service = (await s.services(owner.hospitalId!))[0];
    await s.updateService(owner, service.id, { price: 2500, minutes: 8, status: "open" });
    globals.mediqueueV2 = s;
    const session = await s.newSession(patient.id);
    const call = (path: string, body: unknown, cookie = session) => POST(new NextRequest(`http://localhost:3001/api/v2/${path}`, {
      method: "POST", headers: { origin: "http://localhost:3001", "content-type": "application/json", "x-mediqueue-role": "patient", cookie: `mediqueue_patient_session=${cookie}` }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ path: [path] }) });
    let requests = 0;
    axios.defaults.adapter = async config => {
      requests++;
      const data = JSON.parse(config.data as string);
      assert.equal(data.amount, 2500);
      assert.equal(data.currency, "INR");
      return { data: { id: "order_test", amount: 2500, currency: "INR" }, status: 200, statusText: "OK", headers: {}, config };
    };
    const response = await call("order", { serviceId: service.id, priority: "general", requestKey: "checkout-1", amount: 100, smsConsent: false });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.order.amount, 2500); // Browser cannot lower the service fee.
    assert.equal(result.key, "rzp_test_shared");
    assert.equal(JSON.stringify(result).includes(process.env.RAZORPAY_KEY_SECRET!), false);
    await createGatewayOrder(s, await s.order(result.order.id));
    assert.equal(requests, 1);
    const signature = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!).update("order_test|pay_test").digest("hex");
    const fields = { orderId: result.order.id, gatewayOrderId: "order_test", paymentId: "pay_test", signature };
    assert.equal((await call("verify", { orderId: result.order.id })).status, 400);
    assert.equal((await call("verify", { ...fields, gatewayOrderId: "order_wrong" })).status, 400);
    assert.equal((await call("verify", { ...fields, signature: "0".repeat(64) })).status, 400);
    assert.equal((await s.order(result.order.id)).tokenId, null);
    const strangerSession = await s.newSession(stranger.id);
    assert.equal((await call("verify", fields, strangerSession)).status, 404);
    const captured = { id: "pay_test", order_id: "order_test", amount: 2500, currency: "INR", status: "captured", amount_refunded: 0 };
    let payment = { ...captured, status: "authorized" };
    t.mock.method(globalThis, "fetch", async () => Response.json(payment));
    assert.equal((await (await call("verify", fields)).json()).token, null);
    payment = { ...captured, amount: 100 };
    assert.equal((await call("verify", fields)).status, 409);
    payment = captured;
    const verified = await call("verify", fields);
    assert.equal(verified.status, 200);
    const token = (await verified.json()).token;
    assert.ok(token.id);
    assert.equal((await reconcile(s, await s.order(result.order.id), "pay_test", signature))?.id, token.id);
    assert.equal((await call("verify", { ...fields, signature: "0".repeat(64) })).status, 400);
    const invalid = { ...await s.order(result.order.id), id: "minimum-test", gatewayId: null, amount: 99 };
    await assert.rejects(createGatewayOrder(s, invalid), /100/);
    axios.defaults.adapter = async () => { throw { response: { status: 401, data: { error: { description: "private provider detail" } } } }; };
    const auth = await call("order", { serviceId: service.id, priority: "general", requestKey: "auth-failure" });
    assert.equal(auth.status, 401);
    assert.equal(JSON.stringify(await auth.json()).includes("private provider detail"), false);
  } finally {
    axios.defaults.adapter = adapter;
    globals.mediqueueV2 = previousStore;
    for (const key of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "HOSPITAL_RAZORPAY_ACCOUNTS"]) {
      if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key];
    }
    await db.close();
  }
});
