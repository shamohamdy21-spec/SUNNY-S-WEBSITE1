// test-checkout-states.mjs — READ-ONLY verification, not committed, not deployed
// Tests checkout.html using network interception.
// The checkout uses /api/orders fetch directly — no Firebase client-side init.
// Strategy: let real page load; intercept /api/orders with 503 for failure path.
// Block pixel endpoints so no live PageView events fire.

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECKOUT  = 'http://localhost:3000/checkout.html';
const OUT_DIR   = path.join(__dirname, 'temporary screenshots');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
function screenshotPath(label) {
  let n = 1;
  while (fs.existsSync(path.join(OUT_DIR, `screenshot-${n}-${label}.png`))) n++;
  return path.join(OUT_DIR, `screenshot-${n}-${label}.png`);
}

const FAKE_CART = JSON.stringify([{
  productId: 'noir', name: 'The Noir', collection: 'Core Collection',
  price: 2000, qty: 1,
  image: '/brand_assets/brand%20assets%202/20DC2642-C5AC-4FC7-A06C-637AE1E41B63.jpeg'
}]);

const browser = await puppeteer.launch({ headless: 'new' });
const page    = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const consoleLogs = [];
page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

// Block pixel endpoints; conditionally respond 503 to /api/orders for State C.
let failApiOrders = false;
await page.setRequestInterception(true);
page.on('request', req => {
  const url = req.url();
  if (url.includes('facebook.net') || url.includes('connect.facebook') ||
      url.includes('analytics.tiktok.com')) {
    req.abort(); return;
  }
  if (failApiOrders && url.includes('/api/orders')) {
    req.respond({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'service_unavailable' }),
    });
    return;
  }
  req.continue();
});

// Inject fake cart before page loads
await page.evaluateOnNewDocument((cart) => {
  localStorage.setItem('sunny_cart', cart);
  localStorage.removeItem('sunny_orders');
  localStorage.removeItem('sunny_buynow');
}, FAKE_CART);

await page.goto(CHECKOUT, { waitUntil: 'domcontentloaded', timeout: 20000 });

// ── STATE A: capture immediately after DOM is ready ───────────────────────────
// The checkout uses /api/orders fetch directly — the button is ready immediately.
// There is no async Firebase initialization step to wait for.
await page.evaluate(() => {
  const btn = document.getElementById('btnPlace');
  if (btn) btn.scrollIntoView({ block: 'center' });
});
await new Promise(r => setTimeout(r, 300));

const pathA = screenshotPath('A-initial-state');
await page.screenshot({ path: pathA });
const stateA = await page.evaluate(() => ({
  btnDisabled:     document.getElementById('btnPlace')?.disabled,
  errHidden:       !document.getElementById('orderError')?.classList.contains('show'),
  cartLoaded:      !!localStorage.getItem('sunny_cart'),
  selPayExists:    typeof window.selPay === 'function',
  checkoutReady:   !!document.getElementById('checkoutForm'),
}));
console.log('\nState A (immediately after page load):');
console.log(JSON.stringify(stateA, null, 2));
console.log('Script errors:', consoleLogs.filter(l => l.includes('error') || l.includes('Error')));

// ── STATE C: simulate /api/orders returning 503, exhaust all retries ──────────
// The checkout retries up to 3 times with 1s + 2s backoffs (total ~3 s).
failApiOrders = true;   // activate 503 interception

await page.evaluate(() => {
  // Fill all required form fields
  document.getElementById('fname').value    = 'Test User';
  document.getElementById('phone').value    = '+971501234567';
  document.getElementById('country').value  = 'ae';
  document.getElementById('country').dispatchEvent(new Event('change'));
  document.getElementById('city').value     = 'Dubai';
  document.getElementById('address').value  = '123 Test St';
  document.getElementById('building').value = 'B1';
  // Select COD payment — call selPay directly (avoids onclick dispatch concerns)
  if (typeof selPay === 'function') selPay('cod');
  else document.getElementById('payCod').click();
});

await page.evaluate(() => {
  document.getElementById('checkoutForm')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});

// Wait: 3 attempts × (0 s + 1 s + 2 s backoffs) + 2 s buffer = 6 s total
await new Promise(r => setTimeout(r, 7000));

const pathC = screenshotPath('C-api-503-failure');
await page.screenshot({ path: pathC });
const stateC = await page.evaluate(() => ({
  btnReEnabled:     !document.getElementById('btnPlace')?.disabled,
  errShows:         document.getElementById('orderError')?.classList.contains('show'),
  errText:          document.getElementById('orderError')?.textContent?.trim(),
  ordersInLS:       JSON.parse(localStorage.getItem('sunny_orders') || '[]').length,
  cartStillHeld:    !!localStorage.getItem('sunny_cart'),
  fnamePreserved:   document.getElementById('fname')?.value,
  phonePreserved:   document.getElementById('phone')?.value,
}));
console.log('\nState C (after three 503 failures — all retries exhausted):');
console.log(JSON.stringify(stateC, null, 2));
console.log('Order attempt logs:', consoleLogs.filter(l => l.includes('[Order]')));

// ── ASSERTIONS ────────────────────────────────────────────────────────────────
const pass = (label, cond) => {
  console.log(cond ? `  PASS  ${label}` : `  FAIL  ${label}`);
  return cond;
};
console.log('\n=== TEST RESULTS ===');
const results = [
  // State A — checkout is immediately ready (no async init required)
  pass('A: button enabled on load — checkout is ready immediately',  stateA.btnDisabled  === false),
  pass('A: error banner hidden on load',                             stateA.errHidden    === true),
  pass('A: cart loaded from localStorage',                           stateA.cartLoaded   === true),
  pass('A: checkout script executed (selPay defined)',               stateA.selPayExists === true),
  // State C — /api/orders returned 503 three times
  pass('C: button re-enabled after all retries failed',              stateC.btnReEnabled === true),
  pass('C: error banner shown',                                      stateC.errShows     === true),
  pass('C: error text mentions connection',                          (stateC.errText||'').toLowerCase().includes('connection')),
  pass('C: cart not cleared on failure',                             stateC.cartStillHeld === true),
  pass('C: no order written to localStorage',                        stateC.ordersInLS   === 0),
  pass('C: customer name preserved in form',                         stateC.fnamePreserved === 'Test User'),
  pass('C: customer phone preserved in form',                        stateC.phonePreserved === '+971501234567'),
];
const failed = results.filter(r => !r).length;
console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : failed + ' TEST(S) FAILED'}`);
console.log('\nScreenshots:');
console.log(' A (initial):', pathA);
console.log(' C (api-503):', pathC);

await browser.close();
