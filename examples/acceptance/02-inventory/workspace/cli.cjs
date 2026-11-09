const fs = require("node:fs");
const { findBySku } = require("./inventory.cjs");

const [file, sku, ...options] = process.argv.slice(2);
if (!file || !sku || options.length) {
  process.stderr.write("Usage: node cli.cjs <file> <sku>\n");
  process.exitCode = 2;
} else {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = findBySku(rows, sku);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result === null ? 1 : 0;
}
