import { resolve } from "node:path";

import { chromium, type Browser } from "@playwright/test";
import { createServer, type PluginOption } from "vite";

import {
  DEV_HOST,
  DEV_HOST_CHECKOUT_HEADER,
  devHostCheckout,
} from "../dev-host";
import { withCleanup } from "./capture-cleanup";

export type CaptureServer = { origin: string; close?: () => Promise<void> };

/**
 * Reuses this checkout's dev host, or starts one on a free port. Extra
 * `plugins` always start a new one. `root` serves another checkout.
 */
export async function devServer(
  path: string,
  plugins: PluginOption[] = [],
  root = ".",
): Promise<CaptureServer> {
  const origin = `http://${DEV_HOST.host}:${DEV_HOST.port}`;
  const checkout = devHostCheckout(resolve(root));

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
    configFile: resolve(root, "vite.config.ts"),
    // Vite resolves the config's relative root against the working directory.
    root: resolve(root, "dev/panel/host"),
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

/** Runs `capture` with a browser, then closes the browser and `server`. */
export async function withBrowser<T>(
  server: CaptureServer,
  capture: (browser: Browser) => Promise<T>,
) {
  return withCleanup(
    async () => {
      // Metal GPU rendering on macOS. Headless Chromium otherwise renders on
      // the CPU, which drops frames at 2x.
      const browser = await chromium.launch({
        args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"],
      });

      return withCleanup(
        () => capture(browser),
        () => browser.close(),
      );
    },
    async () => {
      await server.close?.();
    },
  );
}
