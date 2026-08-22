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
