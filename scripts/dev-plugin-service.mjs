// Use the existing handoff API. Never signal a PID or start a service here.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  challengeHeader,
  newChallenge,
  provesToken,
} from "../src/service/platform/service/health-proof.ts";

// Match the plugin's shell environment, ignoring the checkout's .env.
const data = resolve(
  process.env.SUBAGENT_EXTENSION_FOR_CODEX_DATA ||
    join(homedir(), ".local/share/subagent-extension-for-codex"),
);

async function pluginService() {
  let metadata;

  try {
    metadata = JSON.parse(readFileSync(join(data, "service.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw new Error(`Could not read ${join(data, "service.json")}.`, {
      cause: error,
    });
  }

  let url;

  try {
    url = new URL(metadata.origin);
  } catch {}

  if (
    url?.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("service.json doesn't name a plain loopback HTTP origin.");
  }

  const { origin } = url;
  const challenge = newChallenge();
  let health;

  try {
    const response = await fetch(`${origin}/health`, {
      headers: { [challengeHeader]: challenge },
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    });

    health = await response.json();
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") return;
    throw new Error(
      `The service at ${origin} didn't answer as the extension service.`,
      { cause: error },
    );
  }

  let token;

  try {
    token =
      process.env.SUBAGENT_EXTENSION_FOR_CODEX_TOKEN ??
      readFileSync(join(data, "admin-token"), "utf8").trim();
  } catch {
    throw new Error(`Could not read ${join(data, "admin-token")}.`);
  }

  if (
    health?.service !== "subagent-extension-for-codex" ||
    !provesToken(token, challenge, health.proof)
  ) {
    throw new Error(
      "The service didn't prove it holds this data directory's admin token.",
    );
  }

  if (health.launcher !== "stdio") {
    throw new Error(
      "The service wasn't started by the plugin. Leave development services running.",
    );
  }

  if (health.status === "draining") return;

  if (health.status !== "ok") {
    throw new Error(`The service is ${health.status}.`);
  }

  return {
    origin,
    token,
    instance: [metadata.pid, metadata.startedAt, origin].join(" "),
  };
}

async function confirm(question) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const closed = new AbortController();
  readline.once("close", () => closed.abort());

  try {
    const answer = await readline.question(`${question} [y/N] `, {
      signal: closed.signal,
    });

    return /^y(es)?$/i.test(answer.trim());
  } catch (error) {
    if (closed.signal.aborted) return false;
    throw error;
  } finally {
    readline.close();
  }
}

// Returns false only if an explicitly requested stop failed.
export async function offerDrain(question, requested) {
  try {
    const found = await pluginService();
    if (!found) return true;

    if (!requested) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log(
          "A plugin service is running. To drain it, rerun with --stop-service.",
        );

        return true;
      }

      requested = await confirm(
        `${question} Running turns get up to 10 minutes to finish, then any remaining turns are interrupted.`,
      );

      if (!requested) return true;
    }

    // The prompt may have waited while a replacement service started.
    const service = await pluginService();
    if (!service) return true;

    if (service.instance !== found.instance) {
      throw new Error("Another service replaced the one offered.");
    }

    let response;

    try {
      response = await fetch(`${service.origin}/api/service/drain`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${service.token}`,
          "Content-Type": "application/json",
          "X-Subagent-Extension-For-Codex": "1",
        },
        body: "{}",
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
    } catch {
      throw new Error(
        `Could not reach ${service.origin} to drain the service.`,
      );
    }

    const body = await response.json().catch(() => undefined);

    if (response.status !== 202 || body?.status !== "draining") {
      throw new Error(`The service refused to drain (${response.status}).`);
    }

    console.log("Asked the service to drain.");

    return true;
  } catch (error) {
    console.error(`Service: ${error.message}`);

    return !requested;
  }
}
