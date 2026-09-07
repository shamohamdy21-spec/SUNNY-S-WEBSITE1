'use strict';
// Vercel Serverless Function — POST /api/orders
// Node 22 runtime (see package.json engines + module.exports.config below).
//
// ── DEPLOYMENT BLOCKERS ──────────────────────────────────────────────────────
// 1. RATE LIMITING: Requires Upstash Redis. Set UPSTASH_REDIS_REST_URL and
//    UPSTASH_REDIS_REST_TOKEN in Vercel env vars (see checkRateLimit() below).
//    Without these, all rate-limit checks pass — the endpoint is unprotected.
//
// 2. FIREBASE: Requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
//    FIREBASE_PRIVATE_KEY in Vercel env vars.
//
// ── DESIGN NOTES ─────────────────────────────────────────────────────────────
// Orders are written atomically with inventory decrements in a single Firestore
// transaction. The transaction:
//   (a) checks idempotency (orderId already exists → return without writing);
//   (b) reads all inventory documents;
//   (c) verifies sufficient stock for each item;
//   (d) creates the order document once;
//   (e) decrements inventory for each item.
// All five steps are atomic — the commit either fully succeeds or has no effect.
// If an inventory document is absent, 20 units are assumed available (mirrors
// the product-detail.html fallback used everywhere else on the site).
//
// ── MISSING INVENTORY DOCUMENT POLICY ────────────────────────────────────────
// If no `inventory/<productId>` document exists in Firestore:
//   • Availability: assumed 20 units (site-wide convention; see product-detail.html:849)
//   • comingSoon: assumed false
//   • The transaction creates the inventory document with qty=19 after the sale.
// Change MISSING_INVENTORY_DEFAULT_QTY here and in product-detail.html if needed.
const MISSING_INVENTORY_DEFAULT_QTY = 20;

// ── RATE LIMITING ─────────────────────────────────────────────────────────────
// Fixed-window rate limiting via Upstash Redis REST API (no SDK dependency).
// Limit: RATE_LIMIT_MAX order attempts per hour per client IP.
// DEPLOYMENT BLOCKER: Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
// Exact setup steps:
//   1. Create a free account at https://upstash.com
//   2. Create a Redis database (Global is recommended)
//   3. In the database dashboard: copy "REST URL" and "REST Token"
//   4. In Vercel project settings → Environment Variables:
//      UPSTASH_REDIS_REST_URL  = <REST URL>
//      UPSTASH_REDIS_REST_TOKEN = <REST Token>
// If either variable is absent, the rate limiter logs a warning and allows all
// requests (fail-safe — but the endpoint is unprotected until configured).
//
// ── BOT PROTECTION ASSESSMENT ────────────────────────────────────────────────
// Cloudflare Turnstile (free, GDPR-friendly, no cookies) is recommended for
// COD order submission to prevent automated order flooding. Implementation
// requires: (a) adding a Turnstile widget to checkout.html; (b) verifying the
// token in this handler via POST https://challenges.cloudflare.com/turnstile/v0/siteverify.
// This is a separate decision — document your choice before deployment.
const RATE_LIMIT_MAX    = 10;  // order attempts per hour per IP
const RATE_LIMIT_WINDOW = 3600; // 1 hour in seconds

let _rateLimiterOverride  = null; // test seam — _setRateLimiter(fn) / _resetRateLimiter()
let _capiSenderOverride  = null; // test seam — _setCapiSender(fn) / _resetCapiSender()

async function checkRateLimit(req) {
  if (_rateLimiterOverride) return _rateLimiterOverride(req);

  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    log('rate_limit_unconfigured', null);
    return { allowed: true }; // DEPLOYMENT BLOCKER — see comment above
  }

  // Vercel sets X-Forwarded-For to the validated client IP at index 0
  const ip = ((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown';
  // Fixed-window key by hour — new key each hour, auto-expires shortly after
  const hourBucket = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW);
  const key = `rl:orders:${hourBucket}:${ip}`;
  const expiresAt = (hourBucket + 1) * RATE_LIMIT_WINDOW + 300; // next hour + 5 min buffer

  try {
    const resp = await fetch(`${url}/pipeline`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify([
        ['INCR', key],
        ['EXPIREAT', key, expiresAt],
      ]),
      signal: AbortSignal.timeout(2000), // fail safe: 2 s timeout
    });

    if (!resp.ok) throw new Error(`upstash_http_${resp.status}`);
    const results = await resp.json();
    const count   = results[0]?.result ?? 0;

    if (count > RATE_LIMIT_MAX) {
      log('rate_limited', null);
      return { allowed: false };
    }
    return { allowed: true };
  } catch (e) {
    // Fail safe: allow if the rate limiter is unavailable
    log('rate_limit_error', null, { code: e.code || e.message || 'unknown' });
    return { allowed: true };
  }
}

// ── Authoritative product catalog ─────────────────────────────────────────────
// Must match admin.html PRODUCTS_DB exactly. To change a price:
//   1. Update the price here;
//   2. Update the matching entry in admin.html PRODUCTS_DB;
//   3. Deploy both files together in the same commit.
// The admin dashboard's PRODUCTS_DB is the visual reference; this Map is the
// authoritative source used in price calculations. Future work: extract to a
// shared JSON file so there is one source of truth.
const PRODUCTS = new Map([
  // id                   name                     price  collection
  ['noir',              { name: 'The Noir',          price: 2000, collection: 'Core Collection' }],
  ['rose',              { name: 'The Citrine',        price: 1800, collection: 'Core Collection' }],
  ['citrine',           { name: 'The Champagne',      price: 1800, collection: 'Core Collection' }],
  ['aurelia',           { name: 'The Ruby',           price: 2200, collection: 'Core Collection' }],
  ['solene',            { name: 'The Maldives',       price: 2000, collection: 'Core Collection' }],
  ['celeste',           { name: 'The Opaline',        price: 2200, collection: 'Core Collection' }],
  ['verona',            { name: 'The Honey Quartz',   price: 1800, collection: 'Core Collection' }],
  ['riviera',           { name: 'The Golden Aura',    price: 2200, collection: 'Core Collection' }],
  ['siena',             { name: 'The Eclipse',        price: 1800, collection: 'Core Collection' }],
  ['lumiere',           { name: 'The Obsidian Noir',  price: 2000, collection: 'Core Collection' }],
  ['sunnys-product-11', { name: 'The Sienna',         price: 2200, collection: 'Core Collection' }],
  ['sunnys-product-12', { name: 'The Ambré',          price: 2000, collection: 'Core Collection' }],
  ['sunnys-product-13', { name: 'The Verdant',        price: 1800, collection: 'Core Collection' }],
  ['sunnys-product-14', { name: 'The Lavande',        price: 2000, collection: 'Core Collection' }],
  ['sunnys-product-15', { name: 'The Azurea',         price: 2000, collection: 'Core Collection' }],
  ['sunnys-product-16', { name: 'The Aviara Classic',   price: 2200, collection: 'Core Collection' }],
  ['sunnys-product-17', { name: 'The Lunelle',         price: 1800, collection: 'Core Collection' }],
  ['sunnys-product-18', { name: 'The Mocha Noir',      price: 2000, collection: 'Core Collection' }],
  ['sunnys-product-19', { name: 'The Olive Aura',      price: 2200, collection: 'Core Collection' }],
  ['sunnys-product-20', { name: 'The Hazel',           price: 1800, collection: 'Core Collection' }],
]);

// Shipping destinations and costs.
// Currently accepted countries with their shipping cost (EGP):
//   All listed countries:  EGP 100 (flat international rate)
//   "other":               EGP 0   (edge case — contact customer for arrangement)
// This matches checkout.html shipCost(): `if(!c) return 0; return 100;`
// Browser-submitted shipping costs are ignored — only this server table is used.
const VALID_COUNTRY_CODES = new Set([
  'ae','sa','kw','bh','qa','om','jo','eg','lb','gb','us','other',
]);

function calcShipping(countryCode) {
  if (!countryCode || !VALID_COUNTRY_CODES.has(countryCode)) return 0;
  return countryCode === 'other' ? 0 : 100;
}

// ── Validation ────────────────────────────────────────────────────────────────
function validateOrder(body) {
  if (!body || typeof body !== 'object') return { valid: false, errors: ['invalid_body'] };

  const { orderId, customer, shipping, items, paymentMethod } = body;
  const errors = [];

  if (typeof orderId !== 'string' || !/^SUN-[A-Z0-9]{8}$/.test(orderId))
    errors.push('invalid_order_id');

  if (paymentMethod !== 'cod') errors.push('invalid_payment_method');

  if (!customer || typeof customer !== 'object') {
    errors.push('missing_customer');
  } else {
    const name  = (customer.fullName || '').trim();
    const phone = (customer.phone   || '').trim();
    const email = (customer.email   || '').trim();
    const ph2   = (customer.phone2  || '').trim();
    if (!name)                   errors.push('missing_customer_name');
    else if (name.length > 200)  errors.push('customer_name_too_long');
    if (!phone)                  errors.push('missing_customer_phone');
    else if (phone.length > 30)  errors.push('customer_phone_too_long');
    if (email && email.length > 254) errors.push('customer_email_too_long');
    if (ph2   && ph2.length   > 30)  errors.push('customer_phone2_too_long');
  }

  if (!shipping || typeof shipping !== 'object') {
    errors.push('missing_shipping');
  } else {
    const cc   = (shipping.countryCode || '').trim();
    const city = (shipping.city        || '').trim();
    const addr = (shipping.address     || '').trim();
    const bldg = (shipping.building    || '').trim();
    const apt  = (shipping.apartment   || '').trim();
    if (!cc || !VALID_COUNTRY_CODES.has(cc))  errors.push('invalid_shipping_country');
    if (!city)                  errors.push('missing_shipping_city');
    else if (city.length > 100) errors.push('shipping_city_too_long');
    if (!addr)                  errors.push('missing_shipping_address');
    else if (addr.length > 500) errors.push('shipping_address_too_long');
    if (!bldg)                  errors.push('missing_shipping_building');
    else if (bldg.length > 200) errors.push('shipping_building_too_long');
    if (apt && apt.length > 100) errors.push('shipping_apartment_too_long');
  }

  const notes = (body.notes || '').trim();
  if (notes.length > 500) errors.push('notes_too_long');

  if (!Array.isArray(items) || items.length === 0) {
    errors.push('empty_items');
  } else if (items.length > 20) {
    errors.push('too_many_items');
  }

  if (errors.length) return { valid: false, errors };

  const validatedItems = [];
  let recalcSubtotal = 0;
  let totalQty = 0;

  for (const item of items) {
    const product = PRODUCTS.get(item.productId);
    if (!product) { errors.push(`unknown_product:${String(item.productId || '').slice(0, 50)}`); continue; }
    const qty = Math.floor(Number(item.qty) || 0);
    if (qty < 1 || qty > 10) { errors.push(`invalid_qty:${item.productId}`); continue; }
    totalQty += qty;
    if (totalQty > 20) { errors.push('total_qty_exceeded'); break; }
    validatedItems.push({
      productId:  item.productId,
      name:       product.name,
      collection: product.collection,
      price:      product.price,
      qty,
      image: typeof item.image === 'string' ? item.image.slice(0, 500) : '',
    });
    recalcSubtotal += product.price * qty;
  }

  if (errors.length) return { valid: false, errors };

  const shippingCost = calcShipping(shipping.countryCode.trim());
  const total = recalcSubtotal + shippingCost;
  return { valid: true, validatedItems, recalcSubtotal, shippingCost, total };
}

// ── Privacy-safe structured logger ───────────────────────────────────────────
// Logs orderId, timestamp, stage, error codes only.
// Never logs names, phones, addresses, emails, or secrets.
function log(stage, orderId, extra) {
  const entry = Object.assign({ t: new Date().toISOString(), stage, orderId: orderId || '(none)' }, extra);
  console.log(JSON.stringify(entry));
}

// ── Server-side Meta Conversions API Purchase ─────────────────────────────────
// Requires META_CAPI_ACCESS_TOKEN in Vercel env vars (disabled when unset).
//
// ── HOW DEDUPLICATION WORKS ───────────────────────────────────────────────────
// Browser pixel sends:  fbq('track', 'Purchase', {...}, { eventID: orderId })
// Server CAPI sends:    event_id: orderId  (this function)
// Meta matches:         event_name='Purchase' AND event_id match → ONE Purchase
//
// Both must use the exact permanent orderId as the deduplication key.
// Do NOT use any prefix, suffix, timestamp, or random value.
//
// ── AUTO-CAPI WARNING ────────────────────────────────────────────────────────
// Meta's automatically-connected CAPI (configured in Meta Business Suite, not
// this repo) fires an independent server Purchase for every browser pixel event.
// Its event_id is generated externally and does NOT match our orderId, so Meta
// cannot deduplicate it with the browser event → TWO Purchases are counted.
//
// FIX: disable the auto-CAPI in Meta Events Manager BEFORE setting
// META_CAPI_ACCESS_TOKEN here. Only one server system should send the event.
//   Path: Events Manager → Data Sources → [Pixel 1788781122137161]
//         → Settings → Conversions API → disconnect the auto-integration.
//
// ── SERVER-SIDE IDEMPOTENCY ────────────────────────────────────────────────────
// The Firestore transaction guarantees fireMetaCAPI is called ONLY for new orders
// (idempotent requests return before reaching this function). Concurrent requests
// with the same orderId are serialized by the transaction; only the winner
// proceeds to this call. An extra pre-send check on metaPurchaseStatus provides
// defense-in-depth.
// The order document records the CAPI outcome in metaPurchaseStatus ('pending' →
// 'sent' or 'failed') for observability. These fields must NOT be marked 'sent'
// before the CAPI call succeeds — the check order below enforces this.
//
// ── TEST EVENT CODE ───────────────────────────────────────────────────────────
// For safe testing via Events Manager → Test Events:
//   1. Set META_TEST_EVENT_CODE in Vercel env vars (do NOT commit or hardcode it)
//   2. Place a test order
//   3. Verify deduplication: browser + server both show Purchase, Meta shows ONE
//   4. Remove META_TEST_EVENT_CODE before going live
//
// ── FAILURE HANDLING ─────────────────────────────────────────────────────────
// CAPI is fire-and-forget (non-blocking). If the CAPI call fails:
//   - The order is already durably committed in Firestore
//   - The browser pixel still fires on confirmation.html (primary tracking signal)
//   - metaPurchaseStatus = 'failed' in the order document (observable in admin)
//   - The failed CAPI is NOT retried automatically (idempotent retries skip CAPI)
//   - This is acceptable for COD flows; review if CAPI becomes critical
async function fireMetaCAPI(db, orderId, total, items, req) {
  // Test seam — allows tests to capture or mock the CAPI call without real fetch
  if (_capiSenderOverride) return _capiSenderOverride({ db, orderId, total, items, req });

  const token   = process.env.META_CAPI_ACCESS_TOKEN;
  const pixelId = process.env.META_PIXEL_ID || '1788781122137161';
  if (!token) return; // disabled — set META_CAPI_ACCESS_TOKEN to enable

  const host = (req.headers && req.headers.host) || '';
  if (!host.includes('sunnys.community')) {
    log('meta_capi_skipped_non_prod', orderId, { host });
    return;
  }

  // Defense-in-depth idempotency check (transaction already guarantees this, but
  // guard against unlikely concurrent edge cases by reading metaPurchaseStatus)
  try {
    const snap = await db.collection('orders').doc(orderId).get();
    if (snap.exists && snap.data().metaPurchaseStatus === 'sent') {
      log('meta_capi_already_sent', orderId);
      return;
    }
  } catch (readErr) {
    // Fail open — proceed with the CAPI send rather than silently skip
    log('meta_capi_read_error', orderId, { code: readErr.code || 'unknown' });
  }

  // user_data: non-PII signals for Meta match quality (no email/phone — avoids
  // the hashing requirement while still improving server-side attribution)
  const clientIp  = ((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim() || null;
  const userAgent = (req.headers && req.headers['user-agent']) || null;
  const userData  = {};
  if (clientIp)  userData.client_ip_address = clientIp;
  if (userAgent) userData.client_user_agent = userAgent;

  // test_event_code: read-only from env var — NEVER hardcode, NEVER commit
  const testEventCode = process.env.META_TEST_EVENT_CODE || null;

  const payload = {
    data: [{
      event_name:       'Purchase',
      event_id:         orderId, // MUST equal browser eventID (= orderId) for dedup
      event_time:       Math.floor(Date.now() / 1000),
      action_source:    'website',
      event_source_url: 'https://sunnys.community/confirmation.html',
      user_data:        userData,
      custom_data:      {
        value:        total,     // server-recalculated — matches browser order.total
        currency:     'EGP',
        content_ids:  items.map(i => i.productId),
        contents:     items.map(i => ({ id: String(i.productId), quantity: Number(i.qty), item_price: Number(i.price) })),
        content_type: 'product',
        num_items:    items.reduce((s, i) => s + i.qty, 0),
        order_id:     orderId,
      },
    }],
  };
  if (testEventCode) payload.test_event_code = testEventCode;

  let capiOk = false;
  try {
    const resp = await fetch(
      `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${token}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }
    );
    const json = await resp.json();
    capiOk = resp.ok;
    log('meta_capi_sent', orderId, { status: resp.status, events_received: json.events_received });
  } catch (e) {
    log('meta_capi_error', orderId, { code: e.code || 'unknown' });
  }

  // Update order document with CAPI outcome (non-fatal if this write fails)
  try {
    await db.collection('orders').doc(orderId).update({
      metaPurchaseStatus:  capiOk ? 'sent' : 'failed',
      metaPurchaseSentAt:  capiOk ? new Date().toISOString() : null,
      metaPurchaseAttempts: 1,
    });
  } catch (updateErr) {
    log('meta_capi_update_failed', orderId, { code: updateErr.code || 'unknown' });
  }
}

// ── Firebase Admin singleton ──────────────────────────────────────────────────
let _injectedDb = null;
let _realDb     = null;

function getDb() {
  if (_injectedDb) return _injectedDb;
  if (_realDb)     return _realDb;

  // Resolve Firebase service-account credentials.
  // Option A (individual vars): FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
  // Option B (single JSON):     FIREBASE_SERVICE_ACCOUNT = full service-account JSON string
  //   How to get Option B value: Firebase Console → Project Settings → Service Accounts →
  //   "Generate new private key" → download JSON → paste entire file contents as the env var.
  let projectId   = process.env.FIREBASE_PROJECT_ID;
  let clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (saJson) {
    try {
      const sa = JSON.parse(saJson);
      if (!projectId)   projectId   = sa.project_id;
      if (!clientEmail) clientEmail = sa.client_email;
      if (!privateKey)  privateKey  = sa.private_key || '';
    } catch (_) {
      log('firebase_sa_json_parse_error', null);
    }
  }

  // Fail fast with a structured log before touching firebase-admin, so the
  // try-catch in the handler always intercepts the error and returns 503.
  // In Vercel logs this appears as stage: "firebase_credentials_missing" with the
  // exact list of missing variable names — which tells you exactly what to set.
  if (!projectId || !clientEmail || !privateKey) {
    const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
      .filter(v => !process.env[v]);
    log('firebase_credentials_missing', null, {
      missing,
      hint: 'Set individual vars in Vercel dashboard, or set FIREBASE_SERVICE_ACCOUNT to the full service-account JSON string',
    });
    throw new Error('firebase_credentials_not_configured');
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }
  _realDb = admin.firestore();
  return _realDb;
}

const ALLOWED_ORIGINS = new Set(['https://sunnys.community']);

const COUNTRY_MAP = {
  ae:'United Arab Emirates', sa:'Saudi Arabia',  kw:'Kuwait',        bh:'Bahrain',
  qa:'Qatar',                om:'Oman',          jo:'Jordan',        eg:'Egypt',
  lb:'Lebanon',              gb:'United Kingdom', us:'United States', other:'Other',
};

// ── Vercel config ─────────────────────────────────────────────────────────────
// Enforces 10 KB body limit at the framework level before our handler is called.
// The handler also checks body size independently (belt-and-suspenders).
module.exports.config = {
  api: {
    bodyParser: { sizeLimit: '10kb' },
  },
};

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');

  const origin = req.headers.origin;
  if (origin) {
    if (!ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: 'forbidden' });
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  if (req.method === 'OPTIONS') {
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    return res.status(204).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) return res.status(415).json({ error: 'unsupported_media_type' });

  // Belt-and-suspenders body size check (Vercel sizeLimit is the primary guard).
  // Works even when Content-Length is absent or spoofed.
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (!isNaN(contentLength) && contentLength > 10240) return res.status(413).json({ error: 'payload_too_large' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (_) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  // Check actual body size after parsing (catches absent or forged Content-Length)
  if (body && typeof body === 'object') {
    try {
      if (JSON.stringify(body).length > 10240) return res.status(413).json({ error: 'payload_too_large' });
    } catch (_) { /* ignore serialization errors — validation below will catch bad inputs */ }
  }

  // Rate limit check — requires Upstash Redis (see DEPLOYMENT BLOCKERS above)
  const rl = await checkRateLimit(req);
  if (!rl.allowed) return res.status(429).json({ error: 'too_many_requests' });

  const orderId = (body && typeof body.orderId === 'string') ? body.orderId : null;
  log('received', orderId);

  const validation = validateOrder(body);
  if (!validation.valid) {
    log('validation_failed', orderId, { errors: validation.errors });
    return res.status(400).json({ error: 'validation_failed', details: validation.errors });
  }

  const { validatedItems, recalcSubtotal, shippingCost, total } = validation;
  const countryCode = body.shipping.countryCode.trim();

  const order = {
    orderId,
    date:            body.date || new Date().toISOString(),
    serverTimestamp: new Date().toISOString(),
    status:          'pending',
    customer: {
      fullName: body.customer.fullName.trim().slice(0, 200),
      phone:    body.customer.phone.trim().slice(0, 30),
      phone2:   (body.customer.phone2 || '').trim().slice(0, 30),
      email:    (body.customer.email  || '').trim().slice(0, 254),
    },
    shipping: {
      country:    COUNTRY_MAP[countryCode] || countryCode,
      countryCode,
      city:       body.shipping.city.trim().slice(0, 100),
      address:    body.shipping.address.trim().slice(0, 500),
      building:   body.shipping.building.trim().slice(0, 200),
      apartment:  (body.shipping.apartment || '').trim().slice(0, 100),
    },
    notes:         (body.notes || '').trim().slice(0, 500),
    items:         validatedItems,
    paymentMethod: 'cod',
    subtotal:      recalcSubtotal,
    shippingCost,
    total,
    // Meta CAPI deduplication tracking (written atomically with the order)
    // metaPurchaseEventId must equal the browser eventID — both use orderId
    // Status transitions: 'pending' → 'sent' (CAPI succeeded) | 'failed' (CAPI error)
    metaPurchaseEventId:  orderId,
    metaPurchaseStatus:   'pending',
    metaPurchaseAttempts: 0,
  };

  // ── Atomic Firestore transaction ───────────────────────────────────────────
  // All five steps run together or not at all:
  //   (a) idempotency check  (b) inventory reads  (c) inventory verification
  //   (d) order creation     (e) inventory decrements
  // Firestore automatically retries the transaction on commit conflict.
  let db, txResult;
  try {
    db = getDb();
    const orderRef = db.collection('orders').doc(orderId);
    const invRefs  = validatedItems.map(item => db.collection('inventory').doc(item.productId));

    txResult = await db.runTransaction(async (transaction) => {
      // (a) Idempotency: if the order already exists, return without touching inventory
      const existingOrder = await transaction.get(orderRef);
      if (existingOrder.exists) return { idempotent: true };

      // (b) Read all inventory documents in parallel (all reads must precede writes)
      const invSnaps = await Promise.all(invRefs.map(ref => transaction.get(ref)));

      // (c) Verify stock for each item
      for (let i = 0; i < validatedItems.length; i++) {
        const item = validatedItems[i];
        const snap = invSnaps[i];
        // Missing document treated as MISSING_INVENTORY_DEFAULT_QTY units (see file header)
        const inv  = snap.exists ? snap.data() : { inventoryQuantity: MISSING_INVENTORY_DEFAULT_QTY, comingSoon: false };
        if (inv.comingSoon)                          return { outOfStock: item.productId };
        if ((inv.inventoryQuantity ?? MISSING_INVENTORY_DEFAULT_QTY) < item.qty) return { outOfStock: item.productId };
      }

      // (d) Write order — all reads are complete; writes begin
      transaction.set(orderRef, order);

      // (e) Decrement inventory atomically with the order
      for (let i = 0; i < validatedItems.length; i++) {
        const item = validatedItems[i];
        const snap = invSnaps[i];
        const inv  = snap.exists ? snap.data() : { inventoryQuantity: MISSING_INVENTORY_DEFAULT_QTY, comingSoon: false };
        const newQty   = Math.max(0, (inv.inventoryQuantity ?? MISSING_INVENTORY_DEFAULT_QTY) - item.qty);
        const status   = newQty === 0 ? 'out_of_stock' : newQty <= 10 ? 'limited' : 'in_stock';
        transaction.set(invRefs[i], Object.assign({}, inv, { inventoryQuantity: newQty, inventoryStatus: status }), { merge: true });
      }

      return { success: true };
    });
  } catch (dbErr) {
    log('firestore_failed', orderId, {
      code:    dbErr.code    || 'none',
      message: (dbErr.message || '').slice(0, 200), // safe: Firebase init errors contain no PII or secrets
    });
    return res.status(503).json({ error: 'firestore_unavailable', retryable: true });
  }

  if (txResult.idempotent) {
    log('idempotent_return', orderId);
    return res.status(200).json({ success: true, orderId, idempotent: true, total });
  }

  if (txResult.outOfStock) {
    log('out_of_stock', orderId, { productId: txResult.outOfStock });
    return res.status(409).json({ error: 'out_of_stock', retryable: false });
  }

  log('firestore_confirmed', orderId);

  // Server-side Meta CAPI Purchase.
  // Enabled when META_CAPI_ACCESS_TOKEN is set. Disabled (no-op) when unset.
  // event_id = orderId, matching browser eventID — required for deduplication.
  // Must disable Meta's auto-CAPI in Events Manager before setting the token.
  // See fireMetaCAPI() comment for the full deduplication explanation.
  fireMetaCAPI(db, orderId, total, validatedItems, req).catch(() => {});

  return res.status(200).json({ success: true, orderId, total });
};

module.exports._setTestDb        = (db) => { _injectedDb = db; };
module.exports._resetTestDb      = ()   => { _injectedDb = null; _realDb = null; };
module.exports._validateOrder    = validateOrder;
module.exports._setRateLimiter   = (fn) => { _rateLimiterOverride = fn; };
module.exports._resetRateLimiter = ()   => { _rateLimiterOverride = null; };
// CAPI seam: _setCapiSender(async ({ db, orderId, total, items, req }) => {...})
// Captures or mocks the Meta CAPI call without hitting graph.facebook.com.
// Fires before the token/host checks so tests work without real credentials.
module.exports._setCapiSender    = (fn) => { _capiSenderOverride = fn; };
module.exports._resetCapiSender  = ()   => { _capiSenderOverride = null; };
