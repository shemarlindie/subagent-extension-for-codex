import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { lookup } from "node:dns/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { publicAddress } from "../events/webhook.js";

const hosts = new Set([
  "api.openai.com",
  "codex-cloud-environments.chatgpt.com",
]);
type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;
export async function executorProxy(
  resolve: Resolve = (host) => lookup(host, { all: true }),
  dial: typeof connect = connect,
) {
  const password = randomBytes(32).toString("base64url");
  const authorization = Buffer.from(
    "Basic " + Buffer.from(`worker:${password}`).toString("base64"),
  );
  const sockets = new Set<Socket>();
  let closing = false;
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  };
  const server = createServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  server.on("connection", track);
  server.on("connect", async (req, client, head) => {
    const socket = client as Socket;
    const reject = (status: number) =>
      socket.end(`HTTP/1.1 ${status} Denied\r\nConnection: close\r\n\r\n`);
    const supplied = Buffer.from(
      String(req.headers["proxy-authorization"] ?? ""),
    );
    if (
      supplied.length !== authorization.length ||
      !timingSafeEqual(supplied, authorization)
    ) {
      reject(407);
      return;
    }
    const match = req.url?.match(/^([a-zA-Z0-9.-]+):443$/);
    const host = match?.[1].toLowerCase();
    if (!host || !hosts.has(host)) {
      reject(403);
      return;
    }
    try {
      const addresses = await resolve(host);
      if (closing || socket.destroyed) return;
      if (
        !addresses.length ||
        addresses.some((entry) => !publicAddress(entry.address))
      ) {
        reject(403);
        return;
      }
      const upstream = dial({
        host: addresses[0].address,
        port: 443,
        family: addresses[0].family,
      });
      track(upstream);
      const timer = setTimeout(() => {
        upstream.destroy();
        socket.destroy();
      }, 10000);
      upstream.once("connect", () => {
        clearTimeout(timer);
        if (closing || socket.destroyed) {
          upstream.destroy();
          return;
        }
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.once("error", () => {
        clearTimeout(timer);
        reject(502);
      });
      upstream.once("close", () => {
        clearTimeout(timer);
        socket.destroy();
      });
      socket.once("close", () => upstream.destroy());
    } catch {
      reject(502);
    }
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = (server.address() as { port: number }).port;
  let stop: Promise<void> | undefined;
  return {
    port,
    url: `http://worker:${password}@127.0.0.1:${port}`,
    stop() {
      return (stop ??= new Promise<void>((resolve) => {
        closing = true;
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }));
    },
  };
}
