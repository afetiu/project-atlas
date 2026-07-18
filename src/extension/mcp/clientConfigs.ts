/**
 * Per-client MCP registration: where each agent's config lives and how to
 * merge Atlas's server entry into it without disturbing anything else.
 *
 * Pure text-in/text-out so every writer is unit-testable. The command layer
 * handles file IO and user interaction.
 */

import { join } from 'path';

export type McpClientId = 'claude-code' | 'cursor' | 'windsurf' | 'gemini-cli' | 'codex';

export interface McpServerSpec {
  /** Absolute path to dist/mcp-server.mjs inside the installed extension. */
  serverPath: string;
  /** Absolute path of the workspace whose atlas.yaml the server exposes. */
  workspacePath: string;
}

export interface McpClientTarget {
  id: McpClientId;
  label: string;
  /** Absolute path of the config file to create or merge into. */
  configPath: string;
  /** True when the file is user-global rather than per-project. */
  global: boolean;
  /** Merge Atlas's entry into the existing config text (may be empty). */
  apply(existingText: string, spec: McpServerSpec): string;
  /** Post-registration hint shown to the user. */
  note: string;
}

interface JsonShape {
  [key: string]: unknown;
  mcpServers?: Record<string, unknown>;
}

function atlasJsonEntry(spec: McpServerSpec): Record<string, unknown> {
  return {
    command: 'node',
    args: [spec.serverPath],
    env: { ATLAS_WORKSPACE: spec.workspacePath },
  };
}

/** Merge into a `{ "mcpServers": { … } }` JSON file, preserving other keys. */
function applyJson(existingText: string, spec: McpServerSpec): string {
  let config: JsonShape = {};
  if (existingText.trim()) {
    try {
      const parsed = JSON.parse(existingText) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        config = parsed as JsonShape;
      }
    } catch {
      // Unreadable JSON: refuse to guess — surface instead of clobbering.
      throw new Error('the existing file is not valid JSON');
    }
  }
  config.mcpServers = { ...(config.mcpServers ?? {}), atlas: atlasJsonEntry(spec) };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Merge into Codex's `config.toml`. TOML is append-oriented here: an existing
 * `[mcp_servers.atlas]` section is replaced in place; otherwise the section is
 * appended. Other content is left byte-for-byte untouched.
 */
export function applyCodexToml(existingText: string, spec: McpServerSpec): string {
  const section = [
    '[mcp_servers.atlas]',
    'command = "node"',
    `args = [${JSON.stringify(spec.serverPath)}]`,
    '',
    '[mcp_servers.atlas.env]',
    `ATLAS_WORKSPACE = ${JSON.stringify(spec.workspacePath)}`,
  ].join('\n');

  const base = stripAtlasSections(existingText).trimEnd();
  return `${base ? `${base}\n\n` : ''}${section}\n`;
}

/**
 * Remove any existing `[mcp_servers.atlas]` / `[mcp_servers.atlas.env]` tables,
 * line-by-line (regexes over TOML break on `[` inside array values). A table
 * runs from its header until the next table header.
 */
function stripAtlasSections(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      skipping = header[1] === 'mcp_servers.atlas' || header[1] === 'mcp_servers.atlas.env';
      if (skipping) {
        continue;
      }
    }
    if (!skipping) {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

/** All registrable clients for a given workspace + home directory. */
export function mcpClientTargets(workspacePath: string, homeDir: string): McpClientTarget[] {
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      configPath: join(workspacePath, '.mcp.json'),
      global: false,
      apply: applyJson,
      note: 'Restart Claude Code to load it.',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      configPath: join(workspacePath, '.cursor', 'mcp.json'),
      global: false,
      apply: applyJson,
      note: 'Enable it under Cursor Settings → MCP.',
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      configPath: join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
      global: true,
      apply: applyJson,
      note: 'Global config — it points at this workspace. Refresh Cascade to load it.',
    },
    {
      id: 'gemini-cli',
      label: 'Gemini CLI',
      configPath: join(workspacePath, '.gemini', 'settings.json'),
      global: false,
      apply: applyJson,
      note: 'Restart the Gemini CLI session to load it.',
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      configPath: join(homeDir, '.codex', 'config.toml'),
      global: true,
      apply: applyCodexToml,
      note: 'Global config — it points at this workspace. Restart Codex to load it.',
    },
  ];
}
