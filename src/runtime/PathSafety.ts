import fs from "node:fs/promises";
import path from "node:path";

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
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
  if (logical === root) throw new Error("Cannot write to the workspace root as a file.");

  let parent = path.dirname(logical);
  let target: string;
  while (true) {
    try {
      const realParent = await fs.realpath(parent);
      if (!isInside(root, realParent)) throw new Error(`Symlink escapes workspace: ${inputPath}`);
      target = path.resolve(realParent, path.relative(parent, logical));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      parent = path.dirname(parent);
    }
  }
  const existing = await fs.lstat(target).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
  if (existing && !existing.isFile()) throw new Error(`Write target is not a regular file: ${inputPath}`);
  return target;
}
