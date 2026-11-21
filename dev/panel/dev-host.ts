import { hash } from "node:crypto";

export const DEV_HOST = { host: "127.0.0.1", port: 5317 };
export const DEV_HOST_CHECKOUT_HEADER = "x-panel-dev-checkout";

export function devHostCheckout(path: string) {
  return hash("sha256", path);
}
