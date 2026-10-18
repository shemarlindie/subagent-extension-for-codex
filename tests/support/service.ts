import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

import { waitForListening } from "./helpers.js";

/** A packaged service's data directory and loopback port. */
export type Service = { data: string; port: number };

/** A loopback port that was free a moment ago. */
export async function freePort() {
  const reservation = createServer();
  await waitForListening(reservation.listen(0, "127.0.0.1"));
  const { port } = reservation.address() as import("node:net").AddressInfo;
  await new Promise<void>((done) => reservation.close(() => done()));

  return port;
}

/**
 * The environment without the user's extension overrides, pointed at this
 * service's data and port, so tests never reach the user's live service.
 */
export function serviceEnv(
  service: Service,
  overrides: Record<string, string> = {},
) {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !key.startsWith("CODEX_SUBAGENT_EXTENSION_") &&
      key !== "PORT"
    ) {
      env[key] = value;
    }
  }

  return {
    ...env,
    CODEX_SUBAGENT_EXTENSION_DATA: service.data,
    PORT: String(service.port),
    ...overrides,
  };
}

/** Stops the service that owns the data directory, if one is running. */
export async function stopService({ data }: Pick<Service, "data">) {
  const pid = Number(await readFile(join(data, "service.pid"), "utf8"));

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  if (await waitForExit(pid)) return;

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }

  if (!(await waitForExit(pid))) {
    throw new Error(`Packaged service ${pid} did not exit after SIGKILL`);
  }
}

/** Waits for termination before callers remove files the service had open. */
async function waitForExit(pid: number) {
  for (let i = 0; i < 250; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }

    await new Promise((done) => setTimeout(done, 20));
  }

  return false;
}
