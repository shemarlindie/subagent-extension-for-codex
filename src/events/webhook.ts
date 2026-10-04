import { lookup } from "node:dns/promises";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Webhook } from "standardwebhooks";

export interface Reply {
  status: number;
  body: string;
}

export type WebhookPost = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<Reply>;

export function callbackUrl(value: string) {
  if (value.length > 2048) throw new Error("Callback URL is too long");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw new Error(
      "Callback must be HTTPS on port 443 without credentials or fragments",
    );

  return url;
}

export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

/** Resolve on each request and pin the validated address in the actual TLS connection. */
export function createWebhookPost(
  resolveDns: typeof lookup = lookup,
  connect: typeof request = request,
): WebhookPost {
  return async (value, body, headers) => {
    const url = callbackUrl(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await resolveDns(host, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error("Callback address is not public");
    const address = addresses[0];

    return new Promise((resolve, reject) => {
      const req = connect(
        url,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Length": String(Buffer.byteLength(body)),
          },
          servername: host,
          lookup: ((_host, options, cb) =>
            options.all
              ? cb(null, [address])
              : cb(
                  null,
                  address.address,
                  address.family,
                )) satisfies LookupFunction,
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");

          res.on("data", (chunk: string) => {
            text += chunk;
            if (Buffer.byteLength(text) > 65536)
              req.destroy(new Error("Callback response too large"));
          });

          res.on("error", reject);

          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body: text }),
          );
        },
      );

      const timeout = setTimeout(
        () => req.destroy(new Error("Callback timed out")),
        10000,
      );

      req.on("close", () => clearTimeout(timeout));
      req.on("error", reject);
      req.end(body);
    });
  };
}

export const webhookPost = createWebhookPost();

export function validSecret(secret: string) {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))
    throw new Error("Invalid webhook signing secret");
  const encoded = secret.slice(6);
  const key = Buffer.from(encoded, "base64");
  if (
    key.length < 24 ||
    key.length > 64 ||
    key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
  )
    throw new Error("Invalid webhook signing secret");
}

export function signedHeaders(
  id: string,
  body: string,
  secret: string,
  subscription: string,
  previous?: string,
) {
  const time = new Date();
  let signature = new Webhook(secret).sign(id, time, body);
  if (previous) signature += " " + new Webhook(previous).sign(id, time, body);

  return {
    "Content-Type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(time.getTime() / 1000)),
    "webhook-signature": signature,
    "X-MCP-Subscription-Id": subscription,
  };
}
