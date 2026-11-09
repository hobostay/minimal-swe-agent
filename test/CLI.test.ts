import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function run(cwd: string, args: string[], model: string) {
  // Replace only the HTTP transport. CLI, tools, and check processes are real.
  const preload = `
    import assert from 'node:assert/strict';
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      const phase = request.messages[1].content.match(/\\nkind: (\\w+)/)[1];
      const last = request.messages.at(-1);
      const tools = request.tools?.map(item => item.function.name) ?? [];
      const reply = (content, calls = []) => Response.json({ choices: [{
        finish_reason: calls.length ? 'tool_calls' : 'stop',
        message: { content, tool_calls: calls.map(([name, args], i) => ({
          id: 'call-' + i, type: 'function', function: { name, arguments: JSON.stringify(args) }
        })) },
      }] });
      try { ${model} } catch (error) { return Response.json({error: {message: error.message}}, {status: 400}); }
      throw new Error('Unexpected phase: ' + phase);
    };
  `;
  const url = `data:text/javascript;base64,${Buffer.from(preload).toString("base64")}`;
  const result = spawnSync(process.execPath, ["--import", url, cli, "--cwd", cwd, ...args], {
    env: { PATH: process.env.PATH, OPENAI_API_KEY: "fixture-only" }, encoding: "utf8", timeout: 10_000,
  });
  if (result.error) throw result.error;
  return result;
}

async function workspace(t: TestContext) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "minimal-cli-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  return cwd;
}

test("a real failing --check fails the CLI before the model can summarize success", async t => {
  const cwd = await workspace(t);
  await fs.writeFile(path.join(cwd, "check.test.cjs"), `
    require('node:test')('deliberate failure', () => require('node:assert/strict').equal(2, 3));
  `);
  const result = run(cwd, ["--check", process.execPath, "--test", "check.test.cjs", "--", "Run the existing check"], `
    if (phase === 'inspect') return reply('The check is present.');
    if (phase === 'plan') return reply('{"plan":[]}');
    assert.fail('Model was called after the managed check: ' + phase);
  `);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Command exited with code 1/);
  assert.match(result.stderr, /deliberate failure/);
  assert.doesNotMatch(result.stderr, /\[summarize\]|Model was called/);
});

test("managed verification runs one argv command after the edits and bypasses model verification", async t => {
  const cwd = await workspace(t);
  await fs.writeFile(path.join(cwd, "check.cjs"), `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    assert.equal(process.argv[2], 'a b; literal');
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    assert.equal(fs.readFileSync('answer.txt', 'utf8'), 'fixed');
    fs.appendFileSync('check-runs.txt', 'ran\\n');
  `);
  const result = run(cwd, ["--yes", "--check", process.execPath, "check.cjs", "a b; literal", "--", "Fix it"], `
    assert.ok(!tools.some(name => name.startsWith('terminal_')));
    if (phase === 'inspect') return reply('Fixture inspected.');
    if (phase === 'plan') return reply(JSON.stringify({plan: [
      {id:'edit', title:'Edit', instruction:'Write answer.txt', dependencies:[]},
      {id:'finish', title:'Finish', instruction:'Keep the result', dependencies:['edit']},
    ]}));
    if (phase === 'execute') {
      if (last.role !== 'tool') return reply('', [['write_file', {path: 'answer.txt', content:'fixed'}]]);
      assert.equal(JSON.parse(last.content).ok, true);
      return reply('Wrote answer.txt.');
    }
    if (phase === 'summarize') {
      assert.match(request.messages[1].content, /exited with code 0/);
      return reply('Fixed.');
    }
    assert.fail('Model should not run verification.');
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verification \(passed\): .*exited with code 0/);
  assert.equal(await fs.readFile(path.join(cwd, "check-runs.txt"), "utf8"), "ran\n");
  assert.equal(result.stderr.match(/\[execute\]/g)?.length, 1);
});

test("--read-only rejects unexpected writes and commands even with --yes", async t => {
  const cwd = await workspace(t);
  const file = path.join(cwd, "original.txt");
  await fs.writeFile(file, "unchanged\n");
  const result = run(cwd, ["--yes", "--read-only", "Explain the file"], `
    if (phase === 'inspect') {
      assert.deepEqual(tools.sort(), ['list_files', 'read_file', 'search_text']);
      if (last.role !== 'tool') return reply('', [
        ['write_file', {path:'original.txt', content:'changed'}],
        ['terminal_exec', {command:'touch unexpected.txt'}],
      ]);
      const results = request.messages.filter(item => item.role === 'tool');
      assert.equal(results.length, 2);
      assert.ok(results.every(item => JSON.parse(item.content).ok === false));
      return reply('Neither action was allowed.');
    }
    assert.equal(phase, 'summarize');
    assert.deepEqual(tools, []);
    return reply('Read-only answer.');
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verification \(not_run\): Read-only run/);
  assert.equal(await fs.readFile(file, "utf8"), "unchanged\n");
  assert.deepEqual(await fs.readdir(cwd), ["original.txt"]);
});
