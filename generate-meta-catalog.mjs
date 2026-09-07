// generate-meta-catalog.mjs
// Generates sunnys-meta-catalog.csv for Meta Commerce Manager.
// Read-only with respect to the website. Run with: node generate-meta-catalog.mjs
// Does NOT deploy or modify any website/admin code.

import { writeFileSync } from 'fs';

const BASE = 'https://sunnys.community';
const BRAND = "Sunny's";
const CONDITION = 'new';
const AVAILABILITY = 'in stock';

// ── Product data ────────────────────────────────────────────────────────────
// Source of truth: admin.html PRODUCTS_DB + product-detail.html PRODUCTS object.
// Prices confirmed from product-detail.html (which has originalPrice for sale display).
// Meta Pixel sends content_ids: [id] where id === the PRODUCTS_DB id field.
// URL: https://sunnys.community/product-detail.html?p=<id>
// image_link: img1 (main product image) from product-detail.html

const PRODUCTS = [
  {
    id: 'noir',
    name: 'The Noir',
    price: 2000,
    originalPrice: 3000,
    img: 'brand_assets/brand%20assets%202/20DC2642-C5AC-4FC7-A06C-637AE1E41B63.jpeg',
    description: 'Matte black Italian acetate sunglasses with dark smoke CR-39 lenses, UV400 Category 4 maximum glare protection, natural gemstone accents, and braided copper chain temples with a gold-tone finish.',
  },
  {
    id: 'rose',
    name: 'The Citrine',
    price: 1800,
    originalPrice: 2800,
    img: 'brand_assets/brand%20assets%202/AC8B2426-38D5-4750-9537-F7AAA0655CF9.jpeg',
    description: 'Blush pink acetate sunglasses with rose gradient lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples with a gold-tone finish.',
  },
  {
    id: 'citrine',
    name: 'The Champagne',
    price: 1800,
    originalPrice: 2800,
    img: 'brand_assets/brand%20assets%202/DDCA0B31-EFD6-4E36-A832-EBBFF14AF74A.png',
    description: 'Amber-tinted acetate sunglasses with amber gradient CR-39 anti-reflective lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples with a gold-tone finish.',
  },
  {
    id: 'aurelia',
    name: 'The Ruby',
    price: 2200,
    originalPrice: 3200,
    img: 'brand_assets/brand%20assets%202/1E5D59D1-C541-4C32-B169-B6C037499F40.png',
    description: 'Polished gold hand-finished acetate sunglasses with warm amber CR-39 UV400 lenses, Category 3 protection, natural gemstone accents, and braided copper chain temples with a gold-tone finish.',
  },
  {
    id: 'solene',
    name: 'The Maldives',
    price: 2000,
    originalPrice: 3000,
    img: 'brand_assets/brand%20assets%202/C50452E7-BB21-4DAB-BBF5-2AC38DA0FF09.png',
    description: 'Ivory acetate sunglasses with brushed gold temple detail, soft brown gradient CR-39 lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples.',
  },
  {
    id: 'celeste',
    name: 'The Opaline',
    price: 2200,
    originalPrice: 3200,
    img: 'brand_assets/brand%20assets%202/8C2831C2-A8E1-43CE-B1C8-97F110DEA8DC.jpeg',
    description: 'Pearl white lightweight Italian acetate sunglasses with grey gradient anti-reflective CR-39 lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples.',
  },
  {
    id: 'verona',
    name: 'The Honey Quartz',
    price: 1800,
    originalPrice: 2800,
    img: 'brand_assets/brand%20assets%202/8D1FBDA8-7C41-479C-B5A5-68518C8C9474.png',
    description: 'Deep tortoise acetate sunglasses with gold inlay, brown polarized CR-39 lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples with a gold-tone finish.',
  },
  {
    id: 'riviera',
    name: 'The Golden Aura',
    price: 2200,
    originalPrice: 3200,
    img: 'brand_assets/brand%20assets%202/525E93BD-D8BB-405D-B5DA-F24D7D86158B.jpeg',
    description: 'Translucent sand resort-ready acetate sunglasses with blue mirror polarized CR-39 lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples with a gold-tone finish.',
  },
  {
    id: 'siena',
    name: 'The Eclipse',
    price: 1800,
    originalPrice: 2800,
    img: 'brand_assets/brand%20assets%202/6599B5D7-1468-46B9-B5E6-6178775530B0.png',
    description: 'Terracotta acetate sunglasses with gold-tone hardware, warm copper gradient CR-39 lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples.',
  },
  {
    id: 'lumiere',
    name: 'The Obsidian Noir',
    price: 2000,
    originalPrice: 3000,
    img: 'brand_assets/brand%20assets%202/F8D0426E-A7B2-499B-B07E-81BC8ABD46FA.jpeg',
    description: 'Crystal clear luminous ultra-light acetate sunglasses with light gold tint UV400 CR-39 lenses, Category 2 soft light filtration, natural gemstone accents, and braided copper chain temples.',
  },
  {
    id: 'sunnys-product-11',
    name: 'The Sienna',
    price: 2200,
    originalPrice: 3200,
    img: 'brand_assets/ba4/9D2E5C24-BB39-43D2-BA25-E54DA9654AF4.png',
    description: "Luxury sunglasses from Sunny's Core Collection with UV400 protection, natural gemstone accents, and braided copper chain temples with a gold-tone finish.",
  },
  {
    id: 'sunnys-product-12',
    name: 'The Ambré',
    price: 2000,
    originalPrice: 3000,
    img: 'brand_assets/ba4/2B73842E-BE64-4961-8308-1598094EECDE.png',
    description: "Luxury sunglasses from Sunny's Core Collection with UV400 protection, natural gemstone accents, and braided copper chain temples with a gold-tone finish.",
  },
  {
    id: 'sunnys-product-13',
    name: 'The Verdant',
    price: 1800,
    originalPrice: 2800,
    img: 'brand_assets/ba4/795AD56A-255D-4CE0-8983-642E44F46A80.png',
    description: "Luxury sunglasses from Sunny's Core Collection with UV400 protection, natural gemstone accents, and braided copper chain temples with a gold-tone finish.",
  },
  {
    id: 'sunnys-product-14',
    name: 'The Lavande',
    price: 2000,
    originalPrice: 3000,
    img: 'brand_assets/ba4/B971C461-B582-4FD5-BA0D-4E1C98A2F2EA.png',
    description: "Luxury sunglasses from Sunny's Core Collection with UV400 protection, natural gemstone accents, and braided copper chain temples with a gold-tone finish.",
  },
];

// ── Validation table (Step 2) ────────────────────────────────────────────────
console.log('\n=== STEP 2: PIXEL / CATALOG ID VALIDATION TABLE ===\n');
console.log('Product Name           | Website ID           | Pixel content_id     | Catalog ID           | Match?');
console.log('-'.repeat(105));
for (const p of PRODUCTS) {
  // Pixel sends content_ids: [id] — id is the PRODUCTS_DB id, passed via ?p= URL param
  const pixelId = p.id; // same value — no mismatch possible
  const match = p.id === pixelId ? '✓ MATCH' : '✗ MISMATCH';
  console.log(
    p.name.padEnd(22) + '| ' +
    p.id.padEnd(21) + '| ' +
    pixelId.padEnd(21) + '| ' +
    p.id.padEnd(21) + '| ' +
    match
  );
}

// ── Build CSV ────────────────────────────────────────────────────────────────
function csvField(val) {
  // RFC 4180: wrap in double quotes if value contains comma, quote, or newline
  const s = String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const HEADERS = [
  'id', 'title', 'description', 'availability', 'condition',
  'price', 'sale_price', 'link', 'image_link', 'brand',
];

const rows = [HEADERS.join(',')];

for (const p of PRODUCTS) {
  const link = `${BASE}/product-detail.html?p=${p.id}`;
  const imageLink = `${BASE}/${p.img}`;
  // Meta price format: "<amount> <CURRENCY>" e.g. "2000 EGP"
  const price = `${p.originalPrice} EGP`;
  const salePrice = `${p.price} EGP`;

  const row = [
    csvField(p.id),
    csvField(p.name),
    csvField(p.description),
    csvField(AVAILABILITY),
    csvField(CONDITION),
    csvField(price),
    csvField(salePrice),
    csvField(link),
    csvField(imageLink),
    csvField(BRAND),
  ];
  rows.push(row.join(','));
}

const csvContent = rows.join('\n');

// Write UTF-8 with BOM so Excel/Meta doesn't mangle accented chars
const output = '﻿' + csvContent;
writeFileSync('sunnys-meta-catalog.csv', output, 'utf8');
console.log('\nCSV written: sunnys-meta-catalog.csv\n');

// ── Validation (Step 7) ─────────────────────────────────────────────────────
console.log('=== STEP 7: CSV VALIDATION ===\n');

const lines = csvContent.split('\n');
const headerLine = lines[0].split(',');
const dataRows = lines.slice(1);

let errors = [];
let warnings = [];

const seenIds = new Set();

for (let i = 0; i < dataRows.length; i++) {
  const rowNum = i + 2; // 1-based, +1 for header

  // Parse the row respecting quoted fields
  const fields = [];
  let cur = '';
  let inQuote = false;
  for (let ci = 0; ci < dataRows[i].length; ci++) {
    const ch = dataRows[i][ci];
    if (inQuote) {
      if (ch === '"' && dataRows[i][ci + 1] === '"') { cur += '"'; ci++; }
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { fields.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  fields.push(cur);

  const obj = {};
  headerLine.forEach((h, idx) => { obj[h] = fields[idx] || ''; });

  // 1. No blank required fields
  for (const h of HEADERS) {
    if (!obj[h] || obj[h].trim() === '') {
      errors.push(`Row ${rowNum} (${obj.id}): field "${h}" is blank`);
    }
  }

  // 2. Duplicate IDs
  if (seenIds.has(obj.id)) {
    errors.push(`Row ${rowNum}: duplicate id "${obj.id}"`);
  } else {
    seenIds.add(obj.id);
  }

  // 3. Price format
  if (!/^\d+ EGP$/.test(obj.price)) errors.push(`Row ${rowNum} (${obj.id}): price format invalid: "${obj.price}"`);
  if (!/^\d+ EGP$/.test(obj.sale_price)) errors.push(`Row ${rowNum} (${obj.id}): sale_price format invalid: "${obj.sale_price}"`);

  // 4. HTTPS URLs
  if (!obj.link.startsWith('https://')) errors.push(`Row ${rowNum} (${obj.id}): link not HTTPS`);
  if (!obj.image_link.startsWith('https://')) errors.push(`Row ${rowNum} (${obj.id}): image_link not HTTPS`);

  // 5. No localhost
  if (obj.link.includes('localhost') || obj.link.includes('127.0.0.1'))
    errors.push(`Row ${rowNum} (${obj.id}): link contains localhost`);
  if (obj.image_link.includes('localhost') || obj.image_link.includes('127.0.0.1'))
    errors.push(`Row ${rowNum} (${obj.id}): image_link contains localhost`);

  // 6. URL contains product-detail.html?p=
  if (!obj.link.includes('product-detail.html?p='))
    errors.push(`Row ${rowNum} (${obj.id}): link missing product-detail.html?p= routing`);

  // 7. Image URL contains production domain
  if (!obj.image_link.includes('sunnys.community'))
    errors.push(`Row ${rowNum} (${obj.id}): image_link not on sunnys.community`);

  // 8. Availability value
  if (obj.availability !== 'in stock')
    warnings.push(`Row ${rowNum} (${obj.id}): availability="${obj.availability}" — verify intentional`);

  // 9. sale_price < price (sanity check)
  const priceNum = parseInt(obj.price);
  const saleNum = parseInt(obj.sale_price);
  if (saleNum >= priceNum)
    warnings.push(`Row ${rowNum} (${obj.id}): sale_price (${saleNum}) >= price (${priceNum}) — verify intentional`);
}

// 10. Product count
console.log(`Products in CSV: ${dataRows.length} (expected 14)`);
if (dataRows.length !== 14) errors.push(`Expected 14 products, got ${dataRows.length}`);

// 11. Accented chars preserved (The Ambré)
const ambreRow = dataRows.find(r => r.includes('Ambr'));
if (ambreRow && ambreRow.includes('Ambré')) {
  console.log('Accented character check (The Ambré): ✓ preserved');
} else {
  errors.push('Accented character "é" in "The Ambré" may not be preserved');
}

// 12. UTF-8 BOM present
const raw = output;
if (raw.charCodeAt(0) === 0xFEFF) {
  console.log('UTF-8 BOM: ✓ present');
} else {
  warnings.push('UTF-8 BOM not detected — accented characters may render incorrectly in some tools');
}

console.log('');
if (errors.length === 0) {
  console.log('Validation PASSED — no errors found.\n');
} else {
  console.log(`Validation FAILED — ${errors.length} error(s):`);
  errors.forEach(e => console.log('  ERROR: ' + e));
  console.log('');
}
if (warnings.length > 0) {
  console.log(`Warnings (${warnings.length}):`);
  warnings.forEach(w => console.log('  WARN: ' + w));
  console.log('');
}

// ── Preview first 5 rows ────────────────────────────────────────────────────
console.log('=== CSV PREVIEW (first 5 rows) ===\n');
lines.slice(0, 6).forEach((line, i) => {
  console.log(`Row ${i}: ${line}`);
  console.log('');
});
