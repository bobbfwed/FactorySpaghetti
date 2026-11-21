// Authoritative LAN host.
//
// Runs one Room (the authoritative engine) behind a WebSocket endpoint at /ws, and also
// serves the built client (dist/client) over HTTP so LAN peers just open the host's URL —
// page and game socket share one origin, no IP-typing for the socket. In dev you instead
// run `npm run dev` (Vite) for the page and point the LAN lobby's server field at this host.
//
// Run:  npm run server            (defaults to 0.0.0.0:8080)
//       npm run server -- --port 9000
//
// This file is the only IO layer: all game/lobby logic lives in room.ts (unit-tested).
// createLanServer() is the reusable wiring (used by the CLI below and by integration tests).

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room, type RoomTransport, type RoomOptions } from './room';
import { encode, type ServerMessage } from './protocol';

// dist/client, resolved relative to this file (src/server/ -> ../../dist/client).
const CLIENT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'dist', 'client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Serve the built client with an SPA fallback to index.html.
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, ''); // no traversal
  let filePath = join(CLIENT_DIR, rel);
  try {
    const info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) filePath = join(CLIENT_DIR, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      '<h1>Factory Spaghetti — LAN host</h1>' +
      '<p>The WebSocket endpoint is live at <code>/ws</code>.</p>' +
      '<p>To serve the game page from here, run <code>npm run build</code> first. ' +
      'For development, run <code>npm run dev</code> and point the LAN lobby at this host.</p>',
    );
  }
}

export interface LanServer {
  readonly room: Room;
  readonly httpServer: Server;
  readonly wss: WebSocketServer;
  /** The actual bound port (useful when listening on port 0). */
  port(): number;
  close(): Promise<void>;
}

/** Wire a Room to an HTTP+WebSocket server. Does not start listening. */
export function createLanServer(opts: RoomOptions = {}): LanServer {
  const sockets = new Map<string, WebSocket>();
  let socketSeq = 0;

  const transport: RoomTransport = {
    send(clientId: string, msg: ServerMessage): void {
      const ws = sockets.get(clientId);
      if (ws && ws.readyState === ws.OPEN) ws.send(encode(msg));
    },
  };

  const room = new Room(transport, opts);
  const httpServer = createServer((req, res) => { void serveStatic(req, res); });
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    const connId = `s${++socketSeq}`;
    sockets.set(connId, ws);
    ws.on('message', (data: unknown) => room.handleMessage(connId, String(data)));
    ws.on('close', () => { sockets.delete(connId); room.handleDisconnect(connId); });
    ws.on('error', () => { /* 'close' follows; nothing extra to do */ });
  });

  return {
    room,
    httpServer,
    wss,
    port(): number {
      const addr = httpServer.address();
      return addr && typeof addr === 'object' ? addr.port : 0;
    },
    close(): Promise<void> {
      return new Promise(resolve => {
        wss.close();
        httpServer.close(() => resolve());
      });
    },
  };
}

// ── CLI entry (only when run directly, e.g. `npm run server`) ─────────────────

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function runCli(): void {
  const port = Number(argValue('--port') ?? process.env['PORT'] ?? 8080);
  const host = argValue('--host') ?? '0.0.0.0';
  const server = createLanServer();
  server.httpServer.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Factory Spaghetti LAN host listening on http://${shown}:${port}`);
    console.log(`  WebSocket:   ws://<this-machine-ip>:${port}/ws`);
    console.log(`  LAN players: open http://<this-machine-ip>:${port}/  (after \`npm run build\`)`);
  });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) runCli();
