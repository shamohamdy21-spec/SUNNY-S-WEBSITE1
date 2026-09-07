// generate-tiktok-catalog.mjs
// Generates sunnys-tiktok-catalog.csv matching TikTok's catalog feed template.
// sku_id values match TikTok Pixel content_id exactly.
// Run: node generate-tiktok-catalog.mjs

import { writeFileSync } from 'fs';

const BASE = 'https://sunnys.community';

// ── Product data ─────────────────────────────────────────────────────────────
// Source: admin.html PRODUCTS_DB + product-detail.html PRODUCTS object.
// price    = original/full price (shown as strikethrough on site)
// salePrice = current selling price (what customers pay)
// img1     = main image (image_link)
// img2     = second image (additional_image_link)
// sku_id MUST match TikTok Pixel content_id — verified against tracking.js

const PRODUCTS = [
  {
    id: 'noir',
    name: 'The Noir',
    price: 3000,
    salePrice: 2000,
    color: 'Black',
    img1: 'brand_assets/brand%20assets%202/20DC2642-C5AC-4FC7-A06C-637AE1E41B63.jpeg',
    img2: 'brand_assets/brand%20assets%202/0657C550-9A3B-4107-AE70-88C8EE590015.png',
    description: 'Matte black Italian acetate sunglasses with dark smoke CR-39 lenses, UV400 Category 4 maximum glare protection, natural gemstone accents, and braided copper chain temples with a luxurious gold-tone finish.',
  },
  {
    id: 'rose',
    name: 'The Citrine',
    price: 2800,
    salePrice: 1800,
    color: 'Rose',
    img1: 'brand_assets/brand%20assets%202/AC8B2426-38D5-4750-9537-F7AAA0655CF9.jpeg',
    img2: 'brand_assets/brand%20assets%202/530BABA6-D93E-42F2-8955-544D3C1BE712.png',
    description: 'Blush pink acetate sunglasses with rose gradient lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples with a luxurious gold-tone finish.',
  },
  {
    id: 'citrine',
    name: 'The Champagne',
    price: 2800,
    salePrice: 1800,
    color: 'Amber',
    img1: 'brand_assets/brand%20assets%202/DDCA0B31-EFD6-4E36-A832-EBBFF14AF74A.png',
    img2: 'brand_assets/brand%20assets%202/90C4A8D8-AB03-4AEE-B66E-A4C93A1B5E6E.png',
    description: 'Amber-tinted acetate sunglasses with amber gradient CR-39 anti-reflective lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples with a luxurious gold-tone finish.',
  },
  {
    id: 'aurelia',
    name: 'The Ruby',
    price: 3200,
    salePrice: 2200,
    color: 'Gold',
    img1: 'brand_assets/brand%20assets%202/1E5D59D1-C541-4C32-B169-B6C037499F40.png',
    img2: 'brand_assets/brand%20assets%202/E1A284CB-62E4-466E-B2C5-79050DF9554E.png',
    description: 'Polished gold hand-finished acetate sunglasses with warm amber CR-39 UV400 lenses, Category 3 protection, natural gemstone accents, and braided copper chain temples with a luxurious gold-tone finish.',
  },
  {
    id: 'solene',
    name: 'The Maldives',
    price: 3000,
    salePrice: 2000,
    color: 'Ivory',
    img1: 'brand_assets/brand%20assets%202/C50452E7-BB21-4DAB-BBF5-2AC38DA0FF09.png',
    img2: 'brand_assets/brand%20assets%202/F7D8666D-B57B-4A8D-813D-10B746BCB3F7.png',
    description: 'Ivory acetate sunglasses with brushed gold temple detail, soft brown gradient CR-39 lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples.',
  },
  {
    id: 'celeste',
    name: 'The Opaline',
    price: 3200,
    salePrice: 2200,
    color: 'White',
    img1: 'brand_assets/brand%20assets%202/8C2831C2-A8E1-43CE-B1C8-97F110DEA8DC.jpeg',
    img2: 'brand_assets/brand%20assets%202/01070F7C-5529-44BA-98C5-EC565A30E07A.png',
    description: 'Pearl white lightweight Italian acetate sunglasses with grey gradient anti-reflective CR-39 lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples.',
  },
  {
    id: 'verona',
    name: 'The Honey Quartz',
    price: 2800,
    salePrice: 1800,
    color: 'Tortoise',
    img1: 'brand_assets/brand%20assets%202/8D1FBDA8-7C41-479C-B5A5-68518C8C9474.png',
    img2: 'brand_assets/brand%20assets%202/C40AF091-BC10-47E2-AFF7-BB34D08208FA.png',
    description: 'Deep tortoise acetate sunglasses with gold inlay, brown polarized CR-39 lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples with a luxurious gold-tone finish.',
  },
  {
    id: 'riviera',
    name: 'The Golden Aura',
    price: 3200,
    salePrice: 2200,
    color: 'Sand',
    img1: 'brand_assets/brand%20assets%202/525E93BD-D8BB-405D-B5DA-F24D7D86158B.jpeg',
    img2: 'brand_assets/brand%20assets%202/F489181E-B43B-4088-9D32-023B592DAB01.png',
    description: 'Translucent sand resort-ready acetate sunglasses with blue mirror polarized CR-39 lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples with a luxurious gold-tone finish.',
  },
  {
    id: 'siena',
    name: 'The Eclipse',
    price: 2800,
    salePrice: 1800,
    color: 'Terracotta',
    img1: 'brand_assets/brand%20assets%202/6599B5D7-1468-46B9-B5E6-6178775530B0.png',
    img2: 'brand_assets/brand%20assets%202/19C9BD28-199D-4165-AB84-703580536AE9.png',
    description: 'Terracotta acetate sunglasses with gold-tone hardware, warm copper gradient CR-39 lenses, UV400 Category 3 protection, natural gemstone accents, and braided copper chain temples.',
  },
  {
    id: 'lumiere',
    name: 'The Obsidian Noir',
    price: 3000,
    salePrice: 2000,
    color: 'Clear',
    img1: 'brand_assets/brand%20assets%202/F8D0426E-A7B2-499B-B07E-81BC8ABD46FA.jpeg',
    img2: 'brand_assets/brand%20assets%202/51D0502D-194A-47D6-AA26-5F855C2EFCAA.png',
    description: 'Crystal clear luminous ultra-light acetate sunglasses with light gold tint UV400 CR-39 lenses, Category 2 soft light filtration, natural gemstone accents, and braided copper chain temples.',
  },
  {
    id: 'sunnys-product-11',
    name: 'The Sienna',
    price: 3200,
    salePrice: 2200,
    color: 'Sienna',
    img1: 'brand_assets/ba4/9D2E5C24-BB39-43D2-BA25-E54DA9654AF4.png',
    img2: 'brand_assets/ba4/BF2A5AED-92EF-4847-995E-50B933DA1847.png',
    description: "Luxury acetate sunglasses from Sunny's Core Collection with UV400 protection, natural gemstone accents, and braided copper chain temples with a luxurious gold-tone finish.",
  },
  {
    id: 'sunnys-product-12',
    name: 'The Ambré',
    price: 3000,
    salePrice: 2000,
    color: 'Amber',
    img1: 'brand_assets/ba4/2B73842E-BE64-4961-8308-1598094EECDE.png',
    img2: 'brand_assets/ba4/560313B6-E50D-4333-9233-197D54034C83.png',
    description: "Luxury acetate sunglasses from Sunny's Core Collection with UV400 protection, natural gemstone accents, and braided copper chain temples with a luxurious gold-tone finish.",
  },
  {
    id: 'sunnys-product-13',
    name: 'The Verdant',
    price: 2800,
    salePrice: 1800,
    color: 'Green',
    img1: 'brand_assets/ba4/795AD56A-255D-4CE0-8983-642E44F46A80.png',
    img2: 'brand_assets/ba4/15FD2A0B-435B-4B49-A004-D08CB8CA25E5.png',
    description: "Luxury acetate sunglasses from Sunny's Core Collection with UV400 protection, natural gemstone accents, and braided copper chain temples with a luxurious gold-tone finish.",
  },
  {
    id: 'sunnys-product-14',
    name: 'The Lavande',
    price: 3000,
    salePrice: 2000,
    color: 'Lavender',
    img1: 'brand_assets/ba4/B971C461-B582-4FD5-BA0D-4E1C98A2F2EA.png',
    img2: 'brand_assets/ba4/AB12C5A2-171F-4D41-BC74-1051BFFA0016.png',
    description: "Luxury acetate sunglasses from Sunny's Core Collection with UV400 protection, natural gemstone accents, and braided copper chain temples with a luxurious gold-tone finish.",
  },
];

// ── CSV helpers ───────────────────────────────────────────────────────────────
function q(val) {
  // RFC 4180 quoting: wrap in double-quotes if value contains comma, quote, or newline
  const s = val === null || val === undefined ? '' : String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function row(...cells) {
  return cells.map(q).join(',');
}

// ── TikTok template columns (exact order from template) ──────────────────────
const HEADER = [
  'sku_id','title','description','availability','condition','price',
  'link','image_link','brand','video_link','additional_image_link',
  'age_group','color','gender','item_group_id','google_product_category',
  'material','pattern','product_type','sale_price','sale_price_effective_date',
  'shipping','shipping_weight','gtin','mpn','size','tax',
  'ios_url','ios_app_store_id','ios_app_name',
  'iPhone_url','iPhone_app_store_id','iPhone_app_name',
  'iPad_url','iPad_app_store_id','iPad_app_name',
  'android_url','android_package','android_app_name',
  'custom_label_0','custom_label_1','custom_label_2','custom_label_3','custom_label_4',
];

const GOOGLE_CAT = 'Apparel & Accessories > Clothing Accessories > Sunglasses';
const PRODUCT_TYPE = 'Apparel & Accessories > Sunglasses';

const lines = [HEADER.join(',')];

for (const p of PRODUCTS) {
  const link       = `${BASE}/product-detail.html?p=${p.id}`;
  const imageLink  = `${BASE}/${p.img1}`;
  const addImg     = `${BASE}/${p.img2}`;
  const price      = `${p.price} EGP`;
  const salePrice  = `${p.salePrice} EGP`;

  lines.push(row(
    p.id,           // sku_id — matches TikTok Pixel content_id
    p.name,         // title
    p.description,  // description
    'in stock',     // availability
    'new',          // condition
    price,          // price (original/full)
    link,           // link
    imageLink,      // image_link
    "Sunny's",      // brand
    '',             // video_link
    addImg,         // additional_image_link
    'adult',        // age_group
    p.color,        // color
    'unisex',       // gender
    '',             // item_group_id
    GOOGLE_CAT,     // google_product_category
    'acetate',      // material
    '',             // pattern
    PRODUCT_TYPE,   // product_type
    salePrice,      // sale_price
    '',             // sale_price_effective_date
    '',             // shipping
    '',             // shipping_weight
    '',             // gtin
    '',             // mpn
    '',             // size
    '',             // tax
    '',             // ios_url
    '',             // ios_app_store_id
    '',             // ios_app_name
    '',             // iPhone_url
    '',             // iPhone_app_store_id
    '',             // iPhone_app_name
    '',             // iPad_url
    '',             // iPad_app_store_id
    '',             // iPad_app_name
    '',             // android_url
    '',             // android_package
    '',             // android_app_name
    '',             // custom_label_0
    '',             // custom_label_1
    '',             // custom_label_2
    '',             // custom_label_3
    '',             // custom_label_4
  ));
}

// UTF-8 BOM so accented characters (The Ambré) render correctly
const output = '﻿' + lines.join('\n');
writeFileSync('sunnys-tiktok-catalog.csv', output, 'utf8');

// ── Validation ────────────────────────────────────────────────────────────────
console.log('\n=== VALIDATION ===\n');
const dataRows = lines.slice(1);
const seenIds = new Set();
let errors = 0;

for (let i = 0; i < dataRows.length; i++) {
  const cols = dataRows[i].split(',');
  // sku_id is always unquoted for our data
  const skuId = cols[0];
  const title  = dataRows[i].includes('"') ? '(quoted)' : cols[1];

  if (seenIds.has(skuId)) { console.log(`✗ Row ${i+2}: duplicate sku_id "${skuId}"`); errors++; }
  seenIds.add(skuId);

  // price column (index 5) — just check it ends with EGP
  const priceCol = dataRows[i].match(/,(\d+ EGP),https:\/\//);
  if (!priceCol) { console.log(`✗ Row ${i+2} (${skuId}): price format problem`); errors++; }

  // link must start with https://sunnys.community/product-detail.html?p=
  if (!dataRows[i].includes(`https://sunnys.community/product-detail.html?p=${skuId}`)) {
    console.log(`✗ Row ${i+2} (${skuId}): product link missing or mismatched`); errors++;
  }

  // image_link must be on sunnys.community
  if (!dataRows[i].includes('https://sunnys.community/brand_assets/')) {
    console.log(`✗ Row ${i+2} (${skuId}): image_link not on sunnys.community`); errors++;
  }

  // sale_price must be present and lower than price
  const prices = [...dataRows[i].matchAll(/(\d+) EGP/g)].map(m => parseInt(m[1]));
  if (prices.length < 2) { console.log(`✗ Row ${i+2} (${skuId}): expected 2 EGP prices, found ${prices.length}`); errors++; }
  else if (prices[1] >= prices[0]) { console.log(`✗ Row ${i+2} (${skuId}): sale_price (${prices[1]}) >= price (${prices[0]})`); errors++; }
}

console.log(`Products: ${dataRows.length}`);
console.log(`Columns:  ${HEADER.length}`);
console.log(`Errors:   ${errors}`);
if (errors === 0) console.log('\nValidation PASSED ✓\n');

// ── Preview first 3 data rows ─────────────────────────────────────────────────
console.log('=== PREVIEW (header + first 3 rows) ===\n');
lines.slice(0, 4).forEach((l, i) => {
  const label = i === 0 ? 'HEADER' : `ROW ${i}`;
  console.log(`[${label}]`);
  // Print first 10 fields for readability
  const fields = l.split(',');
  const fieldNames = HEADER;
  fields.slice(0, 10).forEach((f, fi) => {
    console.log(`  ${fieldNames[fi]}: ${f}`);
  });
  console.log('  ...');
  console.log('');
});
