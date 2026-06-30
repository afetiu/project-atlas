/**
 * Webview-side state for operating bound components via MCP. Holds, per node,
 * the live tool list its server exposes and the result of the last tool run,
 * and exposes intent-revealing actions that post to the host bridge.
 */

import { useCallback, useEffect, useState } from 'react';

import { onHostMessage, postToHost } from '../vscodeApi';

export interface McpNodeTools {
  loading: boolean;
  server?: string;
  tools?: Array<{ name: string; description?: string }>;
  error?: string;
}

export interface McpNodeResult {
  tool: string;
  ok: boolean;
  text: string;
  running: boolean;
}

export interface McpState {
  toolsByNode: Record<string, McpNodeTools>;
  resultByNode: Record<string, McpNodeResult>;
  listTools: (nodeId: string, server: string) => void;
  callTool: (nodeId: string, server: string, tool: string, args?: Record<string, unknown>) => void;
}

export function useMcp(): McpState {
  const [toolsByNode, setToolsByNode] = useState<Record<string, McpNodeTools>>({});
  const [resultByNode, setResultByNode] = useState<Record<string, McpNodeResult>>({});

  useEffect(() => {
    return onHostMessage((message) => {
      if (message.type === 'mcp:tools') {
        setToolsByNode((prev) => ({
          ...prev,
          [message.nodeId]: {
            loading: false,
            server: message.server,
            tools: message.tools,
            error: message.error,
          },
        }));
      } else if (message.type === 'mcp:toolResult') {
        setResultByNode((prev) => ({
          ...prev,
          [message.nodeId]: { tool: message.tool, ok: message.ok, text: message.text, running: false },
        }));
      }
    });
  }, []);

  const listTools = useCallback((nodeId: string, server: string) => {
    setToolsByNode((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], loading: true, error: undefined } }));
    postToHost({ type: 'mcp:listTools', nodeId, server });
  }, []);

  const callTool = useCallback(
    (nodeId: string, server: string, tool: string, args?: Record<string, unknown>) => {
      setResultByNode((prev) => ({ ...prev, [nodeId]: { tool, ok: true, text: '', running: true } }));
      postToHost({ type: 'mcp:callTool', nodeId, server, tool, args });
    },
    [],
  );

  return { toolsByNode, resultByNode, listTools, callTool };
}
