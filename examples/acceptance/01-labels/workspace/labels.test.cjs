const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseLabels } = require("./labels.cjs");

test("discards blank segments after trimming", () => {
  assert.deepEqual(parseLabels("alpha, , beta,\t,gamma"), ["alpha", "beta", "gamma"]);
});

test("preserves order, casing, and duplicates", () => {
  assert.deepEqual(parseLabels(" X,x,X "), ["X", "x", "X"]);
});

test("returns no labels for empty input", () => {
  assert.deepEqual(parseLabels(""), []);
});
