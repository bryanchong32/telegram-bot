/**
 * Google Sheets column mapping for Order Entry Bot.
 * Matches the actual sheet column order (A → X).
 *
 * IMPORTANT: Columns L–P have formulas — bot must NOT write to them.
 * We split writes into two ranges: A:K and Q:X.
 */

/**
 * Build the A:K portion of the row (before formula columns).
 * @param {object} order
 * @returns {string[]}
 */
function buildRowPartA(order) {
  return [
    order.region || '',                  // A: Region
    '',                                  // B: First/Repeat? — left empty
    '',                                  // C: Enquiry Date — left empty
    order.order_date || '',              // D: Order Date
    order.pain_point || '',              // E: Pain Point + Remark
    order.customer_name || '',           // F: Customer Name
    order.phone || '',                   // G: Contact Number
    order.address || '',                 // H: Address
    order.product_string || '',          // I: Product
    '',                                  // J: Quantity — left empty
    order.selling_price || '',           // K: Selling Price (HKD)
  ];
}

/**
 * Build the Q:X portion of the row (after formula columns).
 * Skips L (PV), M (Commission), N (Promo Cost), O (Membership Cost), P (Cancellation Cost).
 * @param {object} order
 * @returns {string[]}
 */
function buildRowPartB(order) {
  return [
    order.courier || '',                 // Q: Courier
    order.order_id || '',                // R: Order ID (FIV5S app)
    '',                                  // S: Order Status — left empty
    '',                                  // T: Tracking Number — left empty
    '',                                  // U: Delivered Date — left empty
    '',                                  // V: Delivery Fee — left empty
    order.source_page || '',             // W: Sources (page)
    order.ad_source || '',               // X: Lead Gen Source (which ad?)
  ];
}

module.exports = { buildRowPartA, buildRowPartB };
