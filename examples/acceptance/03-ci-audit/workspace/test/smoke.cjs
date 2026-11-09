const { test } = require("node:test");
const assert = require("node:assert/strict");

test("smoke check", () => assert.equal(process.version.startsWith("v"), true));
