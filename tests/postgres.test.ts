import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/v2/[...path]/route';
import { savePaymentSettings, storedGateway, paymentSettings } from '../lib/v2/payment-settings';
import { Store } from '../lib/v2/store';
import { schema, type Query } from '../lib/v2/database';

test('Postgres preserves ownership, payment idempotency, queue order and insights', async () => {
  const db = new PGlite();
  await db.exec(schema);
  const query: Query = async (sql, params = []) => { const r = await db.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows }; };
  const s = new Store({ query, transaction: async fn => db.transaction(async tx => fn(async (sql, params = []) => { const r = await tx.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows }; })) });
  try {
    const owner = await s.register('hospital', 'Owner', 'owner@example.test', '+919876543210', 'hash', 'Test Hospital');
    const other = await s.register('hospital', 'Other', 'other@example.test', '+919876543211', 'hash', 'Other Hospital');
    const patient = await s.register('patient', 'Patient', 'patient@example.test', '+919876543212', 'hash');
    const service = (await s.services(owner.hospitalId!))[0];
    await s.updateService(owner, service.id, { price: 2500, minutes: 8, status: 'open' });
    await assert.rejects(s.updateServiceStatus(other, service.id, 'closed'));
    const session = await s.newSession(patient.id);
    assert.equal((await s.session(session))?.id, patient.id);
    const order = await s.reserveOrder(patient, service.id, 'general', 'request-1', false);
    assert.equal((await s.reserveOrder(patient, service.id, 'general', 'request-1', false)).id, order.id);
    await s.attachGateway(order.id, 'order_test', 'rzp_test_example');
    const payment = { id: 'pay_test', order_id: 'order_test', amount: 2500, currency: 'INR', status: 'captured', amount_refunded: 0 };
    await assert.rejects(s.settle(order.id, { ...payment, amount: 1 }));
    const token = await s.settle(order.id, payment);
    assert.equal((await s.settle(order.id, payment)).id, token.id);
    assert.equal((await s.track(token.id)).number, `${service.prefix}-001`);
    await s.counter(owner, service.id, 'next');
    await s.counter(owner, service.id, 'complete', token.id);
    const insight = await s.insights(owner);
    assert.equal(insight.metrics.completed, 1);
    assert.equal(insight.hours.reduce((n, h) => n + h.count, 0), 1);
    assert.equal((await s.insights(other)).metrics.completed, 0);
    await assert.rejects(s.insights(patient));
    const globals = globalThis as unknown as { mediqueueV2?: Store };
    const previousStore = globals.mediqueueV2;
    const previousKey = process.env.PAYMENT_ENCRYPTION_KEY;
    const previousOrigin = process.env.APP_ORIGIN;
    globals.mediqueueV2 = s;
    process.env.PAYMENT_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.APP_ORIGIN = 'https://pocketlyss.in';
    try {
      const ownerSession = await s.newSession(owner.id);
      const cookie = 'mediqueue_patient_session=' + session + '; mediqueue_hospital_session=' + ownerSession;
      const call = (path: string, role: string, body?: object) => (body ? POST : GET)(new NextRequest('https://pocketlyss.in/api/v2/' + path, {
        method: body ? 'POST' : 'GET',
        headers: { cookie, 'x-mediqueue-role': role, origin: 'https://pocketlyss.in', 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }), { params: Promise.resolve({path: [path]}) });
      assert.equal((await (await call('me', 'patient')).json()).user.id, patient.id);
      assert.equal((await (await call('me', 'hospital')).json()).user.id, owner.id);
      assert.equal((await call('insights', 'patient')).status, 403);
      assert.equal((await call('insights', 'hospital')).status, 200);
      assert.equal((await call('payment-settings', 'patient')).status, 403);
      const keys = { keyId: 'rzp_test_example', keySecret: 'test-only-secret', webhookSecret: 'test-hook-secret' };
      await savePaymentSettings(s, owner, keys);
      assert.deepEqual(await storedGateway(s, owner.hospitalId!), keys);
      const settings = await paymentSettings(s, owner);
      assert.equal(settings.secretConfigured, true);
      assert.equal(JSON.stringify(settings).includes(keys.keySecret), false);
      const encrypted = await s.get<{encrypted: string}>('SELECT encrypted FROM payment_settings WHERE hospitalId=?', owner.hospitalId!);
      assert.equal(encrypted!.encrypted.includes(keys.keySecret), false);
      assert.equal((await call('logout', 'patient', {})).status, 200);
      assert.equal((await (await call('me', 'hospital')).json()).user.id, owner.id);
    } finally {
      globals.mediqueueV2 = previousStore;
      if (previousKey === undefined) delete process.env.PAYMENT_ENCRYPTION_KEY; else process.env.PAYMENT_ENCRYPTION_KEY = previousKey;
      if (previousOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previousOrigin;
    }
    await s.logout(session);
    assert.equal(await s.session(session), null);
  } finally { await db.close(); }
});
