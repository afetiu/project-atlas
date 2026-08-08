/**
 * `atlas-studio` — Atlas's visual canvas, standalone: no VS Code, no Cursor.
 * Serves the same webview bundle the extension ships over a local HTTP+WS
 * server, backed by `StudioSession` (the plain-Node counterpart to
 * `ArchitecturePanel`) instead of the VS Code workspace/webview APIs.
 *
 *   atlas-studio [directory] [--port=N] [--no-open]
 */

import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { dirname, isAbsolute, join } from 'path';
import { fileURLToPath } from 'url';

import { WebSocketServer, type WebSocket as WsSocket } from 'ws';

import { findClaudeCli, ENGINE_LABELS } from '../extension/ai/engineResolution';
import { resolveAgentStandalone } from './agentResolution';
import { StandaloneAuth } from './StandaloneAuth';
import { StandaloneLogger } from './StandaloneLogger';
import { StudioSession } from './StudioSession';

const here = dirname(fileURLToPath(import.meta.url));
const webviewDir = join(here, 'webview');

const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export interface StudioOptions {
  cwd: string;
  port: number;
  open: boolean;
}

export async function startStudio(options: StudioOptions): Promise<void> {
  const logger = new StandaloneLogger();
  const auth = new StandaloneAuth();
  const session = new StudioSession({
    cwd: options.cwd,
    auth,
    logger,
    resolveAgent: (opts) => resolveAgentStandalone(auth, opts),
  });

  const server = createServer((req, res) => void handleHttp(req, res));

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket: WsSocket) => {
    const client = {
      send: (data: string) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(data);
        }
      },
    };
    session.addClient(client);
    socket.on('message', (raw) => {
      try {
        void session.handleMessage(JSON.parse(raw.toString()));
      } catch {
        // malformed frame — ignore
      }
    });
    socket.on('close', () => session.removeClient(client));
  });

  await new Promise<void>((resolve) => server.listen(options.port, resolve));
  const url = `http://localhost:${options.port}`;
  logger.info(`Serving ${options.cwd}`);
  console.log(`atlas-studio: ${options.cwd}`);
  await printAuthStatus(auth);
  console.log(`atlas-studio: ${url}`);
  if (options.open) {
    openBrowser(url);
  }

  const shutdown = () => {
    session.dispose();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';
  if (url === '/') {
    const nonce = randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildHtml(nonce));
    return;
  }
  if (url === '/webview.js' || url === '/webview.css') {
    try {
      const body = await readFile(join(webviewDir, url.slice(1)));
      const ext = url.slice(url.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }
  res.writeHead(404);
  res.end('Not found');
}

function buildHtml(nonce: string): string {
  const csp = [
    `default-src 'self'`,
    `img-src 'self' https: data:`,
    `style-src 'self' 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src 'self'`,
    `connect-src 'self' ws: wss:`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link href="/webview.css" rel="stylesheet" />
    <title>Atlas Architecture</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="/webview.js"></script>
  </body>
</html>`;
}

/**
 * Print whether an AI engine is actually usable, right in the terminal that
 * launched the server — not just buried in the browser UI. This is the first
 * thing a cold `npx atlas-studio` run shows, so "you need a key or a claude
 * login" reaches people before they've even opened the canvas.
 */
async function printAuthStatus(auth: StandaloneAuth): Promise<void> {
  const cliPath = findClaudeCli(auth.resolveExecutablePath());
  if (cliPath) {
    console.log(`atlas-studio: AI ready — using ${ENGINE_LABELS['claude-code']} (${cliPath})`);
    return;
  }
  const provider = await auth.firstConfiguredProvider();
  if (provider) {
    console.log(`atlas-studio: AI ready — using ${ENGINE_LABELS[provider]} (from the environment)`);
    return;
  }
  console.log('atlas-studio: ⚠ no AI engine detected — "Detect with AI" and Chat need one of:');
  console.log('atlas-studio:   - a `claude` CLI login (run `claude` in a terminal to check), or');
  console.log('atlas-studio:   - ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY set in this shell');
  console.log('atlas-studio: The canvas still opens either way — you can design by hand without AI.');
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    // best-effort — the URL is already printed above
  }
}

function parseArgs(argv: string[]): StudioOptions {
  const options: StudioOptions = { cwd: process.cwd(), port: 4700, open: true };
  for (const arg of argv) {
    if (arg === '--no-open') {
      options.open = false;
    } else if (arg.startsWith('--port=')) {
      const port = Number(arg.slice('--port='.length));
      if (Number.isFinite(port)) {
        options.port = port;
      }
    } else if (!arg.startsWith('--')) {
      options.cwd = isAbsolute(arg) ? arg : join(process.cwd(), arg);
    }
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.cwd) || !statSync(options.cwd).isDirectory()) {
    console.error(`atlas-studio: "${options.cwd}" is not a directory.`);
    process.exit(2);
  }
  startStudio(options).catch((error) => {
    console.error('atlas-studio: failed to start —', error);
    process.exit(1);
  });
}

main();
