import assert from "node:assert/strict";
import test from "node:test";
import { OutputParser } from "../src/parser/OutputParser.js";

test("parses a machine-readable plan", () => {
  const parsed = new OutputParser().parse(`Plan:
\`\`\`json
{"plan":[{"id":"code","title":"Implement","instruction":"Change code","dependencies":[]},{"id":"test","title":"Test","instruction":"Run tests","dependencies":["code"]}]}
\`\`\``);
  assert.equal(parsed.plan.length, 2);
  assert.deepEqual(parsed.plan[1]?.dependencies, ["code"]);
});

test("does not mistake ordinary prose for a plan", () => {
  assert.deepEqual(new OutputParser().parse("Nothing to plan.").plan, []);
});
