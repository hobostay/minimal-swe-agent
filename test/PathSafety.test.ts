import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveReadablePath } from "../src/runtime/PathSafety.js";

test("rejects paths outside the workspace", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "minimal-swe-"));
  await assert.rejects(() => resolveReadablePath(cwd, "../outside"));
  await fs.rm(cwd, { recursive: true });
});
