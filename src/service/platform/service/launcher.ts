import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  dataDirectory,
  defaultPort,
  installRoot,
  packagePath,
} from "./runtime.js";

class ServiceStartingError extends Error {}

export async function connectService() {
  const data = dataDirectory();
  const explicit = process.env.CODEX_SUBAGENT_EXTENSION_URL;
  let origin =
    explicit ??
    process.env.CODEX_SUBAGENT_EXTENSION_ORIGIN ??
    `http://127.0.0.1:${process.env.PORT ?? defaultPort}`;

  if (
    !explicit &&
    !process.env.PORT &&
    !process.env.CODEX_SUBAGENT_EXTENSION_ORIGIN
  ) {
    try {
      origin = JSON.parse(
        readFileSync(join(data, "service.json"), "utf8"),
      ).origin;
    } catch {}
  }

  const url = new URL(origin);

  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Local stdio proxy requires a plain loopback HTTP service origin",
    );
  }

  origin = url.origin;

  const token = () =>
    process.env.CODEX_SUBAGENT_EXTENSION_TOKEN ??
    readFileSync(join(data, "admin-token"), "utf8").trim();

  const probe = async () => {
    const response = await fetch(`${origin}/health`, {
      signal: AbortSignal.timeout(1000),
      redirect: "error",
    });

    const health = await response.json();

    if (
      health.service === "codex-subagent-extension" &&
      health.status === "starting" &&
      response.status === 503
    ) {
      throw new ServiceStartingError("Service recovery is still in progress");
    }

    if (!response.ok || health.service !== "codex-subagent-extension") {
      throw new Error(
        "Port is occupied by an incompatible service; stop or upgrade it explicitly",
      );
    }

    const auth = await fetch(`${origin}/api/tools/list_agent_projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
        "X-Codex-Subagent-Extension": "1",
      },
      body: "{}",
      signal: AbortSignal.timeout(1000),
      redirect: "error",
    });

    if (!auth.ok) {
      throw new Error(
        "Service token or protocol mismatch; inspect data/URL overrides",
      );
    }

    return { origin, token: token() };
  };

  let needsLaunch = false;

  try {
    return await probe();
  } catch (error) {
    // Only a refused connection authorizes starting a process. Never replace a live service.
    if (!(error instanceof ServiceStartingError)) {
      if (
        explicit ||
        (error as { cause?: { code?: string } }).cause?.code !== "ECONNREFUSED"
      ) {
        throw error;
      }

      needsLaunch = true;
    }
  }

  let spawnError: Error | undefined;

  if (needsLaunch) {
    mkdirSync(data, { recursive: true, mode: 0o700 });
    const log = openSync(join(data, "service.log"), "a", 0o600);

    const child = spawn(
      process.execPath,
      ["--enable-source-maps", packagePath("dist/main.js")],
      {
        cwd: installRoot,
        detached: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          CODEX_SUBAGENT_EXTENSION_DATA: data,
          ...(process.env.CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS
            ? {
                CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS: JSON.stringify(
                  JSON.parse(
                    process.env.CODEX_SUBAGENT_EXTENSION_ALLOWED_ROOTS,
                  ).map((root: string) => resolve(root)),
                ),
              }
            : {}),
          PORT: url.port || "80",
          CODEX_SUBAGENT_EXTENSION_ORIGIN: origin,
        },
      },
    );

    child.on("error", (e) => {
      spawnError = e;
    });

    child.unref();
    closeSync(log);
  }

  // Concurrent launchers may spawn losers: the service lease alone owns recovery and workers.
  const deadline = Date.now() + 15000;
  let last: unknown;

  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      return await probe();
    } catch (e) {
      last = e;
    }
  }

  throw new Error(
    `Service startup failed. Inspect ${join(data, "service.log")}: ${String(last)}`,
  );
}
