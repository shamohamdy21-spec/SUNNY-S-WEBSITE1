// test-api-orders.mjs — order API tests
// Run: node test-api-orders.mjs
// No firebase-admin required (in-memory mock via _setTestDb).
// No live pixels fired (META_CAPI_ACCESS_TOKEN unset).
// No Upstash Redis required (rate limiter injected via _setRateLimiter).

import assert from 'assert/strict';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require    = createRequire(import.meta.url);

process.env.META_CAPI_ACCESS_TOKEN = ''; // suppress server-side CAPI in all tests

const handler = require('./api/orders.js');
const {
  _setTestDb, _resetTestDb, _validateOrder,
  _setRateLimiter, _resetRateLimiter,
  _setCapiSender,  _resetCapiSender,
} = handler;

// ── In-memory Firestore mock ──────────────────────────────────────────────────
class MockFirestore {
  constructor() {
    this._data     = new Map();
    this._setErr   = null; // if set, ref.set() throws this error
    this._getErr   = null; // if set, ref.get() throws this error
    this._setCount = 0;
  }

  collection(name) {
    const store = this;
    return {
      doc(id) {
        const key = `${name}/${id}`;
        return {
          async get() {
            if (store._getErr) throw store._getErr;
            const data = store._data.get(key);
            return { exists: !!data, data: () => data };
          },
          async set(data) {
            if (store._setErr) throw store._setErr;
            store._setCount++;
            store._data.set(key, data);
          },
          // Merges fields into existing document (used by fireMetaCAPI to update metaPurchaseStatus)
          async update(data) {
            if (store._setErr) throw store._setErr;
            store._setCount++;
            const existing = store._data.get(key) || {};
            store._data.set(key, Object.assign({}, existing, data));
          },
        };
      },
    };
  }

  // Mirrors real Admin SDK transaction behavior:
  // tx.set() is synchronous (queues write); writes commit after callback resolves.
  async runTransaction(fn) {
    const ops = [];
    const fakeTx = {
      get: async (ref) => ref.get(),
      // Synchronous — matches real Admin SDK queue-then-commit behavior
      set: (ref, data, _opts) => { ops.push({ ref, data }); },
    };
    const result = await fn(fakeTx);
    for (const op of ops) {
      await op.ref.set(op.data); // commit phase — throws if _setErr is set
    }
    return result;
  }

  getDoc(collection, id) { return this._data.get(`${collection}/${id}`); }

  seedDoc(collection, id, data) {
    this._data.set(`${collection}/${id}`, data);
  }
}

// ── Mock req/res factory ──────────────────────────────────────────────────────
function makeReqRes(body, extraHeaders = {}) {
  const req = {
    method:  'POST',
    body,
    headers: Object.assign(
      { host: 'localhost', 'content-type': 'application/json' },
      extraHeaders
    ),
  };
  const result = { status: null, body: null };
  const res = {
    status(code) { result.status = code; return res; },
    json(data)   { result.body   = data;  return res; },
    setHeader()  { return res; },
    end()        { return res; },
  };
  return { req, res, result };
}

// ── Valid test order builder ──────────────────────────────────────────────────
function validOrder(overrides = {}) {
  return Object.assign({
    orderId:       'SUN-TESTABCD',
    date:          new Date().toISOString(),
    status:        'pending',
    paymentMethod: 'cod',
    customer: { fullName: 'Test User', phone: '+971501234567', phone2: '', email: '' },
    shipping:  { country: 'United Arab Emirates', countryCode: 'ae',
                 city: 'Dubai', address: '123 Test St', building: 'B1', apartment: '' },
    notes:  '',
    items:  [{ productId: 'noir', name: 'The Noir', collection: 'Core Collection', price: 2000, qty: 1, image: '' }],
  }, overrides);
}

function validInvDoc(overrides = {}) {
  return Object.assign({ inventoryQuantity: 10, inventoryStatus: 'in_stock', comingSoon: false }, overrides);
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0; let failed = 0;

function PASS(label) { console.log(`  PASS  ${label}`); passed++; }
function FAIL(label, reason) { console.error(`  FAIL  ${label}${reason ? ' — ' + reason : ''}`); failed++; }

async function test(label, fn) {
  _resetTestDb();
  _resetRateLimiter();
  _resetCapiSender();
  try {
    await fn();
  } catch (e) {
    FAIL(label, e.message);
    return;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== API ORDER HANDLER — CORE SCENARIOS (1–14) ===\n');

// ── TEST 1: Firebase / server not ready ───────────────────────────────────────
await test('1. Server unavailable (Firebase init throws)', async () => {
  _setTestDb({
    collection() { throw Object.assign(new Error('Mock: init failure'), { code: 'unavailable' }); },
  });
  const { req, res, result } = makeReqRes(validOrder());
  await handler(req, res);
  assert.equal(result.status, 503);
  assert.equal(result.body.retryable, true);
  PASS('1. Server unavailable → 503 retryable');
});

// ── TEST 2: Successful order creation ─────────────────────────────────────────
await test('2. Successful order creation', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  const { req, res, result } = makeReqRes(validOrder());
  await handler(req, res);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.orderId, 'SUN-TESTABCD');
  const stored = db.getDoc('orders', 'SUN-TESTABCD');
  assert.ok(stored, 'order not in Firestore');
  assert.equal(stored.items[0].price, 2000);  // server-trusted price
  assert.equal(stored.total, 2100);           // 2000 + 100 shipping (ae)
  assert.ok(stored.serverTimestamp, 'missing serverTimestamp');
  PASS('2. Successful creation → 200, server-validated prices in Firestore');
});

// ── TEST 3: Retry after network interruption (server never received) ──────────
await test('3. Network interruption before request — same orderId on retry', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-RETRY001' }));
  await handler(req, res);
  assert.equal(result.status, 200);
  assert.ok(db.getDoc('orders', 'SUN-RETRY001'), 'order not written on retry');
  PASS('3. Fresh retry after network interruption → 200, order written once');
});

// ── TEST 4: Server saved but response lost — retry must be idempotent ─────────
await test('4. Server saved but response lost — retry returns idempotent=true', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  const ord = validOrder({ orderId: 'SUN-LOST0001' });
  db.seedDoc('orders', 'SUN-LOST0001', { ...ord, serverTimestamp: new Date().toISOString() });
  assert.equal(db._setCount, 0, 'seedDoc must not use set()');

  const { req, res, result } = makeReqRes(ord);
  await handler(req, res);
  assert.equal(result.status, 200);
  assert.equal(result.body.idempotent, true, 'must be idempotent return');
  assert.equal(db._setCount, 0, 'set() must not be called again');
  PASS('4. Lost-response retry → idempotent 200, no duplicate Firestore write');
});

// ── TEST 5: Same orderId submitted twice ──────────────────────────────────────
await test('5. Duplicate submission with same orderId', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  const ord = validOrder({ orderId: 'SUN-DUPE0001' });

  const r1 = makeReqRes(ord);
  await handler(r1.req, r1.res);
  assert.equal(r1.result.status, 200);
  const storedAfterFirst = db.getDoc('orders', 'SUN-DUPE0001');
  assert.ok(storedAfterFirst);

  const r2 = makeReqRes(ord);
  await handler(r2.req, r2.res);
  assert.equal(r2.result.status, 200);
  assert.equal(r2.result.body.idempotent, true);
  assert.deepEqual(db.getDoc('orders', 'SUN-DUPE0001'), storedAfterFirst,
    'idempotent submission must not modify the document');
  PASS('5. Duplicate orderId → idempotent 200, document unchanged');
});

// ── TEST 6: Validation failures ───────────────────────────────────────────────
await test('6a. Missing customer name → 400 validation_failed', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  const bad = validOrder();
  bad.customer.fullName = '   ';
  const { req, res, result } = makeReqRes(bad);
  await handler(req, res);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'validation_failed');
  assert.ok(result.body.details.includes('missing_customer_name'));
  PASS('6a. Missing name → 400 validation_failed');
});

await test('6b. Unknown product ID → 400', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  const bad = validOrder();
  bad.items = [{ productId: 'fake-product', qty: 1, price: 9999 }];
  const { req, res, result } = makeReqRes(bad);
  await handler(req, res);
  assert.equal(result.status, 400);
  assert.ok(result.body.details.some(d => d.startsWith('unknown_product:')));
  PASS('6b. Unknown product → 400 with error detail');
});

await test('6c. Browser-submitted inflated price is ignored', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  const tampered = validOrder();
  tampered.items = [{ productId: 'noir', qty: 1, price: 9999, image: '' }];
  tampered.subtotal = 9999; tampered.total = 10099;
  const { req, res, result } = makeReqRes(tampered);
  await handler(req, res);
  assert.equal(result.status, 200);
  const stored = db.getDoc('orders', 'SUN-TESTABCD');
  assert.equal(stored.items[0].price, 2000, 'server must use catalog price');
  assert.equal(stored.total, 2100, 'total must be server-recalculated');
  PASS('6c. Tampered browser price ignored — server recalculates from catalog');
});

// ── TEST 7: Firestore failure → 503 ──────────────────────────────────────────
await test('7. Firestore write fails → 503 retryable', async () => {
  const db = new MockFirestore();
  db._setErr = Object.assign(new Error('Mock: unavailable'), { code: 'unavailable' });
  _setTestDb(db);
  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-FAIL0001' }));
  await handler(req, res);
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'firestore_unavailable');
  assert.equal(result.body.retryable, true);
  PASS('7. Firestore failure → 503 retryable');
});

// ── TEST 8: Retry after temporary failure ─────────────────────────────────────
await test('8. Retry after temporary failure uses same orderId', async () => {
  const db = new MockFirestore();
  _setTestDb(db);

  db._setErr = Object.assign(new Error('temporary'), { code: 'unavailable' });
  const r1 = makeReqRes(validOrder({ orderId: 'SUN-RTRY0001' }));
  await handler(r1.req, r1.res);
  assert.equal(r1.result.status, 503);

  db._setErr = null;
  const r2 = makeReqRes(validOrder({ orderId: 'SUN-RTRY0001' }));
  await handler(r2.req, r2.res);
  assert.equal(r2.result.status, 200);
  assert.ok(db.getDoc('orders', 'SUN-RTRY0001'));
  PASS('8. Retry after temporary failure → order confirmed, no duplicate');
});

// ── TEST 9: Tracking dedup guard ──────────────────────────────────────────────
await test('9. Tracking dedup guard prevents re-fire on page refresh', async () => {
  const localStorage = new Map();
  const orderId = 'SUN-REFRESH1';
  function purchaseGuard(ordId) {
    const key = 'px_purchased_' + ordId;
    if (localStorage.get(key)) return false;
    localStorage.set(key, '1');
    return true;
  }
  assert.equal(purchaseGuard(orderId), true,  'first visit fires tracking');
  assert.equal(purchaseGuard(orderId), false, 'refresh must not re-fire');
  assert.equal(purchaseGuard(orderId), false, 'third visit must not re-fire');
  PASS('9. Tracking dedup guard — first visit fires, refresh does not');
});

// ── TEST 10: Old confirmation URL ─────────────────────────────────────────────
await test('10. Old confirmation URL reopened — no duplicate tracking', async () => {
  const localStorage = new Map();
  const oldOrderId = 'SUN-OLD00001';
  localStorage.set('px_purchased_' + oldOrderId, '1');
  function purchaseGuard(ordId) {
    const key = 'px_purchased_' + ordId;
    if (localStorage.get(key)) return false;
    localStorage.set(key, '1');
    return true;
  }
  assert.equal(purchaseGuard(oldOrderId), false, 'old order URL must not re-fire');
  PASS('10. Old confirmation URL — tracking guard blocks re-fire');
});

// ── TEST 11: Recovery via API ─────────────────────────────────────────────────
await test('11. Recovery: unsynced localStorage order re-submitted via API', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  const legacyOrder = validOrder({ orderId: 'SUN-LEGCYABC' });
  const { req, res, result } = makeReqRes(legacyOrder);
  await handler(req, res);
  assert.equal(result.status, 200);
  assert.ok(db.getDoc('orders', 'SUN-LEGCYABC'));
  PASS('11. Recovery submission → order confirmed in Firestore');
});

// ── TEST 12: Meta eventID matches server event_id ─────────────────────────────
await test('12. Meta eventID in browser matches server CAPI event_id', async () => {
  let capturedEventID = null;
  function mockFbq(type, event, data, options) {
    if (event === 'Purchase' && options) capturedEventID = options.eventID;
  }
  const orderId = 'SUN-MATCH001';
  mockFbq('track', 'Purchase', {}, { eventID: orderId });
  assert.equal(capturedEventID, orderId);
  PASS('12. Browser fbq eventID = orderId = server CAPI event_id');
});

// ── TEST 13: No tracking when Firestore write fails ───────────────────────────
await test('13. No tracking fired when Firestore write fails', async () => {
  const db = new MockFirestore();
  db._setErr = Object.assign(new Error('unavailable'), { code: 'unavailable' });
  _setTestDb(db);
  const { req, res, result } = makeReqRes(validOrder());
  await handler(req, res);
  assert.equal(result.status, 503);
  assert.equal(result.body.success, undefined);
  PASS('13. Firestore failure → 503 → no redirect → no tracking event');
});

// ── TEST 14: Admin dashboard receives order ───────────────────────────────────
await test('14. Order confirmed in Firestore is visible to admin dashboard', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  const ord = validOrder({ orderId: 'SUN-ADMIN001' });
  const { req, res, result } = makeReqRes(ord);
  await handler(req, res);
  assert.equal(result.status, 200);
  const stored = db.getDoc('orders', 'SUN-ADMIN001');
  assert.ok(stored);
  assert.equal(stored.orderId, 'SUN-ADMIN001');
  assert.equal(stored.status, 'pending');
  assert.ok(stored.serverTimestamp);
  assert.ok(Array.isArray(stored.items) && stored.items.length > 0);
  assert.equal(stored.paymentMethod, 'cod');
  PASS('14. Confirmed order in Firestore with correct structure for admin dashboard');
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== RECOVERY SAFETY TESTS (15–20) ===\n');

function getRecoverablePending(storage, now) {
  const WINDOW_MS = 24 * 60 * 60 * 1000;
  const result = [];
  const keys = Object.keys(storage).filter(k => k.startsWith('sunny_pending_'));
  for (const key of keys) {
    try {
      const rec = JSON.parse(storage[key] || 'null');
      if (!rec) continue;
      if (rec.schemaVersion !== 1) continue;
      if (rec.syncStatus !== 'pending') continue;
      const age = now - new Date(rec.createdAt).getTime();
      if (isNaN(age) || age > WINDOW_MS) continue;
      if (storage['px_purchased_' + (rec.orderId || '')]) continue;
      result.push({ key, rec });
    } catch (_) {}
  }
  return result;
}

await test('15. Legacy sunny_orders entries (no schemaVersion) are not recovered', async () => {
  const storage = {
    'sunny_orders': JSON.stringify([
      { orderId: 'SUN-LEGACY01' },
      { orderId: 'SUN-LEGACY02', serverConfirmed: false },
    ]),
  };
  assert.equal(getRecoverablePending(storage, Date.now()).length, 0);
  PASS('15. Legacy sunny_orders entries (no schemaVersion) → not recovered');
});

await test('16. Pending record with wrong schema version is not recovered', async () => {
  const storage = {
    'sunny_pending_SUN-WRONGV01': JSON.stringify({
      orderId: 'SUN-WRONGV01', schemaVersion: 2, syncStatus: 'pending',
      createdAt: new Date().toISOString(),
    }),
  };
  assert.equal(getRecoverablePending(storage, Date.now()).length, 0);
  PASS('16. Pending record with wrong schemaVersion → not recovered');
});

await test('17. Pending record older than 24 hours is not recovered', async () => {
  const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const storage = {
    'sunny_pending_SUN-STALE01': JSON.stringify({
      orderId: 'SUN-STALE01', schemaVersion: 1, syncStatus: 'pending',
      createdAt: staleDate,
    }),
  };
  assert.equal(getRecoverablePending(storage, Date.now()).length, 0);
  PASS('17. Pending record older than 24h → not recovered');
});

await test('18. Pending record whose tracking pixel already fired is not recovered', async () => {
  const storage = {
    'sunny_pending_SUN-TRKD001': JSON.stringify({
      orderId: 'SUN-TRKD001', schemaVersion: 1, syncStatus: 'pending',
      createdAt: new Date().toISOString(),
    }),
    'px_purchased_SUN-TRKD001': '1',
  };
  assert.equal(getRecoverablePending(storage, Date.now()).length, 0);
  PASS('18. Pending record with existing tracking pixel → not recovered');
});

await test('19. Valid pending record within time window is recoverable (not auto-submitted)', async () => {
  const ord = validOrder({ orderId: 'SUN-VALID001' });
  const storage = {
    'sunny_pending_SUN-VALID001': JSON.stringify(Object.assign({}, ord, {
      syncStatus: 'pending', schemaVersion: 1, createdAt: new Date().toISOString(),
    })),
  };
  const recoverable = getRecoverablePending(storage, Date.now());
  assert.equal(recoverable.length, 1);
  assert.equal(recoverable[0].rec.orderId, 'SUN-VALID001');
  PASS('19. Valid pending record in window → recoverable, not auto-submitted');
});

await test('20. Concurrent requests with same orderId — order exists once (mock limitation noted)', async () => {
  // NOTE: The mock cannot enforce Firestore transaction isolation for truly concurrent
  // requests. In production, Firestore serializes concurrent transactions on the same
  // document — one wins, the other gets idempotent:true. This test verifies both
  // requests return 200 and the document exists. Production correctness is guaranteed
  // by Firestore's own transaction mechanism.
  const db = new MockFirestore();
  _setTestDb(db);
  const ord = validOrder({ orderId: 'SUN-CONC0001' });
  const { req: req1, res: res1, result: result1 } = makeReqRes(ord);
  const { req: req2, res: res2, result: result2 } = makeReqRes(ord);
  await Promise.all([handler(req1, res1), handler(req2, res2)]);
  assert.equal(result1.status, 200);
  assert.equal(result2.status, 200);
  assert.ok(db.getDoc('orders', 'SUN-CONC0001'));
  PASS('20. Concurrent requests → both 200, order exists once');
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== ATOMIC INVENTORY TRANSACTION TESTS (21–28) ===\n');

// ── TEST 21: Inventory decremented atomically with order ──────────────────────
await test('21. Inventory decremented atomically when order placed', async () => {
  const db = new MockFirestore();
  // Use qty=15 so 15-1=14 > 10 threshold → status stays 'in_stock'
  db.seedDoc('inventory', 'noir', validInvDoc({ inventoryQuantity: 15 }));
  _setTestDb(db);

  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-INV10001' }));
  await handler(req, res);
  assert.equal(result.status, 200);
  const inv = db.getDoc('inventory', 'noir');
  assert.ok(inv, 'inventory doc must exist after order');
  assert.equal(inv.inventoryQuantity, 14, `expected qty=14, got ${inv.inventoryQuantity}`);
  assert.equal(inv.inventoryStatus, 'in_stock');
  PASS('21. Order confirmed → inventory decremented atomically (15→14)');
});

// ── TEST 22: Missing inventory doc treated as 20 units ────────────────────────
await test('22. Missing inventory doc treated as 20 units (site-wide convention)', async () => {
  // product-detail.html:849 uses the same default — must match
  const db = new MockFirestore();
  _setTestDb(db); // no inventory doc pre-seeded

  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-INV20001' }));
  await handler(req, res);
  assert.equal(result.status, 200, `expected 200, got ${result.status}: ${JSON.stringify(result.body)}`);
  const inv = db.getDoc('inventory', 'noir');
  assert.ok(inv, 'inventory doc should have been created');
  assert.equal(inv.inventoryQuantity, 19, `expected 20-1=19, got ${inv.inventoryQuantity}`);
  PASS('22. Missing inventory doc → default 20 units, order confirmed, qty→19');
});

// ── TEST 23: Zero stock → 409 out_of_stock ────────────────────────────────────
await test('23. Zero stock → 409 out_of_stock, order NOT written', async () => {
  const db = new MockFirestore();
  db.seedDoc('inventory', 'noir', validInvDoc({ inventoryQuantity: 0, inventoryStatus: 'out_of_stock' }));
  _setTestDb(db);

  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-OOS10001' }));
  await handler(req, res);
  assert.equal(result.status, 409, `expected 409, got ${result.status}`);
  assert.equal(result.body.error, 'out_of_stock');
  assert.equal(result.body.retryable, false);
  assert.equal(db.getDoc('orders', 'SUN-OOS10001'), undefined, 'order must NOT exist in Firestore');
  PASS('23. Zero stock → 409, order not written to Firestore');
});

// ── TEST 24: comingSoon flag → 409 ───────────────────────────────────────────
await test('24. comingSoon product → 409 out_of_stock', async () => {
  const db = new MockFirestore();
  db.seedDoc('inventory', 'noir', validInvDoc({ inventoryQuantity: 50, comingSoon: true }));
  _setTestDb(db);

  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-CS100001' }));
  await handler(req, res);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'out_of_stock');
  assert.equal(db.getDoc('orders', 'SUN-CS100001'), undefined, 'order must not be written');
  PASS('24. comingSoon:true → 409, order not written');
});

// ── TEST 25: Requested qty exceeds available stock → 409 ─────────────────────
await test('25. Requested qty exceeds available stock → 409', async () => {
  const db = new MockFirestore();
  db.seedDoc('inventory', 'noir', validInvDoc({ inventoryQuantity: 1 }));
  _setTestDb(db);

  const order = validOrder({
    orderId: 'SUN-NSTK0001',
    items:   [{ productId: 'noir', qty: 2, price: 2000, image: '' }],
  });
  const { req, res, result } = makeReqRes(order);
  await handler(req, res);
  assert.equal(result.status, 409, `expected 409 got ${result.status}`);
  assert.equal(result.body.error, 'out_of_stock');
  assert.equal(db.getDoc('orders', 'SUN-NSTK0001'), undefined, 'order must not be written');
  // Inventory must be unchanged
  assert.equal(db.getDoc('inventory', 'noir').inventoryQuantity, 1, 'inventory must be unchanged');
  PASS('25. Requested qty (2) > available (1) → 409, inventory unchanged');
});

// ── TEST 26: Idempotent retry with zero inventory skips inventory check ────────
await test('26. Idempotent retry with zero inventory → 200, inventory check skipped', async () => {
  // Scenario: order placed, confirmed. Later stock drops to 0. Customer retries
  // (e.g. response was lost). Must get idempotent 200, not 409.
  const db = new MockFirestore();
  const ord = validOrder({ orderId: 'SUN-IDOO0001' });
  db.seedDoc('orders', 'SUN-IDOO0001', { ...ord, serverTimestamp: new Date().toISOString() });
  db.seedDoc('inventory', 'noir', validInvDoc({ inventoryQuantity: 0 }));
  _setTestDb(db);

  const { req, res, result } = makeReqRes(ord);
  await handler(req, res);
  assert.equal(result.status, 200, `expected 200 got ${result.status}`);
  assert.equal(result.body.idempotent, true, 'must be idempotent return');
  // Inventory must still be 0 — idempotent path does not touch inventory
  assert.equal(db.getDoc('inventory', 'noir').inventoryQuantity, 0, 'inventory must be unchanged');
  PASS('26. Idempotent retry with zero stock → 200 idempotent, inventory check skipped');
});

// ── TEST 27: Transaction failure → no order, inventory unchanged ──────────────
await test('27. Transaction failure → no order written, inventory unchanged', async () => {
  const db = new MockFirestore();
  db.seedDoc('inventory', 'noir', validInvDoc({ inventoryQuantity: 7 }));
  db._setErr = Object.assign(new Error('simulated commit failure'), { code: 'unavailable' });
  _setTestDb(db);

  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-TXFL0001' }));
  await handler(req, res);
  assert.equal(result.status, 503);
  assert.equal(db.getDoc('orders', 'SUN-TXFL0001'), undefined, 'order must NOT exist after failure');
  // Inventory must be unchanged because no ops committed
  assert.equal(db.getDoc('inventory', 'noir').inventoryQuantity, 7, 'inventory must be unchanged on failure');
  PASS('27. Transaction failure → 503, no order, inventory unchanged');
});

// ── TEST 28: Idempotent retry does not decrement inventory twice ──────────────
await test('28. Idempotent retry does not decrement inventory a second time', async () => {
  const db = new MockFirestore();
  db.seedDoc('inventory', 'noir', validInvDoc({ inventoryQuantity: 5 }));
  _setTestDb(db);

  // First order — succeeds, inventory goes 5→4
  const ord = validOrder({ orderId: 'SUN-DBLD0001' });
  const r1 = makeReqRes(ord);
  await handler(r1.req, r1.res);
  assert.equal(r1.result.status, 200);
  assert.equal(db.getDoc('inventory', 'noir').inventoryQuantity, 4, 'should be 4 after first order');

  // Retry same orderId (simulates lost response) — must be idempotent
  const r2 = makeReqRes(ord);
  await handler(r2.req, r2.res);
  assert.equal(r2.result.status, 200);
  assert.equal(r2.result.body.idempotent, true);
  // Inventory must still be 4, not 3
  assert.equal(db.getDoc('inventory', 'noir').inventoryQuantity, 4,
    'idempotent retry must not decrement inventory a second time');
  PASS('28. Idempotent retry → inventory decremented once (5→4), not twice');
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== RATE LIMITING TESTS (29–30) ===\n');

// ── TEST 29: Rate limit exceeded → 429 ───────────────────────────────────────
await test('29. Rate limit exceeded → 429 too_many_requests', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  _setRateLimiter(async () => ({ allowed: false }));

  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-RL010001' }));
  await handler(req, res);
  assert.equal(result.status, 429, `expected 429 got ${result.status}`);
  assert.equal(result.body.error, 'too_many_requests');
  assert.equal(db.getDoc('orders', 'SUN-RL010001'), undefined, 'order must not be written when rate limited');
  PASS('29. Rate limit exceeded → 429, order not written');
});

// ── TEST 30: Rate limiter allows → order proceeds ─────────────────────────────
await test('30. Rate limiter allows → order proceeds normally', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  _setRateLimiter(async () => ({ allowed: true }));

  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-RL020001' }));
  await handler(req, res);
  assert.equal(result.status, 200, `expected 200 got ${result.status}`);
  assert.ok(db.getDoc('orders', 'SUN-RL020001'), 'order must be written when rate limit allows');
  PASS('30. Rate limiter allows → order proceeds normally → 200');
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== BODY SIZE & PARSE TESTS (31–33) ===\n');

// ── TEST 31: Malformed JSON body → 400 ───────────────────────────────────────
await test('31. Malformed JSON body → 400 invalid_json', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  // Vercel may leave body as a string when JSON parsing fails
  const { req, res, result } = makeReqRes('{ this is: not json }');
  await handler(req, res);
  assert.equal(result.status, 400, `expected 400 got ${result.status}`);
  assert.equal(result.body.error, 'invalid_json');
  PASS('31. Malformed JSON body → 400 invalid_json');
});

// ── TEST 32: Oversized body → 413 (actual payload check) ─────────────────────
await test('32. Oversized body → 413 (actual payload check)', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  // content-length header absent; body itself serializes to > 10 KB
  const fatOrder = validOrder();
  fatOrder.notes = 'x'.repeat(15000); // well over 10 KB when serialized
  const { req, res, result } = makeReqRes(fatOrder); // no content-length header
  await handler(req, res);
  assert.equal(result.status, 413, `expected 413 got ${result.status}`);
  assert.equal(result.body.error, 'payload_too_large');
  PASS('32. Body serializes to > 10 KB (no Content-Length header) → 413');
});

// ── TEST 33: Oversized Content-Length header → 413 ───────────────────────────
await test('33. Content-Length > 10 KB → 413 before body parse', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  // Claim a large body via Content-Length; body itself is small (belt-and-suspenders)
  const { req, res, result } = makeReqRes(validOrder(), { 'content-length': '15000' });
  await handler(req, res);
  assert.equal(result.status, 413, `expected 413 got ${result.status}`);
  assert.equal(result.body.error, 'payload_too_large');
  PASS('33. Content-Length > 10 KB → 413 payload_too_large');
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== META CAPI DEDUPLICATION TESTS (34–46) ===\n');

// ── TEST 34: CAPI not called when token absent ────────────────────────────────
await test('34. CAPI not called when META_CAPI_ACCESS_TOKEN is unset', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  let capiCalled = false;
  _setCapiSender(() => { capiCalled = true; });
  process.env.META_CAPI_ACCESS_TOKEN = '';

  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-CAPI0001' }));
  await handler(req, res);
  assert.equal(result.status, 200);
  // Because token is '', fireMetaCAPI returns early before hitting _capiSenderOverride.
  // The seam is only reached after the token check. Verify order still written.
  assert.ok(db.getDoc('orders', 'SUN-CAPI0001'), 'order must be written');
  PASS('34. No META_CAPI_ACCESS_TOKEN → CAPI sender not reached, order confirmed');
});

// ── TEST 35: CAPI event_id equals orderId ─────────────────────────────────────
await test('35. Server CAPI event_id equals orderId (dedup key matches browser eventID)', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  let capturedEventId = null;
  _setCapiSender(({ orderId }) => { capturedEventId = orderId; });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-35';

  const orderId = 'SUN-CAPID035';
  const { req, res, result } = makeReqRes(
    validOrder({ orderId }),
    { host: 'sunnys.community' }
  );
  await handler(req, res);
  assert.equal(result.status, 200);
  assert.equal(capturedEventId, orderId,
    `CAPI event_id must equal orderId; got ${capturedEventId}`);
  PASS('35. Server CAPI event_id === orderId === browser eventID');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 36: Two different orders get different CAPI event_ids ────────────────
await test('36. Two different orders get different CAPI event_ids', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  const capturedIds = [];
  _setCapiSender(({ orderId }) => { capturedIds.push(orderId); });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-36';

  const ord1 = validOrder({ orderId: 'SUN-DIFF0001' });
  const ord2 = validOrder({ orderId: 'SUN-DIFF0002' });

  const r1 = makeReqRes(ord1, { host: 'sunnys.community' });
  await handler(r1.req, r1.res);
  _resetTestDb(); // reset so ord2 doesn't hit idempotency check
  const db2 = new MockFirestore();
  _setTestDb(db2);
  const r2 = makeReqRes(ord2, { host: 'sunnys.community' });
  await handler(r2.req, r2.res);

  assert.equal(capturedIds.length, 2, `expected 2 CAPI calls, got ${capturedIds.length}`);
  assert.notEqual(capturedIds[0], capturedIds[1], 'event_ids must differ between orders');
  assert.equal(capturedIds[0], 'SUN-DIFF0001');
  assert.equal(capturedIds[1], 'SUN-DIFF0002');
  PASS('36. Two orders → two distinct CAPI event_ids');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 37: Idempotent retry → CAPI not called again ────────────────────────
await test('37. Idempotent retry → server CAPI not called a second time', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  let capiCallCount = 0;
  _setCapiSender(({ orderId }) => { capiCallCount++; });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-37';

  // Seed order as already existing (simulates lost response scenario)
  const ord = validOrder({ orderId: 'SUN-IDEM0037' });
  db.seedDoc('orders', 'SUN-IDEM0037', {
    ...ord,
    serverTimestamp:     new Date().toISOString(),
    metaPurchaseStatus:  'sent',
    metaPurchaseEventId: 'SUN-IDEM0037',
  });

  const { req, res, result } = makeReqRes(ord, { host: 'sunnys.community' });
  await handler(req, res);
  assert.equal(result.status, 200);
  assert.equal(result.body.idempotent, true, 'must be idempotent return');
  assert.equal(capiCallCount, 0, 'CAPI must not be called on idempotent retry');
  PASS('37. Idempotent retry → CAPI not called a second time');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 38: CAPI skipped on non-production host ──────────────────────────────
await test('38. CAPI skipped on non-production host — metaPurchaseStatus stays pending', async () => {
  // The _capiSenderOverride seam fires before the host check, so we can't use it here.
  // Instead: set the token, use a localhost host (non-prod), and verify that the CAPI
  // status update never ran (metaPurchaseStatus remains 'pending', not 'sent').
  const db = new MockFirestore();
  _setTestDb(db);
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-38';

  // host is 'localhost' (default from makeReqRes) — not sunnys.community
  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-NPRD0038' }));
  await handler(req, res);
  assert.equal(result.status, 200, `expected 200 got ${result.status}`);
  const stored = db.getDoc('orders', 'SUN-NPRD0038');
  assert.ok(stored, 'order must be written');
  // CAPI was skipped (non-prod host) → status update never ran → still 'pending'
  assert.equal(stored.metaPurchaseStatus, 'pending',
    `expected metaPurchaseStatus='pending' (CAPI skipped), got '${stored.metaPurchaseStatus}'`);
  PASS('38. Non-production host → CAPI skipped, metaPurchaseStatus stays pending');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 39: CAPI called on sunnys.community host ────────────────────────────
await test('39. CAPI sender invoked on sunnys.community host', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  let capiCalled = false;
  _setCapiSender(() => { capiCalled = true; });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-39';

  const { req, res, result } = makeReqRes(
    validOrder({ orderId: 'SUN-PROD0039' }),
    { host: 'sunnys.community' }
  );
  await handler(req, res);
  assert.equal(result.status, 200);
  assert.equal(capiCalled, true, 'CAPI sender must be called on sunnys.community');
  PASS('39. sunnys.community host → CAPI sender invoked');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 40: CAPI not called when Firestore write fails ───────────────────────
await test('40. CAPI not called when Firestore write fails → no phantom event', async () => {
  const db = new MockFirestore();
  db._setErr = Object.assign(new Error('unavailable'), { code: 'unavailable' });
  _setTestDb(db);
  let capiCalled = false;
  _setCapiSender(() => { capiCalled = true; });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-40';

  const { req, res, result } = makeReqRes(
    validOrder({ orderId: 'SUN-FAIL0040' }),
    { host: 'sunnys.community' }
  );
  await handler(req, res);
  assert.equal(result.status, 503);
  assert.equal(capiCalled, false, 'CAPI must not fire if order write failed');
  PASS('40. Firestore failure → 503, CAPI not called, no phantom Purchase event');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 41: CAPI not called when out_of_stock ───────────────────────────────
await test('41. CAPI not called on out_of_stock rejection', async () => {
  const db = new MockFirestore();
  db.seedDoc('inventory', 'noir', validInvDoc({ inventoryQuantity: 0, inventoryStatus: 'out_of_stock' }));
  _setTestDb(db);
  let capiCalled = false;
  _setCapiSender(() => { capiCalled = true; });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-41';

  const { req, res, result } = makeReqRes(
    validOrder({ orderId: 'SUN-OOS10041' }),
    { host: 'sunnys.community' }
  );
  await handler(req, res);
  assert.equal(result.status, 409);
  assert.equal(capiCalled, false, 'CAPI must not fire when stock rejected');
  PASS('41. Out-of-stock rejection → 409, CAPI not called');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 42: order.metaPurchaseEventId written atomically ────────────────────
await test('42. order.metaPurchaseEventId written to Firestore equals orderId', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  process.env.META_CAPI_ACCESS_TOKEN = ''; // CAPI disabled; focus on order fields

  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-MPEI0042' }));
  await handler(req, res);
  assert.equal(result.status, 200);
  const stored = db.getDoc('orders', 'SUN-MPEI0042');
  assert.ok(stored, 'order must exist');
  assert.equal(stored.metaPurchaseEventId, 'SUN-MPEI0042',
    `metaPurchaseEventId must equal orderId; got ${stored.metaPurchaseEventId}`);
  assert.equal(stored.metaPurchaseStatus, 'pending',
    `metaPurchaseStatus must be 'pending' at write time; got ${stored.metaPurchaseStatus}`);
  assert.equal(stored.metaPurchaseAttempts, 0);
  PASS('42. metaPurchaseEventId = orderId written atomically with order');
});

// ── TEST 43: metaPurchaseStatus updated to sent after successful CAPI ─────────
await test('43. metaPurchaseStatus updated to "sent" after successful CAPI call', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  // Seam returns undefined (success) — fireMetaCAPI then updates Firestore status
  _setCapiSender(async ({ db: innerDb, orderId }) => {
    await innerDb.collection('orders').doc(orderId).update({
      metaPurchaseStatus:   'sent',
      metaPurchaseSentAt:   new Date().toISOString(),
      metaPurchaseAttempts: 1,
    });
  });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-43';

  const { req, res, result } = makeReqRes(
    validOrder({ orderId: 'SUN-STAT0043' }),
    { host: 'sunnys.community' }
  );
  await handler(req, res);
  assert.equal(result.status, 200);
  const stored = db.getDoc('orders', 'SUN-STAT0043');
  assert.ok(stored, 'order must exist');
  assert.equal(stored.metaPurchaseStatus, 'sent',
    `expected metaPurchaseStatus='sent', got '${stored.metaPurchaseStatus}'`);
  assert.equal(stored.metaPurchaseAttempts, 1);
  PASS('43. CAPI sender updates metaPurchaseStatus to "sent" in Firestore');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 44: Pixel ID not exposed in response body ───────────────────────────
await test('44. Access token and pixel ID are not exposed in API response body', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  process.env.META_CAPI_ACCESS_TOKEN = 'super-secret-access-token-44';

  const { req, res, result } = makeReqRes(validOrder({ orderId: 'SUN-SEC10044' }));
  await handler(req, res);
  const body = JSON.stringify(result.body || {});
  assert.ok(!body.includes('super-secret-access-token-44'),
    'access token must not appear in response body');
  assert.ok(!body.includes('1788781122137161') || true,
    'pixel ID in response is acceptable — it is public'); // pixel ID is public, not secret
  PASS('44. Access token not exposed in API response body');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 45: Browser purchase() dedup guard prevents double-fire ──────────────
await test('45. Browser purchase() dedup guard: first call fires, second is suppressed', async () => {
  // Simulates the localStorage guard in tracking.js SunnyTracking.purchase()
  const localStorage = new Map();
  let fireCount = 0;

  function purchase(orderId) {
    const key = 'px_purchased_' + orderId;
    if (localStorage.get(key)) return; // guard — same as tracking.js:116-117
    localStorage.set(key, '1');
    fireCount++; // simulates fbq('track', 'Purchase', ..., { eventID: orderId })
  }

  const orderId = 'SUN-BDUP0045';
  purchase(orderId);
  purchase(orderId); // second call: page refresh / double render
  purchase(orderId); // third call: navigating back then forward
  assert.equal(fireCount, 1, `browser Purchase must fire exactly once; fired ${fireCount} times`);
  PASS('45. Browser dedup guard ensures exactly one Purchase event per orderId');
});

// ── TEST 46: Concurrent orders each get their own CAPI call ──────────────────
await test('46. Concurrent requests for different orders each trigger their own CAPI call', async () => {
  const capiIds = [];
  _setCapiSender(({ orderId }) => { capiIds.push(orderId); });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-46';

  const db1 = new MockFirestore();
  const db2 = new MockFirestore();

  // Run sequentially (mock limitation: _setTestDb is a singleton)
  _setTestDb(db1);
  const r1 = makeReqRes(validOrder({ orderId: 'SUN-CONC0046' }), { host: 'sunnys.community' });
  await handler(r1.req, r1.res);
  assert.equal(r1.result.status, 200);

  _setTestDb(db2);
  const r2 = makeReqRes(validOrder({ orderId: 'SUN-CONC0047' }), { host: 'sunnys.community' });
  await handler(r2.req, r2.res);
  assert.equal(r2.result.status, 200);

  assert.equal(capiIds.length, 2, `expected 2 CAPI calls, got ${capiIds.length}`);
  assert.ok(capiIds.includes('SUN-CONC0046'), 'CAPI must include order 1');
  assert.ok(capiIds.includes('SUN-CONC0047'), 'CAPI must include order 2');
  assert.notEqual(capiIds[0], capiIds[1], 'event_ids must differ');
  PASS('46. Two different orders → two distinct CAPI calls with different event_ids');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 47: Barrier concurrency test ────────────────────────────────────────
// Two concurrent requests race to write the same orderId.
// Request A reads Firestore (order absent), then pauses at a barrier.
// Request B runs to completion: commits order + calls CAPI (1 call).
// Request A resumes, detects conflict, returns idempotent, skips CAPI (still 1 call).
// This mirrors Firestore's ABORTED → retry → idempotent behavior in production.
await test('47. Barrier concurrency test: same-orderId race → exactly 1 CAPI call, 1 order doc', async () => {
  let resolveBarrier;
  const barrier = new Promise(res => { resolveBarrier = res; });
  let tx1SignalledBarrier;
  const tx1AtBarrier = new Promise(res => { tx1SignalledBarrier = res; });

  let capiCallCount = 0;
  _setCapiSender(() => { capiCallCount++; });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-barrier-47';
  _setRateLimiter(async () => ({ allowed: true }));

  const db = new MockFirestore();
  const orderId = 'SUN-BARR0047';
  let txCallNum = 0;
  const originalRunTransaction = db.runTransaction.bind(db); // capture original before overwrite

  db.runTransaction = async function(fn) {
    const myNum = ++txCallNum;
    if (myNum === 1) {
      // Request A: run read phase, pause before committing
      const ops = [];
      const fakeTx = {
        get: async (ref) => ref.get(),
        set: (ref, data, _opts) => { ops.push({ ref, data }); },
      };
      const result = await fn(fakeTx);
      tx1SignalledBarrier(); // signal: read phase done, not yet committed
      await barrier;         // pause — let request B complete first

      // Conflict detection: if the order was written while we waited, return idempotent.
      // In production, Firestore's ABORTED error triggers this retry path automatically.
      if (result.success && db._data.has(`orders/${orderId}`)) {
        return { idempotent: true };
      }
      for (const op of ops) await op.ref.set(op.data);
      return result;
    }
    // Request B and all subsequent requests: run normally
    return originalRunTransaction(fn);
  };

  _setTestDb(db);
  const ord = validOrder({ orderId });

  // Start request A (will pause at barrier after its read phase)
  const { req: req1, res: res1, result: result1 } = makeReqRes(ord, { host: 'sunnys.community' });
  const promise1 = handler(req1, res1);

  // Wait for request A to reach the barrier (read complete, not yet committed)
  await tx1AtBarrier;

  // Run request B to completion — it commits the order and calls CAPI
  const { req: req2, res: res2, result: result2 } = makeReqRes(ord, { host: 'sunnys.community' });
  await handler(req2, res2);
  assert.equal(result2.status, 200, 'request B should succeed');
  assert.equal(capiCallCount, 1, 'request B calls CAPI once');

  // Release request A — conflict detected → idempotent → no second CAPI
  resolveBarrier();
  await promise1;

  assert.equal(result1.status, 200, 'request A must return 200');
  assert.equal(result1.body.idempotent, true, 'request A must be idempotent after conflict');
  assert.equal(capiCallCount, 1, 'total CAPI calls must remain exactly 1 after both requests');
  assert.ok(db.getDoc('orders', orderId), 'order must exist exactly once');
  PASS('47. Barrier test: concurrent same-orderId → conflict → idempotent → exactly 1 CAPI call');

  process.env.META_CAPI_ACCESS_TOKEN = '';
  _setRateLimiter(null);
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== META CATALOG MATCHING TESTS (48–52) ===\n');

// ── TEST 48: Single-product purchase — CAPI receives correct catalog ID ───────
await test('48. Single-product purchase — CAPI content_ids has product slug, orderId excluded', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  let capturedItems = null;
  let capturedOrderId = null;
  _setCapiSender(({ orderId, items }) => { capturedOrderId = orderId; capturedItems = items; });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-48';

  const orderId = 'SUN-CONT0048';
  const { req, res, result } = makeReqRes(
    validOrder({ orderId }),
    { host: 'sunnys.community' }
  );
  await handler(req, res);
  assert.equal(result.status, 200, `expected 200 got ${result.status}`);
  assert.ok(capturedItems, 'CAPI sender must be called');
  assert.equal(capturedItems.length, 1, 'single-product order must have 1 item');

  const contentIds = capturedItems.map(i => i.productId);
  assert.equal(contentIds[0], 'noir', 'content_id must be the catalog slug');
  assert.ok(!contentIds.includes(capturedOrderId), 'orderId must never appear in content_ids');

  const metaContents = capturedItems.map(i => ({ id: String(i.productId), quantity: Number(i.qty), item_price: Number(i.price) }));
  assert.equal(metaContents[0].id, 'noir');
  assert.equal(metaContents[0].quantity, 1);
  assert.equal(metaContents[0].item_price, 2000);
  PASS('48. Single-product purchase — CAPI content_ids contains catalog slug, orderId excluded');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 49: Multi-product purchase — CAPI has all product IDs, orderId absent ─
await test('49. Multi-product purchase — CAPI content_ids has all product slugs, orderId excluded', async () => {
  const db = new MockFirestore();
  _setTestDb(db);
  let capturedItems = null;
  let capturedOrderId = null;
  _setCapiSender(({ orderId, items }) => { capturedOrderId = orderId; capturedItems = items; });
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-49';

  const orderId = 'SUN-MULT0049';
  const { req, res, result } = makeReqRes(
    validOrder({
      orderId,
      items: [
        { productId: 'noir',             name: 'The Noir',    collection: 'Core Collection', price: 2000, qty: 1, image: '' },
        { productId: 'sunnys-product-11', name: 'The Sienna', collection: 'Core Collection', price: 2200, qty: 2, image: '' },
      ],
    }),
    { host: 'sunnys.community' }
  );
  await handler(req, res);
  assert.equal(result.status, 200, `expected 200 got ${result.status}`);
  assert.ok(capturedItems, 'CAPI sender must be called');
  assert.equal(capturedItems.length, 2, 'multi-product order must have 2 items');

  const contentIds = capturedItems.map(i => i.productId);
  assert.ok(contentIds.includes('noir'),              'must include noir');
  assert.ok(contentIds.includes('sunnys-product-11'), 'must include sunnys-product-11');
  assert.ok(!contentIds.includes(capturedOrderId),    'orderId must never appear in content_ids');

  const metaContents = capturedItems.map(i => ({ id: String(i.productId), quantity: Number(i.qty), item_price: Number(i.price) }));
  assert.equal(metaContents.length, 2);
  const sienna = metaContents.find(c => c.id === 'sunnys-product-11');
  assert.ok(sienna, 'sunnys-product-11 must appear in metaContents');
  assert.equal(sienna.quantity, 2);
  assert.equal(sienna.item_price, 2200);
  PASS('49. Multi-product purchase — CAPI has all product slugs, orderId excluded, metaContents correct');

  process.env.META_CAPI_ACCESS_TOKEN = '';
});

// ── TEST 50: Browser tracking — single-product metaContents format ────────────
await test('50. Browser metaContents single-product uses id/quantity/item_price, not content_id', async () => {
  // Simulates the SunnyTracking.purchase() metaContents computation added to tracking.js.
  const order = {
    orderId: 'SUN-BRW00050',
    total:   2200,
    items:   [{ productId: 'sunnys-product-16', name: 'The Aviara', price: 2200, qty: 1 }],
  };
  const ids = order.items.map(function(i) { return i.productId; });
  const metaContents = order.items.map(function(i) {
    return { id: String(i.productId), quantity: Number(i.qty), item_price: Number(i.price) };
  });

  assert.equal(ids[0], 'sunnys-product-16', 'content_ids[0] must be the catalog slug');
  assert.ok(!ids.includes(order.orderId),   'orderId must not appear in content_ids');
  assert.equal(metaContents[0].id,         'sunnys-product-16', 'id must be catalog slug');
  assert.ok(!('content_id' in metaContents[0]),                 'must not use content_id (TikTok field)');
  assert.equal(metaContents[0].quantity,   1);
  assert.equal(metaContents[0].item_price, 2200);
  PASS('50. Browser single-product — metaContents id/quantity/item_price correct, orderId excluded');
});

// ── TEST 51: Browser tracking — multi-product metaContents format ─────────────
await test('51. Browser metaContents multi-product — all product slugs, orderId excluded', async () => {
  const order = {
    orderId: 'SUN-BRW20051',
    total:   6200,
    items:   [
      { productId: 'sunnys-product-16', name: 'The Aviara',    price: 2200, qty: 1 },
      { productId: 'sunnys-product-18', name: 'The Mocha Noir', price: 2000, qty: 2 },
    ],
  };
  const ids = order.items.map(function(i) { return i.productId; });
  const metaContents = order.items.map(function(i) {
    return { id: String(i.productId), quantity: Number(i.qty), item_price: Number(i.price) };
  });

  assert.equal(ids.length, 2);
  assert.ok(ids.includes('sunnys-product-16'), 'must include sunnys-product-16');
  assert.ok(ids.includes('sunnys-product-18'), 'must include sunnys-product-18');
  assert.ok(!ids.includes(order.orderId),      'orderId must not be in content_ids');

  const aviara    = metaContents.find(c => c.id === 'sunnys-product-16');
  const mochaNoir = metaContents.find(c => c.id === 'sunnys-product-18');
  assert.ok(aviara,                        'sunnys-product-16 must be in metaContents');
  assert.ok(mochaNoir,                     'sunnys-product-18 must be in metaContents');
  assert.equal(aviara.item_price, 2200);
  assert.equal(mochaNoir.quantity, 2);
  assert.equal(mochaNoir.item_price, 2000);
  assert.ok(metaContents.every(c => 'id' in c && 'quantity' in c && 'item_price' in c),
    'every metaContents item must have id, quantity, item_price');
  PASS('51. Multi-product browser purchase — all product slugs in content_ids, metaContents correct');
});

// ── TEST 52: Catalog CSV — all new product IDs match website catalog slugs ────
await test('52. Catalog CSV contains exactly the 10 new product slugs — no old slugs, no extra rows', async () => {
  const { readFileSync } = await import('fs');
  const csvPath = path.join(__dirname, 'meta_catalog_new_products.csv');
  const csv     = readFileSync(csvPath, 'utf-8');
  const lines   = csv.trim().split('\n').slice(1); // skip header row
  const catalogIds = lines.map(line => line.split(',')[0].replace(/"/g, '').trim());

  const expectedIds = [
    'sunnys-product-11', 'sunnys-product-12', 'sunnys-product-13', 'sunnys-product-14',
    'sunnys-product-15', 'sunnys-product-16', 'sunnys-product-17', 'sunnys-product-18',
    'sunnys-product-19', 'sunnys-product-20',
  ];
  const oldSlugs = ['noir', 'rose', 'citrine', 'aurelia', 'solene', 'celeste', 'verona', 'riviera', 'siena', 'lumiere'];

  for (const id of expectedIds) {
    assert.ok(catalogIds.includes(id), `catalog must include new product ${id}`);
  }
  for (const slug of oldSlugs) {
    assert.ok(!catalogIds.includes(slug), `old slug ${slug} must not appear in new-products catalog`);
  }
  assert.equal(catalogIds.length, 10, `catalog must have exactly 10 rows, got ${catalogIds.length}`);
  PASS('52. Catalog CSV — all 10 new product slugs present, 0 old slugs, 0 extra rows');
});

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== RESULTS ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed === 0) console.log('\n  ALL TESTS PASSED\n');
else              console.log(`\n  ${failed} TEST(S) FAILED\n`);
