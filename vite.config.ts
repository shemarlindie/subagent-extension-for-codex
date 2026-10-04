// Development server for the panel UI: React Fast Refresh inside a mock MCP
// Apps host (ui/dev/). Production bundles still come from scripts/build-ui.mjs.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = import.meta.dirname;
// Same optional .env as npm run dev/start; shell variables take precedence.
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));

// Mirrors dataDirectory() and connectService(). The origin is read at startup
// (restart Vite if the service moves); the token is read per request.
function dataDirectory() {
  if (process.env.CODEX_SUBAGENT_EXTENSION_DATA)
    return resolve(process.env.CODEX_SUBAGENT_EXTENSION_DATA);
  const legacy = join(root, ".codex-subagent-extension");
  if (existsSync(join(legacy, "console.sqlite"))) return legacy;

  return join(homedir(), ".local", "share", "codex-subagent-extension");
}

function serviceOrigin() {
  const configured =
    process.env.CODEX_SUBAGENT_EXTENSION_URL ??
    process.env.CODEX_SUBAGENT_EXTENSION_ORIGIN;

  if (configured) return configured;

  if (!process.env.PORT)
    try {
      return JSON.parse(
        readFileSync(join(dataDirectory(), "service.json"), "utf8"),
      ).origin as string;
    } catch {}

  return `http://127.0.0.1:${process.env.PORT ?? 4317}`;
}

function serviceToken() {
  try {
    return (
      process.env.CODEX_SUBAGENT_EXTENSION_TOKEN ??
      readFileSync(join(dataDirectory(), "admin-token"), "utf8").trim()
    );
  } catch {
    return undefined;
  }
}

export default defineConfig({
  root: "ui/dev",
  plugins: [react()],
  define: {
    // Codex sends sandboxCwd as a file URI; plain paths are ignored.
    __DEV_HOST_CWD__: JSON.stringify(pathToFileURL(root).href),
  },
  server: {
    port: 5317,
    strictPort: true,
    host: "127.0.0.1",
    fs: { allow: [root] },
    proxy: {
      // The mock host talks MCP to the real service, as Codex does. The admin
      // token is added here so it never reaches the browser.
      "/service": {
        target: serviceOrigin(),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/service/, ""),
        configure: (proxy) =>
          proxy.on("proxyReq", (request) => {
            // The service only accepts its own origin; this request is server-side.
            request.removeHeader("origin");
            request.removeHeader("referer");
            const token = serviceToken();
            if (token) request.setHeader("Authorization", `Bearer ${token}`);
          }),
      },
    },
  },
});
