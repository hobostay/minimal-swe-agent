import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cases = {
  "01-labels": ["labels.cjs"],
  "02-inventory": ["cli.cjs", "inventory.cjs"],
  "03-ci-audit": [],
};

function files(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) return files(path.join(directory, entry.name), name);
    assert.ok(entry.isFile(), `Unexpected non-regular file: ${name}`);
    return [name];
  }).sort();
}

function main() {
  const [name, target, output] = process.argv.slice(2);
  assert.ok(Object.hasOwn(cases, name) && target && output, "Usage: node judge.mjs <case> <workspace> <agent-output-file>");
  const original = fileURLToPath(new URL(`./${name}/workspace/`, import.meta.url));
  const cwd = path.resolve(target);
  const expected = files(original);
  assert.deepEqual(files(cwd), expected, "Unexpected files were added or removed");
  const changed = expected.filter(file => !readFileSync(path.join(original, file)).equals(readFileSync(path.join(cwd, file))));
  assert.deepEqual(changed, cases[name], "Modified files do not match the allowed scope");

  // This process is independent of the Agent and does not need a model key.
  const run = (args, status = 0) => {
    const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 10_000, env: {} });
    if (result.error) throw result.error;
    assert.equal(result.status, status, `${args.join(" ")}\n${result.stdout}${result.stderr}`);
    return result.stdout;
  };
  const extra = code => run(["--input-type=commonjs", "-e", `const assert = require('node:assert/strict');\n${code}`]);

  if (name === "01-labels") {
    process.stdout.write(run(["--test", "labels.test.cjs"]));
    extra(`
      const { parseLabels } = require('./labels.cjs');
      assert.deepEqual(parseLabels(' ,\\t,\\n,, '), []);
      assert.deepEqual(parseLabels(' ,z, a b , z, ,A'), ['z', 'a b', 'z', 'A']);
    `);
    console.log("2 additional label assertions passed.");
  } else if (name === "02-inventory") {
    process.stdout.write(run(["--test", "inventory.test.cjs"]));
    extra(`
      const { findBySku } = require('./inventory.cjs');
      const row = Object.freeze({ sku: 'Sku-X', stock: 2 });
      const rows = Object.freeze([row]);
      assert.equal(findBySku(rows, 'SKU-X', { ignoreCase: true }), row);
      assert.equal(findBySku(rows, 'SKU-X', { ignoreCase: false }), null);
      assert.equal(findBySku(rows, 'missing', { ignoreCase: true }), null);
    `);
    const lookup = (...args) => ["cli.cjs", "sample.json", ...args];
    assert.deepEqual(JSON.parse(run(lookup("AB-1"))), { sku: "AB-1", stock: 3 });
    assert.deepEqual(JSON.parse(run(lookup("AB-1", "--ignore-case"))), { sku: "ab-1", stock: 8 });
    assert.equal(JSON.parse(run(lookup("missing", "--ignore-case"), 1)), null);
    run(lookup("AB-1", "--unknown"), 2);
    console.log("3 additional library assertions and 4 CLI scenarios passed.");
  } else {
    const answer = readFileSync(output, "utf8");
    for (const evidence of [".github/workflows/ci.yml", "package.json", "npm run ci", "test/*.test.cjs", "test/smoke.cjs", "npm run smoke"]) {
      assert.ok(answer.includes(evidence), `Audit answer did not cite: ${evidence}`);
    }
    console.log("All 6 required audit references are present. Review the explanation against the task.");
  }
  console.log(`PASS ${name}: file scope and independent checks`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
