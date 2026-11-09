function findBySku(rows, sku) {
  return rows.find(row => row.sku === sku) ?? null;
}

module.exports = { findBySku };
