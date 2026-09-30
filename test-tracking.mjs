// Verifies that catalog SKUs are emitted correctly for both finishes.
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const events = [];

// Intercept fbq calls
await page.evaluateOnNewDocument(() => {
  window._fbqCalls = [];
  window.fbq = function(type, name, data) {
    window._fbqCalls.push({ type, name, data: JSON.parse(JSON.stringify(data || {})) });
  };
  window.fbq.callMethod = null;
  window.fbq.push = window.fbq;
  window.fbq.loaded = true;
  window.fbq.version = '2.0';
  window.fbq.queue = [];
});

// ── Test NGP (default) — product 16 ─────────────────────────────────────────
await page.goto('http://localhost:3000/product-detail.html?p=sunnys-product-16', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 600));

const ngpCalls = await page.evaluate(() => window._fbqCalls);
const viewContentNGP = ngpCalls.find(c => c.name === 'ViewContent');
console.log('\n─── ViewContent (default = NGP) ───');
console.log('content_ids:', viewContentNGP?.data?.content_ids);
console.log('value:', viewContentNGP?.data?.value);
console.log('content_type:', viewContentNGP?.data?.content_type);

// Switch to GP and call SunnyTracking.addToCart directly (avoids navigation race)
const addToCartGP = await page.evaluate(() => {
  window._fbqCalls = [];
  const gpBtn = [...document.querySelectorAll('.plating-option')].find(b => b.dataset.finish === 'Gold-Plated');
  if (gpBtn) gpBtn.click(); // updates selectedFinish
  // Call tracking directly without triggering navigation
  const id = new URLSearchParams(window.location.search).get('p');
  const price = typeof getFinishPrice === 'function' ? getFinishPrice().sale : 3200;
  const finish = typeof selectedFinish !== 'undefined' ? selectedFinish : 'Gold-Plated';
  if (window.SunnyTracking) window.SunnyTracking.addToCart(id, 'Test', price, finish);
  return window._fbqCalls.find(c => c.name === 'AddToCart') || null;
});
console.log('\n─── AddToCart (Gold-Plated) ───');
console.log('content_ids:', addToCartGP?.data?.content_ids);
console.log('value:', addToCartGP?.data?.value);
console.log('content_type:', addToCartGP?.data?.content_type);

// ── Test NGP AddToCart — product 22 ─────────────────────────────────────────
await page.evaluateOnNewDocument(() => {
  window._fbqCalls = [];
  window.fbq = function(type, name, data) {
    window._fbqCalls.push({ type, name, data: JSON.parse(JSON.stringify(data || {})) });
  };
  window.fbq.callMethod = null;
  window.fbq.push = window.fbq;
  window.fbq.loaded = true;
  window.fbq.version = '2.0';
  window.fbq.queue = [];
});
await page.goto('http://localhost:3000/product-detail.html?p=sunnys-product-22', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 600));

const p22Calls = await page.evaluate(() => window._fbqCalls);
const viewContentP22 = p22Calls.find(c => c.name === 'ViewContent');
// AddToCart with NGP (default) — call directly to avoid navigation race
const addToCartP22 = await page.evaluate(() => {
  window._fbqCalls = [];
  const id = new URLSearchParams(window.location.search).get('p');
  const price = typeof getFinishPrice === 'function' ? getFinishPrice().sale : 2400;
  const finish = typeof selectedFinish !== 'undefined' ? selectedFinish : 'Non-Gold-Plated';
  if (window.SunnyTracking) window.SunnyTracking.addToCart(id, 'Test', price, finish);
  return window._fbqCalls.find(c => c.name === 'AddToCart') || null;
});
console.log('\n─── Product 22 ViewContent (NGP) ───');
console.log('content_ids:', viewContentP22?.data?.content_ids);
console.log('value:', viewContentP22?.data?.value);
console.log('\n─── Product 22 AddToCart (NGP) ───');
console.log('content_ids:', addToCartP22?.data?.content_ids);

// ── Test InitiateCheckout with mixed cart ─────────────────────────────────────
await page.evaluateOnNewDocument(() => {
  window._fbqCalls = [];
  window.fbq = function(type, name, data) {
    window._fbqCalls.push({ type, name, data: JSON.parse(JSON.stringify(data || {})) });
  };
  window.fbq.callMethod = null;
  window.fbq.push = window.fbq;
  window.fbq.loaded = true;
  window.fbq.version = '2.0';
  window.fbq.queue = [];
  // Pre-seed cart with both finishes
  localStorage.setItem('sunny_cart', JSON.stringify([
    { productId: 'sunnys-product-16', name: 'The Aviara Classic', collection: 'Core Collection', price: 2400, image: '', qty: 1, finish: 'Non-Gold-Plated' },
    { productId: 'sunnys-product-22', name: 'The Aviara Emerelle', collection: 'Core Collection', price: 3200, image: '', qty: 2, finish: 'Gold-Plated' },
  ]));
});
await page.goto('http://localhost:3000/checkout.html', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 600));

const checkoutCalls = await page.evaluate(() => window._fbqCalls);
const initCheckout = checkoutCalls.find(c => c.name === 'InitiateCheckout');
console.log('\n─── InitiateCheckout (mixed cart: SNS-016-NGP + SNS-022-GP ×2) ───');
console.log('content_ids:', initCheckout?.data?.content_ids);
console.log('value:', initCheckout?.data?.value);
console.log('num_items:', initCheckout?.data?.num_items);
console.log('content_type:', initCheckout?.data?.content_type);

// ── Test Purchase event ───────────────────────────────────────────────────────
await page.evaluateOnNewDocument(() => {
  window._fbqCalls = [];
  window.fbq = function(type, name, data, opts) {
    window._fbqCalls.push({ type, name, data: JSON.parse(JSON.stringify(data || {})), opts: JSON.parse(JSON.stringify(opts || {})) });
  };
  window.fbq.callMethod = null;
  window.fbq.push = window.fbq;
  window.fbq.loaded = true;
  window.fbq.version = '2.0';
  window.fbq.queue = [];
  const order = {
    orderId: 'SUN-TEST001',
    total: 9800,
    items: [
      { productId: 'sunnys-product-16', name: 'The Aviara Classic', price: 2400, qty: 1, finish: 'Non-Gold-Plated' },
      { productId: 'sunnys-product-22', name: 'The Aviara Emerelle', price: 3200, qty: 2, finish: 'Gold-Plated' },
    ],
    customer: {},
    shipping: {}
  };
  localStorage.setItem('sunny_orders', JSON.stringify([order]));
  // Clear dedup guard so Purchase fires
  localStorage.removeItem('px_purchased_SUN-TEST001');
});
await page.goto('http://localhost:3000/confirmation.html?order=SUN-TEST001', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 600));

const confCalls = await page.evaluate(() => window._fbqCalls);
const purchase = confCalls.find(c => c.name === 'Purchase');
console.log('\n─── Purchase (SNS-016-NGP ×1, SNS-022-GP ×2) ───');
console.log('content_ids:', purchase?.data?.content_ids);
console.log('contents:', JSON.stringify(purchase?.data?.contents));
console.log('value:', purchase?.data?.value);
console.log('content_type:', purchase?.data?.content_type);
console.log('eventID:', purchase?.opts?.eventID);

await browser.close();

// Summary
console.log('\n══ PASS/FAIL ══');
const checks = [
  ['ViewContent NGP = SNS-016-NGP', viewContentNGP?.data?.content_ids?.[0] === 'SNS-016-NGP'],
  ['ViewContent NGP price = 2400', viewContentNGP?.data?.value === 2400],
  ['AddToCart GP = SNS-016-GP', addToCartGP?.data?.content_ids?.[0] === 'SNS-016-GP'],
  ['AddToCart GP price = 3200', addToCartGP?.data?.value === 3200],
  ['ViewContent P22 NGP = SNS-022-NGP', viewContentP22?.data?.content_ids?.[0] === 'SNS-022-NGP'],
  ['AddToCart P22 NGP = SNS-022-NGP', addToCartP22?.data?.content_ids?.[0] === 'SNS-022-NGP'],
  ['InitiateCheckout ids correct', JSON.stringify(initCheckout?.data?.content_ids) === '["SNS-016-NGP","SNS-022-GP"]'],
  ['InitiateCheckout value = 8800', initCheckout?.data?.value === 8800],
  ['InitiateCheckout num_items = 3', initCheckout?.data?.num_items === 3],
  ['Purchase content_ids correct', JSON.stringify(purchase?.data?.content_ids) === '["SNS-016-NGP","SNS-022-GP"]'],
  ['Purchase contents[0].id = SNS-016-NGP', purchase?.data?.contents?.[0]?.id === 'SNS-016-NGP'],
  ['Purchase contents[1].id = SNS-022-GP', purchase?.data?.contents?.[1]?.id === 'SNS-022-GP'],
  ['Purchase contents[1].quantity = 2', purchase?.data?.contents?.[1]?.quantity === 2],
  ['Purchase content_type = product', purchase?.data?.content_type === 'product'],
  ['Purchase dedup eventID set', !!purchase?.opts?.eventID],
];
let passed = 0;
for (const [label, ok] of checks) {
  console.log((ok ? '✓' : '✗') + ' ' + label);
  if (ok) passed++;
}
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
