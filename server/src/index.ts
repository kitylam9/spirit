import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@spirit/shared";
import { config } from "./config.js";
import { assetsDir } from "./assets/catalog.js";
import { llm } from "./llm/gateway.js";
import { Session } from "./session.js";

await llm.init();

const sessions = new Map<string, Promise<Session>>();

function getSession(playerId: string | undefined): Promise<Session> {
  if (playerId && sessions.has(playerId)) return sessions.get(playerId)!;
  const p = Session.load(playerId);
  p.then((s) => sessions.set(s.player.id, p)).catch(() => {});
  return p;
}

const MIME: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ktx2": "image/ktx2",
  ".stl": "model/stl",
  ".obj": "model/obj",
};

const http = createServer((req, res) => {
  if (req.url === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, llm: llm.status() }));
    return;
  }
  if (req.method === "GET" && req.url?.startsWith("/assets/")) {
    let rel: string;
    try {
      rel = decodeURIComponent(new URL(req.url, "http://x").pathname.slice("/assets/".length));
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = resolve(assetsDir, rel);
    if (!file.startsWith(assetsDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=31536000, immutable",
    });
    createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  const send = (m: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  let session: Session | null = null;
  let detach: (() => void) | null = null;
  const offLlm = llm.onStatus((status) => send({ type: "llm", status }));
  let queue = Promise.resolve();

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "hello") {
      queue = queue.then(async () => {
        send({ type: "loading", what: "Gathering starlight…", done: false });
        session = await getSession(msg.type === "hello" ? msg.playerId : undefined);
        detach?.();
        detach = session.attach(send);
        send({ type: "loading", what: "", done: true });
        session.welcome(llm.status());
      }).catch((err) => {
        console.error("[server] hello failed:", err);
        send({ type: "error", message: (err as Error).message });
      });
      return;
    }
    // Dialogue and slow generations should not block movement-related messages.
    const run = () => session?.handle(msg);
    if (msg.type === "space.tick" || msg.type === "dialogue.say" || msg.type === "approach") void queue.then(run);
    else queue = queue.then(run);
  });

  ws.on("close", () => {
    offLlm();
    detach?.();
  });
});

http.listen(config.port, () => {
  console.log(`[server] Spirit server on http://localhost:${config.port} (WebSocket /ws)`);
});
