import { test } from "vitest";
import assert from "node:assert/strict";
import { request } from "node:http";
import { connect, createServer } from "node:net";
import { executorProxy } from "../src/providers/executor-proxy.js";

async function tunnel(url: string, target: string, auth = true) {
  const parsed = new URL(url);
  return new Promise<{ status: number; socket: import("node:net").Socket }>(
    (resolve, reject) => {
      const req = request({
        hostname: parsed.hostname,
        port: parsed.port,
        method: "CONNECT",
        path: target,
        headers: auth
          ? {
              "Proxy-Authorization":
                "Basic " +
                Buffer.from(`${parsed.username}:${parsed.password}`).toString(
                  "base64",
                ),
            }
          : {},
      });
      req.once("connect", (res, socket) =>
        resolve({ status: res.statusCode!, socket }),
      );
      req.once("error", reject);
      req.end();
    },
  );
}
test("executor proxy authenticates each tunnel and blocks unsupported hosts, ports, and private DNS answers", async () => {
  let lookups = 0,
    dials = 0;
  const proxy = await executorProxy(
    async () => {
      lookups++;
      return [{ address: "127.0.0.1", family: 4 }];
    },
    (() => {
      dials++;
      throw new Error("Should not dial");
    }) as typeof connect,
  );
  try {
    for (const [target, auth, expected] of [
      ["api.openai.com:443", false, 407],
      ["example.com:443", true, 403],
      ["api.openai.com:80", true, 403],
      ["127.0.0.1:443", true, 403],
      ["api.openai.com:443", true, 403],
    ] as const) {
      const response = await tunnel(proxy.url, target, auth);
      assert.equal(response.status, expected);
      response.socket.destroy();
    }
    assert.equal(lookups, 1);
    assert.equal(dials, 0);
  } finally {
    await proxy.stop();
  }
});
test("executor proxy pins validated public IPs, tunnels bytes, and revalidates DNS on every connection", async () => {
  const server = createServer((socket) => socket.pipe(socket));
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  let lookups = 0;
  const calls: any[] = [];
  const proxy = await executorProxy(
    async () => {
      lookups++;
      return [{ address: lookups === 1 ? "8.8.8.8" : "10.0.0.1", family: 4 }];
    },
    ((options: any) => {
      calls.push(options);
      return connect({ host: "127.0.0.1", port });
    }) as typeof connect,
  );
  try {
    const first = await tunnel(proxy.url, "api.openai.com:443");
    assert.equal(first.status, 200);
    assert.deepEqual(calls[0], { host: "8.8.8.8", port: 443, family: 4 });
    const echoed = new Promise<string>((resolve) =>
      first.socket.once("data", (chunk) => resolve(String(chunk))),
    );
    first.socket.write("test payload");
    assert.equal(await echoed, "test payload");
    first.socket.destroy();
    const second = await tunnel(proxy.url, "api.openai.com:443");
    assert.equal(second.status, 403);
    second.socket.destroy();
    assert.equal(calls.length, 1);
    await Promise.all([proxy.stop(), proxy.stop()]);
  } finally {
    await proxy.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
