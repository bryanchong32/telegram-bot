/**
 * Product catalog for Order Entry Bot.
 * Maps Chinese/English name variations → base product code,
 * then builds SKU → price lookup.
 *
 * 5 product families × 6 sizes (1-6 bottles) = 30 SKUs.
 */

// Chinese/English name variations → base product code
const PRODUCT_NAME_MAP = {
  // HMG — HOMEGA (Fish Oil)
  '魚油王': 'HMG',
  '鱼油王': 'HMG',
  'HOMEGA': 'HMG',
  'homega': 'HMG',
  'Homega': 'HMG',
  'HMG': 'HMG',
  'hmg': 'HMG',

  // TMK — Tigrox (Tiger Milk Mushroom)
  '虎乳芝': 'TMK',
  'Tigrox': 'TMK',
  'tigrox': 'TMK',
  'TIGROX': 'TMK',
  'TMK': 'TMK',
  'tmk': 'TMK',

  // BLZ — Bio-Lingzhi (Lingzhi)
  '靈芝王': 'BLZ',
  '灵芝王': 'BLZ',
  '靈芝': 'BLZ',
  'Bio-Lingzhi': 'BLZ',
  'bio-lingzhi': 'BLZ',
  'BIO靈芝王': 'BLZ',
  'BLZ': 'BLZ',
  'blz': 'BLZ',

  // BGS — Bio Grape Seed
  '葡萄籽': 'BGS',
  'Bio Grape Seed': 'BGS',
  'bio grape seed': 'BGS',
  'grape seed': 'BGS',
  'BGS': 'BGS',
  'bgs': 'BGS',

  // ERJ — Erojan
  '男士寳': 'ERJ',
  '男士宝': 'ERJ',
  'Erojan': 'ERJ',
  'erojan': 'ERJ',
  'EROJAN': 'ERJ',
  'ERJ': 'ERJ',
  'erj': 'ERJ',
};

// Display name prefixes per product family
const DISPLAY_PREFIX = {
  HMG: 'HOMEGA',
  TMK: 'Tigrox',
  BLZ: 'Bio-Lingzhi',
  BGS: 'Bio Grape Seed',
  ERJ: 'Erojan',
};

// Prices per family, indexed by quantity (1-6)
const PRICE_TABLE = {
  HMG: [700, 1150, 1650, 2150, 2600, 3000],
  TMK: [700, 1150, 1650, 2150, 2600, 3000],
  BLZ: [550, 1000, 1400, 1850, 2300, 2700],
  BGS: [550, 1000, 1400, 1850, 2300, 2700],
  ERJ: [600, 1050, 1400, 1850, 2300, 2700],
};

// Build full PRODUCTS lookup: SKU → { price_hkd, display }
const PRODUCTS = {};
for (const [code, prices] of Object.entries(PRICE_TABLE)) {
  for (let qty = 1; qty <= 6; qty++) {
    const sku = `${qty}${code}`;
    PRODUCTS[sku] = {
      price_hkd: prices[qty - 1],
      display: `${DISPLAY_PREFIX[code]} ${qty}樽`,
    };
  }
}

/**
 * Resolve a product name + quantity into SKU, price, and display name.
 *
 * @param {string} productName — Chinese or English product name
 * @param {number} quantity — number of bottles (1-6)
 * @returns {{ sku: string, price_hkd: number, display: string } | null}
 */
function resolveProduct(productName, quantity) {
  if (!productName || !quantity || quantity < 1 || quantity > 6) return null;

  // 1. Try exact match
  let baseCode = PRODUCT_NAME_MAP[productName];

  // 2. If no exact match, try case-insensitive partial match
  if (!baseCode) {
    const lower = productName.toLowerCase();
    for (const [key, code] of Object.entries(PRODUCT_NAME_MAP)) {
      if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
        baseCode = code;
        break;
      }
    }
  }

  if (!baseCode) return null;

  // 3. Build SKU
  const sku = `${quantity}${baseCode}`;

  // 4. Look up in PRODUCTS
  const product = PRODUCTS[sku];
  if (!product) return null;

  return { sku, price_hkd: product.price_hkd, display: product.display };
}

module.exports = { PRODUCT_NAME_MAP, PRODUCTS, DISPLAY_PREFIX, PRICE_TABLE, resolveProduct };
