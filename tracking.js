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

  // Normalizes Egyptian mobile numbers to E.164 (+201XXXXXXXXX).
  // Returns an empty string for inputs that cannot be resolved to a valid Egyptian mobile.
  function normalizeEgyptianPhone(raw) {
    if (!raw) return '';
    // Strip all formatting characters (spaces, hyphens, parentheses, dots, etc.)
    // while preserving a leading + if present.
    var s = raw.replace(/[^+\d]/g, '');
    // Translate 00-prefixed international dialing (0020...) to + notation (+20...)
    if (s.indexOf('00') === 0) { s = '+' + s.slice(2); }
    // Work on the pure digit string (without the + prefix)
    var digits = (s.charAt(0) === '+') ? s.slice(1) : s;
    // Prepend Egyptian country code when it is absent
    if (digits.indexOf('20') === 0) {
      // Already carries country code: 201012345678 or 20 101 234 5678 stripped
    } else if (digits.charAt(0) === '0') {
      // Local format (11 digits, leading 0): 01012345678 → 201012345678
      digits = '20' + digits.slice(1);
    }
    var e164 = '+' + digits;
    // Valid Egyptian mobile E.164: +20 followed by exactly 10 digits starting with 1
    // (covers all operators: 010 Vodafone, 011 Etisalat/e&, 012 Orange, 015 WE)
    return /^\+201\d{9}$/.test(e164) ? e164 : '';
  }

  w.SunnyTracking = {

    // Fired on every product detail page after the product data is loaded
    viewContent: function (id, name, price) {
      price = parseFloat(price) || 0;
      fbq('track', 'ViewContent', {
        content_ids:  [id],
        content_name: name,
        content_type: 'product',
        value:        price,
        currency:     'EGP'
      });
      ttq('ViewContent', {
        content_id:   id,
        content_name: name,
        content_type: 'product',
        quantity:     1,
        value:        price,
        currency:     'EGP'
      });
    },

    // Fired when "Add to Cart" is clicked
    addToCart: function (id, name, price) {
      price = parseFloat(price) || 0;
      fbq('track', 'AddToCart', {
        content_ids:  [id],
        content_name: name,
        content_type: 'product',
        value:        price,
        currency:     'EGP'
      });
      ttq('AddToCart', {
        content_id:   id,
        content_name: name,
        content_type: 'product',
        quantity:     1,
        value:        price,
        currency:     'EGP'
      });
    },

    // Fired on checkout.html load (covers both Add-to-Cart and Buy-Now flows)
    // items: array of { productId, name, price, qty }
    initiateCheckout: function (items) {
      var total = items.reduce(function (s, i) { return s + (i.price * i.qty); }, 0);
      var ids   = items.map(function (i) { return i.productId; });
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
    // order: { orderId, total, items: [{ productId, name, price, qty }] }
    purchase: function (order) {
      var key = 'px_purchased_' + order.orderId;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');

      var ids      = (order.items || []).map(function (i) { return i.productId; });
      var num      = (order.items || []).reduce(function (s, i) { return s + i.qty; }, 0);
      var contents = (order.items || []).map(function (i) {
        return { content_id: i.productId, quantity: i.qty };
      });
      var total = parseFloat(order.total) || 0;

      // TikTok Manual Advanced Matching — must run before CompletePayment so the
      // identity signal is attached to the event. ttq.identify() accepts plain text;
      // the TikTok SDK hashes email/phone before transmitting.
      if (w.ttq && typeof w.ttq.identify === 'function') {
        var custEmail = ((order.customer && order.customer.email) || '').trim().toLowerCase();
        var custPhone = normalizeEgyptianPhone((order.customer && order.customer.phone) || '');
        var idPayload = {};
        if (custEmail) idPayload.email = custEmail;
        if (custPhone) idPayload.phone_number = custPhone;
        if (custEmail || custPhone) { w.ttq.identify(idPayload); }
      }

      fbq('track', 'Purchase', {
        value:        total,
        currency:     'EGP',
        content_ids:  ids,
        content_type: 'product',
        num_items:    num,
        order_id:     order.orderId
      });
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
