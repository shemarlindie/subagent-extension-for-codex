import { expect, test, vi } from "vitest";

vi.mock("node:os", () => ({
  networkInterfaces: () => ({
    lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    en0: [
      { family: "IPv4", address: "192.168.1.20", internal: false },
      { family: "IPv6", address: "fe80::1", internal: false },
    ],
    en1: [{ family: "IPv4", address: "192.168.1.20", internal: false }],
    disconnected: undefined,
  }),
}));

import { networkOrigins } from "./network.js";

test("LAN URLs use unique external IPv4 interfaces and the configured port", () => {
  expect(networkOrigins(4399)).toEqual(["http://192.168.1.20:4399"]);
});
