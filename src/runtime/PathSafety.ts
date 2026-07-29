import fs from "node:fs/promises";
import path from "node:path";

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveReadablePath(cwd: string, inputPath: string): Promise<string> {
  const root = await fs.realpath(cwd);
  const logical = path.resolve(root, inputPath);
  if (!isInside(root, logical)) throw new Error(`Path escapes workspace: ${inputPath}`);
  const real = await fs.realpath(logical);
  if (!isInside(root, real)) throw new Error(`Symlink escapes workspace: ${inputPath}`);
  return real;
}

export async function resolveWritablePath(cwd: string, inputPath: string): Promise<string> {
  const root = await fs.realpath(cwd);
  const logical = path.resolve(root, inputPath);
  if (!isInside(root, logical)) throw new Error(`Path escapes workspace: ${inputPath}`);

  let parent = path.dirname(logical);
  while (parent !== root) {
    try {
      const realParent = await fs.realpath(parent);
      if (!isInside(root, realParent)) throw new Error(`Symlink escapes workspace: ${inputPath}`);
      return logical;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      parent = path.dirname(parent);
    }
  }
  return logical;
}
