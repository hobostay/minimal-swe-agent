const { test } = require("node:test");
const assert = require("node:assert/strict");
const { findBySku } = require("./inventory.cjs");

test("default lookup is case-sensitive", () => {
  const row = { sku: "ab-1", stock: 8 };
  assert.equal(findBySku([row], "ab-1"), row);
  assert.equal(findBySku([row], "AB-1"), null);
});

test("optional lookup ignores case and returns the first match", () => {
  const first = { sku: "ab-1", stock: 8 };
  const second = { sku: "AB-1", stock: 3 };
  assert.equal(findBySku([first, second], "Ab-1", { ignoreCase: true }), first);
});
