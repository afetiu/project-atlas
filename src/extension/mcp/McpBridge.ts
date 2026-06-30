/**
 * Host-side MCP client bridge — what makes a bound node *operable* rather than
 * decorative. Given a registry of MCP servers (from VS Code settings), it
 * connects to a server on demand, lists its tools, and invokes them, so the map
 * can act on the real running things its components represent.
 *
 * The MCP SDK is ESM and spawns a child process, so — like the Agent SDK — it's
 * loaded lazily via dynamic import() and kept out of the CJS extension bundle.
 * This module is free of `vscode` imports so it can be tested headless against a
 * real stdio server.
 */

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export type McpServerRegistry = Record<string, McpServerConfig>;

export interface McpToolInfo {
  name: string;
  description?: string;
}

export interface McpToolResult {
  ok: boolean;
  text: string;
}

// Minimal shapes from @modelcontextprotocol/sdk we rely on (avoids a type-only
// import of an ESM-only package into the CJS bundle).
interface SdkClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string; description?: string }> }>;
  callTool(req: { name: string; arguments?: Record<string, unknown> }): Promise<{
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  }>;
  close(): Promise<void>;
}

type ClientCtor = new (info: { name: string; version: string }, opts: { capabilities: object }) => SdkClient;
type TransportCtor = new (opts: McpServerConfig) => unknown;

let sdkPromise: Promise<{ Client: ClientCtor; StdioClientTransport: TransportCtor }> | undefined;
function loadSdk(): Promise<{ Client: ClientCtor; StdioClientTransport: TransportCtor }> {
  if (!sdkPromise) {
    sdkPromise = Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
    ]).then(([client, stdio]) => ({
      Client: (client as { Client: ClientCtor }).Client,
      StdioClientTransport: (stdio as { StdioClientTransport: TransportCtor }).StdioClientTransport,
    }));
    sdkPromise.catch(() => {
      sdkPromise = undefined; // don't memoize a failed import
    });
  }
  return sdkPromise;
}

export class McpBridge {
  private clients = new Map<string, Promise<SdkClient>>();

  constructor(private registry: McpServerRegistry) {}

  /** Replace the server registry (e.g. when settings change). */
  setRegistry(registry: McpServerRegistry): void {
    this.registry = registry;
  }

  hasServer(server: string): boolean {
    return !!this.registry[server];
  }

  async listTools(server: string): Promise<McpToolInfo[]> {
    const client = await this.connect(server);
    const result = await client.listTools();
    return result.tools.map((t) => ({ name: t.name, description: t.description }));
  }

  async callTool(server: string, tool: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    const client = await this.connect(server);
    const result = await client.callTool({ name: tool, arguments: args });
    const text = (result.content ?? [])
      .map((block) => (block.type === 'text' ? block.text ?? '' : `[${block.type}]`))
      .join('\n')
      .trim();
    return { ok: !result.isError, text: text || (result.isError ? 'Tool reported an error.' : 'OK') };
  }

  private connect(server: string): Promise<SdkClient> {
    const existing = this.clients.get(server);
    if (existing) {
      return existing;
    }
    const config = this.registry[server];
    if (!config) {
      return Promise.reject(new Error(`No MCP server named "${server}" is configured (atlas.mcpServers).`));
    }
    const connected = (async () => {
      const { Client, StdioClientTransport } = await loadSdk();
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        cwd: config.cwd,
        env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
      });
      const client = new Client({ name: 'atlas', version: '0.1.0' }, { capabilities: {} });
      await client.connect(transport);
      return client;
    })();
    // Drop a failed connection so a later attempt can retry.
    connected.catch(() => this.clients.delete(server));
    this.clients.set(server, connected);
    return connected;
  }

  async dispose(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(
      clients.map((p) => p.then((c) => c.close()).catch(() => undefined)),
    );
  }
}
