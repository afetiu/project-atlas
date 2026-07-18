/**
 * Host-side tool contract for the built-in agent loop.
 *
 * Tools execute in the extension host — never in a model-controlled process —
 * so the security posture (workspace confinement, no shell) is enforced here,
 * identically for every LLM provider.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool input, in the shape all provider APIs accept. */
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  output: string;
  /** Errors are returned to the model (not thrown) so it can self-correct. */
  isError?: boolean;
}

export interface HostTool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}
