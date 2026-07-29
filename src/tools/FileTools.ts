import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveReadablePath, resolveWritablePath } from "../runtime/PathSafety.js";
import { toolSuccess, type ToolResult } from "../types.js";
import {
  objectInput,
  optionalNumber,
  requiredString,
  type Tool,
  type ToolContext,
} from "./Tool.js";

type ReadFileInput = { path: string; startLine: number; endLine: number };
type WriteFileInput = { path: string; content: string };
type SearchInput = { query: string; path: string; maxResults: number };
type ListFilesInput = { path: string; depth: number; maxResults: number };

export class ReadFileTool implements Tool<ReadFileInput> {
  readonly mutates = false;
  readonly definition = {
    name: "read_file",
    description: "Read a UTF-8 text file with optional inclusive line range.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace." },
        startLine: { type: "number", description: "First line, 1-based. Defaults to 1." },
        endLine: { type: "number", description: "Last line, inclusive. Defaults to startLine + 399." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  };

  validate(input: unknown): ReadFileInput {
    const value = objectInput(input);
    const startLine = Math.max(1, Math.floor(optionalNumber(value, "startLine", 1)));
    const endLine = Math.floor(optionalNumber(value, "endLine", startLine + 399));
    if (endLine < startLine) throw new Error("endLine must not be smaller than startLine.");
    if (endLine - startLine > 999) throw new Error("A read_file call may read at most 1000 lines.");
    return { path: requiredString(value, "path"), startLine, endLine };
  }

  async execute(input: ReadFileInput, context: ToolContext): Promise<ToolResult> {
    const file = await resolveReadablePath(context.cwd, input.path);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error(`${input.path} is not a file.`);
    if (stat.size > 5_000_000) throw new Error("File exceeds the 5 MB text-file limit.");
    const text = await fs.readFile(file, "utf8");
    if (text.includes("\0")) throw new Error("Binary files are not supported.");
    const lines = text.split(/\r?\n/);
    const selected = lines
      .slice(input.startLine - 1, input.endLine)
      .map((line, index) => `${input.startLine + index} | ${line}`)
      .join("\n");
    return toolSuccess(selected || "<empty range>", {
      path: path.relative(context.cwd, file),
      totalLines: lines.length,
      startLine: input.startLine,
      endLine: Math.min(input.endLine, lines.length),
    });
  }
}

export class WriteFileTool implements Tool<WriteFileInput> {
  readonly mutates = true;
  readonly definition = {
    name: "write_file",
    description: "Create or completely overwrite a UTF-8 file inside the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  };

  validate(input: unknown): WriteFileInput {
    const value = objectInput(input);
    const content = value.content;
    if (typeof content !== "string") throw new Error("content must be a string.");
    if (Buffer.byteLength(content) > 2_000_000) throw new Error("Write exceeds the 2 MB limit.");
    return { path: requiredString(value, "path"), content };
  }

  async execute(input: WriteFileInput, context: ToolContext): Promise<ToolResult> {
    const file = await resolveWritablePath(context.cwd, input.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, input.content, "utf8");
    return toolSuccess(`Wrote ${Buffer.byteLength(input.content)} bytes to ${input.path}.`, {
      path: input.path,
    });
  }
}

function runArgv(
  program: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, signal, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      if (stdout.length < 500_000) stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      if (stderr.length < 100_000) stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", code => resolve({ stdout, stderr, code }));
  });
}

export class SearchTextTool implements Tool<SearchInput> {
  readonly mutates = false;
  readonly definition = {
    name: "search_text",
    description: "Search workspace text using ripgrep. Returns file paths, line numbers, and matching lines.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Regex accepted by ripgrep." },
        path: { type: "string", description: "Relative search root; defaults to workspace." },
        maxResults: { type: "number", description: "Maximum result lines; defaults to 100." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  };

  validate(input: unknown): SearchInput {
    const value = objectInput(input);
    const maxResults = Math.min(500, Math.max(1, Math.floor(optionalNumber(value, "maxResults", 100))));
    return {
      query: requiredString(value, "query"),
      path: typeof value.path === "string" ? value.path : ".",
      maxResults,
    };
  }

  async execute(input: SearchInput, context: ToolContext): Promise<ToolResult> {
    const searchRoot = await resolveReadablePath(context.cwd, input.path);
    const result = await runArgv(
      "rg",
      [
        "--line-number",
        "--color=never",
        "--hidden",
        "--glob=!node_modules/**",
        "--glob=!.git/**",
        "--max-count",
        String(input.maxResults),
        input.query,
        searchRoot,
      ],
      context.cwd,
      context.signal,
    );
    if (result.code === 1) return toolSuccess("No matches found.", { count: 0 });
    if (result.code !== 0) throw new Error(result.stderr || `ripgrep exited with ${result.code}`);
    const lines = result.stdout.split("\n").filter(Boolean).slice(0, input.maxResults);
    return toolSuccess(lines.join("\n"), { count: lines.length, truncated: lines.length >= input.maxResults });
  }
}

export class ListFilesTool implements Tool<ListFilesInput> {
  readonly mutates = false;
  readonly definition = {
    name: "list_files",
    description: "List files below a workspace directory with bounded depth and result count.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        depth: { type: "number", description: "Maximum recursion depth, defaults to 2." },
        maxResults: { type: "number", description: "Defaults to 200." },
      },
      additionalProperties: false,
    },
  };

  validate(input: unknown): ListFilesInput {
    const value = objectInput(input);
    return {
      path: typeof value.path === "string" ? value.path : ".",
      depth: Math.min(8, Math.max(0, Math.floor(optionalNumber(value, "depth", 2)))),
      maxResults: Math.min(1000, Math.max(1, Math.floor(optionalNumber(value, "maxResults", 200)))),
    };
  }

  async execute(input: ListFilesInput, context: ToolContext): Promise<ToolResult> {
    const root = await resolveReadablePath(context.cwd, input.path);
    const files: string[] = [];
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > input.depth || files.length >= input.maxResults) return;
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (files.length >= input.maxResults) break;
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile()) files.push(path.relative(context.cwd, full));
      }
    };
    await walk(root, 0);
    return toolSuccess(files.join("\n") || "<no files>", {
      count: files.length,
      truncated: files.length >= input.maxResults,
    });
  }
}
