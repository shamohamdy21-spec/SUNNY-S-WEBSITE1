// tracking.js — Sunny's Eyewear Analytics
// Meta Pixel : 1788781122137161
// TikTok Pixel: D9N0VARC77U1C011M630
// All monetary values in EGP.
// Pixels are initialised per-page in <head>; this file only contains helpers.

(function (w) {
  'use strict';

  function fbq() {
    if (typeof w.fbq === 'function') w.fbq.apply(w, arguments);
  }
  function ttq(event, data) {
    if (w.ttq && typeof w.ttq.track === 'function') w.ttq.track(event, data);
  }

  // Maps sunnys-product-XX internal IDs → catalog base SKUs (SNS-0XX).
  // Appends -NGP (Non-Gold-Plated) or -GP (18K Gold-Plated) based on finish.
  // Falls back to the raw productId for any product not in this catalog.
  var SKU_MAP = {
    'sunnys-product-11': 'SNS-011',
    'sunnys-product-12': 'SNS-012',
    'sunnys-product-14': 'SNS-014',
    'sunnys-product-15': 'SNS-015',
    'sunnys-product-16': 'SNS-016',
    'sunnys-product-17': 'SNS-017',
    'sunnys-product-18': 'SNS-018',
    'sunnys-product-19': 'SNS-019',
    'sunnys-product-20': 'SNS-020',
    'sunnys-product-21': 'SNS-021',
    'sunnys-product-22': 'SNS-022',
    'sunnys-product-23': 'SNS-023',
    'sunnys-product-24': 'SNS-024'
  };
  function catalogSku(productId, finish) {
    var base = SKU_MAP[productId];
    if (!base) return productId;
    return base + (finish === 'Gold-Plated' ? '-GP' : '-NGP');
  }

  // Dialing codes for countries available in the checkout country selector.
  var COUNTRY_DIAL = {
    ae: '971', sa: '966', kw: '965', bh: '973', qa: '974', om: '968',
    jo: '962', eg: '20',  lb: '961', gb: '44',  us: '1'
  };

  // Normalizes a phone number to E.164 for TikTok customer matching.
  // countryCode: the order's shipping.countryCode (ae, sa, eg, …).
  // Numbers that already carry a + or 00 international prefix are trusted as-is.
  // Local-format numbers (no country prefix) are resolved using countryCode.
  // Returns '' if the result is not a plausible E.164 value (7–15 digits).
  function normalizePhone(raw, countryCode) {
    if (!raw) return '';
    var s = raw.replace(/[^+\d]/g, '');
    if (s.indexOf('00') === 0) { s = '+' + s.slice(2); }
    var digits;
    if (s.charAt(0) === '+') {
      // Already in international format — use digits verbatim.
      digits = s.slice(1);
    } else {
      // Local format: strip leading 0 (common convention in all covered countries),
      // then prepend the country dialing code. Default to Egypt (20) when unknown.
      var local = s.charAt(0) === '0' ? s.slice(1) : s;
      digits = (COUNTRY_DIAL[countryCode] || '20') + local;
    }
    var e164 = '+' + digits;
    // E.164: + followed by 7–15 digits (ITU-T E.164 range).
    return /^\+\d{7,15}$/.test(e164) ? e164 : '';
  }

  w.SunnyTracking = {

    // Fired on every product detail page after the product data is loaded.
    // finish: 'Non-Gold-Plated' | 'Gold-Plated' — the variant shown at page load.
    viewContent: function (id, name, price, finish) {
      price = parseFloat(price) || 0;
      var sku = catalogSku(id, finish);
      fbq('track', 'ViewContent', {
        content_ids:  [sku],
        content_name: name,
        content_type: 'product',
        value:        price,
        currency:     'EGP'
      });
      ttq('ViewContent', {
        content_id:   sku,
        content_name: name,
        content_type: 'product',
        quantity:     1,
        value:        price,
        currency:     'EGP'
      });
    },

    // Fired when "Add to Cart" is clicked.
    // finish: the finish selected at the moment of the click.
    addToCart: function (id, name, price, finish) {
      price = parseFloat(price) || 0;
      var sku = catalogSku(id, finish);
      fbq('track', 'AddToCart', {
        content_ids:  [sku],
        content_name: name,
        content_type: 'product',
        value:        price,
        currency:     'EGP'
      });
      ttq('AddToCart', {
        content_id:   sku,
        content_name: name,
        content_type: 'product',
        quantity:     1,
        value:        price,
        currency:     'EGP'
      });
    },

    // Fired on checkout.html load (covers both Add-to-Cart and Buy-Now flows).
    // items: array of { productId, name, price, qty, finish }
    initiateCheckout: function (items) {
      var total = items.reduce(function (s, i) { return s + (i.price * i.qty); }, 0);
      var ids   = items.map(function (i) { return catalogSku(i.productId, i.finish); });
      var num   = items.reduce(function (s, i) { return s + i.qty; }, 0);
      fbq('track', 'InitiateCheckout', {
        content_ids:  ids,
        content_type: 'product',
        num_items:    num,
        value:        total,
        currency:     'EGP'
      });
      ttq('InitiateCheckout', {
        content_id:   ids[0] || '',
        content_type: 'product',
        quantity:     num,
        value:        total,
        currency:     'EGP'
      });
    },

    // Fired on confirmation.html only when a valid, confirmed order is found.
    // Duplicate guard: localStorage key per orderId — persists across tab closes and
    // browser restarts so revisiting a historical confirmation URL never re-fires.
    // order: { orderId, total, items: [{ productId, name, price, qty, finish }] }
    purchase: function (order) {
      var key = 'px_purchased_' + order.orderId;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');

      var ids      = (order.items || []).map(function (i) { return catalogSku(i.productId, i.finish); });
      var num      = (order.items || []).reduce(function (s, i) { return s + i.qty; }, 0);
      var contents = (order.items || []).map(function (i) {
        return { content_id: catalogSku(i.productId, i.finish), quantity: i.qty };
      });
      var metaContents = (order.items || []).map(function (i) {
        return { id: catalogSku(i.productId, i.finish), quantity: Number(i.qty), item_price: Number(i.price) };
      });
      var total = parseFloat(order.total) || 0;

      // TikTok Manual Advanced Matching — must run before CompletePayment so the
      // identity signal is attached to the event. ttq.identify() accepts plain text;
      // the TikTok SDK hashes email/phone before transmitting.
      if (w.ttq && typeof w.ttq.identify === 'function') {
        var custEmail = ((order.customer && order.customer.email) || '').trim().toLowerCase();
        var custPhone = normalizePhone(
          (order.customer && order.customer.phone) || '',
          (order.shipping && order.shipping.countryCode) || ''
        );
        var idPayload = {};
        if (custEmail) idPayload.email = custEmail;
        if (custPhone) idPayload.phone_number = custPhone;
        if (custEmail || custPhone) { w.ttq.identify(idPayload); }
      }

      fbq('track', 'Purchase', {
        value:        total,
        currency:     'EGP',
        content_ids:  ids,
        contents:     metaContents,
        content_type: 'product',
        num_items:    num,
        order_id:     order.orderId
      }, { eventID: order.orderId }); // enables Meta deduplication against server CAPI event
      ttq('CompletePayment', {
        content_id:   ids[0] || '',
        content_type: 'product',
        quantity:     num,
        value:        total,
        currency:     'EGP',
        contents:     contents
      });
    }

  };

}(window));
