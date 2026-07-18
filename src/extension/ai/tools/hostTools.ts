/**
 * The five tools the built-in loop exposes: Read, Glob, Grep (read-only) and
 * Write, Edit (workspace-confined mutations). There is deliberately no shell
 * tool — the loop's whole tool surface is enumerable and auditable.
 *
 * Names and input shapes mirror the Claude Agent SDK's equivalents so the
 * shared prompts describe both engines accurately.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import { resolveWithinRoot } from '../../workspace/paths';
import { globToRegExp, listWorkspaceFiles } from './fsScan';
import type { HostTool, ToolResult } from './types';

const MAX_READ_BYTES = 256 * 1024;
const MAX_GLOB_RESULTS = 500;
const MAX_GREP_MATCHES = 200;
const MAX_GREP_FILE_BYTES = 1024 * 1024;

function ok(output: string): ToolResult {
  return { output };
}

function fail(output: string): ToolResult {
  return { output, isError: true };
}

function requireString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Resolve a model-supplied path inside the workspace, or return null. */
function containedPath(cwd: string, target: string | undefined): string | null {
  if (!target) {
    return null;
  }
  return resolveWithinRoot(cwd, target);
}

export function readTool(cwd: string): HostTool {
  return {
    definition: {
      name: 'Read',
      description:
        'Read a file from the workspace. Returns at most 256KB; use offset/limit (line numbers) for large files.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file, relative to the workspace root.' },
          offset: { type: 'number', description: '1-based line to start from (optional).' },
          limit: { type: 'number', description: 'Maximum number of lines to return (optional).' },
        },
        required: ['file_path'],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const path = containedPath(cwd, requireString(input, 'file_path'));
      if (!path) {
        return fail('Read refused: the path is missing or outside the workspace.');
      }
      let raw: string;
      try {
        if (statSync(path).size > MAX_READ_BYTES * 4) {
          return fail('Read refused: file is too large. Use Grep to locate the relevant part.');
        }
        raw = readFileSync(path, 'utf8');
      } catch (error) {
        return fail(`Read failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const lines = raw.split('\n');
      const offset = typeof input.offset === 'number' && input.offset > 0 ? input.offset - 1 : 0;
      const limit = typeof input.limit === 'number' && input.limit > 0 ? input.limit : lines.length;
      let text = lines.slice(offset, offset + limit).join('\n');
      let truncated = offset + limit < lines.length;
      if (text.length > MAX_READ_BYTES) {
        text = text.slice(0, MAX_READ_BYTES);
        truncated = true;
      }
      return ok(truncated ? `${text}\n… (truncated — use offset/limit to read more)` : text);
    },
  };
}

export function globTool(cwd: string): HostTool {
  return {
    definition: {
      name: 'Glob',
      description:
        'List workspace files matching a glob pattern (e.g. "src/**/*.ts"). Dependency and VCS directories are excluded.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern over workspace-relative paths.' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const pattern = requireString(input, 'pattern');
      if (!pattern) {
        return fail('Glob failed: "pattern" is required.');
      }
      let regex: RegExp;
      try {
        regex = globToRegExp(pattern);
      } catch {
        return fail(`Glob failed: invalid pattern "${pattern}".`);
      }
      const matches = listWorkspaceFiles(cwd).filter((file) => regex.test(file));
      if (matches.length === 0) {
        return ok('No files matched.');
      }
      const shown = matches.slice(0, MAX_GLOB_RESULTS);
      const suffix =
        matches.length > shown.length ? `\n… (${matches.length - shown.length} more not shown)` : '';
      return ok(shown.join('\n') + suffix);
    },
  };
}

export function grepTool(cwd: string): HostTool {
  return {
    definition: {
      name: 'Grep',
      description:
        'Search file contents with a regular expression. Returns "path:line: text" matches. Optionally filter files with a glob.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression to search for.' },
          glob: { type: 'string', description: 'Only search files matching this glob (optional).' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const pattern = requireString(input, 'pattern');
      if (!pattern) {
        return fail('Grep failed: "pattern" is required.');
      }
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (error) {
        return fail(`Grep failed: invalid regex — ${error instanceof Error ? error.message : ''}`);
      }
      const fileFilter = requireString(input, 'glob');
      let files = listWorkspaceFiles(cwd);
      if (fileFilter) {
        try {
          const fileRegex = globToRegExp(fileFilter);
          files = files.filter((file) => fileRegex.test(file));
        } catch {
          return fail(`Grep failed: invalid glob "${fileFilter}".`);
        }
      }
      const matches: string[] = [];
      for (const file of files) {
        if (matches.length >= MAX_GREP_MATCHES) {
          break;
        }
        const absolute = resolveWithinRoot(cwd, file);
        if (!absolute) {
          continue;
        }
        let content: string;
        try {
          if (statSync(absolute).size > MAX_GREP_FILE_BYTES) {
            continue;
          }
          content = readFileSync(absolute, 'utf8');
        } catch {
          continue;
        }
        if (content.includes('\0')) {
          continue; // binary
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && matches.length < MAX_GREP_MATCHES; i += 1) {
          if (regex.test(lines[i])) {
            matches.push(`${file}:${i + 1}: ${lines[i].slice(0, 300)}`);
          }
        }
      }
      if (matches.length === 0) {
        return ok('No matches.');
      }
      const suffix = matches.length >= MAX_GREP_MATCHES ? '\n… (match limit reached)' : '';
      return ok(matches.join('\n') + suffix);
    },
  };
}

export function writeTool(cwd: string, touched: Set<string>): HostTool {
  return {
    definition: {
      name: 'Write',
      description: 'Create or overwrite a file inside the workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to write, relative to the workspace root.' },
          content: { type: 'string', description: 'Full file content.' },
        },
        required: ['file_path', 'content'],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const path = containedPath(cwd, requireString(input, 'file_path'));
      if (!path) {
        return fail(
          `Atlas blocked a write outside the workspace: ${String(input.file_path ?? '(missing)')}`,
        );
      }
      if (typeof input.content !== 'string') {
        return fail('Write failed: "content" must be a string.');
      }
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, input.content, 'utf8');
      } catch (error) {
        return fail(`Write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      touched.add(path);
      return ok(`Wrote ${path}`);
    },
  };
}

export function editTool(cwd: string, touched: Set<string>): HostTool {
  return {
    definition: {
      name: 'Edit',
      description:
        'Replace an exact string in a file. old_string must match exactly once unless replace_all is true.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to edit, relative to the workspace root.' },
          old_string: { type: 'string', description: 'Exact text to replace.' },
          new_string: { type: 'string', description: 'Replacement text.' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
        },
        required: ['file_path', 'old_string', 'new_string'],
        additionalProperties: false,
      },
    },
    async execute(input) {
      const path = containedPath(cwd, requireString(input, 'file_path'));
      if (!path) {
        return fail(
          `Atlas blocked an edit outside the workspace: ${String(input.file_path ?? '(missing)')}`,
        );
      }
      const oldString = typeof input.old_string === 'string' ? input.old_string : undefined;
      const newString = typeof input.new_string === 'string' ? input.new_string : undefined;
      if (!oldString || newString === undefined) {
        return fail('Edit failed: "old_string" and "new_string" are required.');
      }
      let content: string;
      try {
        content = readFileSync(path, 'utf8');
      } catch (error) {
        return fail(`Edit failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const occurrences = content.split(oldString).length - 1;
      if (occurrences === 0) {
        return fail('Edit failed: old_string was not found in the file.');
      }
      if (occurrences > 1 && input.replace_all !== true) {
        return fail(
          `Edit failed: old_string matches ${occurrences} times. Provide more context or set replace_all.`,
        );
      }
      const updated =
        input.replace_all === true
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString);
      try {
        writeFileSync(path, updated, 'utf8');
      } catch (error) {
        return fail(`Edit failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      touched.add(path);
      return ok(`Edited ${path}`);
    },
  };
}

/** Read-only tool set for detection and chat. */
export function readOnlyTools(cwd: string): HostTool[] {
  return [readTool(cwd), globTool(cwd), grepTool(cwd)];
}

/**
 * Code-generation tool set: reads plus workspace-confined writes. `touched`
 * accumulates every file the model created or edited, for revert.
 */
export function codegenTools(cwd: string, touched: Set<string>): HostTool[] {
  return [...readOnlyTools(cwd), writeTool(cwd, touched), editTool(cwd, touched)];
}
