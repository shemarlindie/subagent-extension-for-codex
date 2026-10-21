import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect } from "@playwright/test";

import { freePort, serviceEnv } from "../support/service.js";
import { CONSOLE_TOKEN } from "./server";

/** A real service process, retaining its data and origin across a crash. */
export async function startProcessService() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "browser-restart-")),
  );

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let output = "";

  async function stop(signal: NodeJS.Signals) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit", { signal: AbortSignal.timeout(15_000) });
    child.kill(signal);
    await exited;
  }

  async function launch() {
    output = "";

    child = spawn(
      process.execPath,
      ["--import", "tsx", resolve("dev/service/demo-service.ts")],
      {
        env: serviceEnv(
          { data: join(directory, "data"), port },
          {
            CODEX_SUBAGENT_EXTENSION_TOKEN: CONSOLE_TOKEN,
            CODEX_SUBAGENT_EXTENSION_CONCURRENCY: "1",
          },
        ),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000);
    };

    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);

    await expect
      .poll(
        async () => {
          if (child?.exitCode !== null || child?.signalCode !== null) {
            throw new Error(
              `The fixture service exited during startup: ${output}`,
            );
          }

          try {
            const response = await fetch(`${origin}/health`, {
              signal: AbortSignal.timeout(1000),
            });

            return response.ok;
          } catch {
            return false;
          }
        },
        {
          timeout: 20_000,
          message: "The fixture service should finish startup and recovery",
        },
      )
      .toBe(true);
  }

  async function close() {
    try {
      await stop("SIGTERM");
    } finally {
      try {
        await stop("SIGKILL");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }

  try {
    await launch();

    return {
      origin,
      directory,
      close,
      restart: async () => {
        await stop("SIGKILL");
        await launch();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
