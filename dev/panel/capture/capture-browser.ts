import { resolve } from "node:path";

import { chromium } from "@playwright/test";
import { createServer, type PluginOption } from "vite";

import {
  DEV_HOST,
  DEV_HOST_CHECKOUT_HEADER,
  devHostCheckout,
} from "../dev-host";

type CaptureServer = { origin: string; close?: () => Promise<void> };

/**
 * Reuses this checkout's dev host, or starts one on a free port. Extra
 * `plugins` always start a new one.
 */
export async function devServer(
  path: string,
  plugins: PluginOption[] = [],
): Promise<CaptureServer> {
  const origin = `http://${DEV_HOST.host}:${DEV_HOST.port}`;
  const checkout = devHostCheckout(process.cwd());

  const reusable =
    plugins.length === 0 &&
    (await fetch(`${origin}${path}`, {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(2000),
    }).then(
      (response) =>
        response.ok &&
        response.headers.get(DEV_HOST_CHECKOUT_HEADER) === checkout,
      () => false,
    ));

  if (reusable) return { origin };

  const server = await createServer({
    configFile: resolve("vite.config.ts"),
    server: { port: 0 },
    plugins,
  });

  try {
    await server.listen();
    const address = server.httpServer?.address();

    if (!address || typeof address === "string") {
      throw new Error("The panel dev host has no TCP address");
    }

    return {
      origin: `http://${DEV_HOST.host}:${address.port}`,
      close: () => server.close(),
    };
  } catch (error) {
    await server.close().catch(() => {
      // Preserve the server startup error.
    });

    throw error;
  }
}

// Metal GPU rendering on macOS. Headless Chromium otherwise renders on the
// CPU, which drops frames at 2x.
export function launchBrowser() {
  return chromium.launch({
    args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"],
  });
}
