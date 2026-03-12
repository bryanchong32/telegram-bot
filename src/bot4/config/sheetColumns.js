/**
 * Google Sheets column mapping for Order Entry Bot.
 * Matches the exact column order from CRM's sheetSyncService.js.
 */

// Exact column headers in order (A → Q)
const COLUMNS = [
  'Region',                        // A
  'Contact Number',                // B
  'Order ID (FIV5S app)',          // C
  'Customer Name',                 // D
  'Address',                       // E
  'Pain Point + Remark',           // F
  'Sources (page)',                // G
  'Order Date',                    // H
  'Delivered Date',                // I
  'Order Status',                  // J
  'Selling Price (HKD)',           // K
  'PV',                            // L — sheet formula, leave empty
  'Commission (MYR)',              // M
  'Courier',                       // N
  'Tracking Number',               // O
  'Lead Gen Source (which ad?)',   // P
  'Product',                       // Q
];

/**
 * Build a row array from an order object, matching the sheet column order.
 *
 * Bot fills: Region, Customer Name, Contact Number, Order ID, Order Date,
 *            Product, Selling Price, Courier, Address, Pain Point + Remark,
 *            Sources (page), Lead Gen Source.
 *
 * Left empty (filled later or by sheet formula):
 *   PV, Order Status, Tracking Number, Delivered Date, Commission.
 *
 * @param {object} order
 * @returns {string[]} Row array matching COLUMNS order
 */
function buildSheetRow(order) {
  return [
    order.region || '',                  // A: Region
    order.contact_number || '',          // B: Contact Number
    order.order_id || '',                // C: Order ID (FIV5S app)
    order.customer_name || '',           // D: Customer Name
    order.address || '',                 // E: Address
    order.pain_point || '',              // F: Pain Point + Remark
    order.sources || '',                 // G: Sources (page)
    order.order_date || '',              // H: Order Date
    '',                                  // I: Delivered Date — left empty
    '',                                  // J: Order Status — left empty
    order.selling_price || '',           // K: Selling Price (HKD)
    '',                                  // L: PV — sheet formula
    '',                                  // M: Commission (MYR) — left empty
    order.courier || '',                 // N: Courier
    '',                                  // O: Tracking Number — left empty
    order.lead_gen_source || '',         // P: Lead Gen Source (which ad?)
    order.product || '',                 // Q: Product
  ];
}

module.exports = { COLUMNS, buildSheetRow };
