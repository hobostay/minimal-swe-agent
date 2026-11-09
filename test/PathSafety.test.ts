import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveReadablePath } from "../src/runtime/PathSafety.js";
import { SearchTextTool, WriteFileTool } from "../src/tools/FileTools.js";

test("rejects paths outside the workspace", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "minimal-swe-"));
  await assert.rejects(() => resolveReadablePath(cwd, "../outside"));
  await fs.rm(cwd, { recursive: true });
});

test("write_file cannot follow an existing symlink to an outside file", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "minimal-path-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "workspace");
  const outside = path.join(root, "outside.txt");
  await fs.mkdir(cwd);
  await fs.writeFile(outside, "unchanged");
  await fs.symlink(outside, path.join(cwd, "link.txt"));
  const tool = new WriteFileTool();
  await assert.rejects(tool.execute({ path: "link.txt", content: "changed" }, { cwd }), /not a regular file/);
  assert.equal(await fs.readFile(outside, "utf8"), "unchanged");
});

test("search_text treats a dash-prefixed query as a pattern", async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "minimal-search-"));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  await fs.writeFile(path.join(cwd, "sample.txt"), "value --files\nother\n");
  const tool = new SearchTextTool();
  const result = await tool.execute(tool.validate({ query: "--files" }), { cwd });
  assert.match(result.output, /sample\.txt:1:value --files/);
});
