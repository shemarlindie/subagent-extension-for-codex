import * as fs from "node:fs";
import { homedir } from "node:os";
import { join, parse, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout } from "node:timers/promises";

import { connectService } from "../../src/service/platform/service/launcher.js";
import { lease } from "../../src/service/platform/service/lease.js";
import {
  inspectProcess,
  isExtensionService,
  isProcessRunning,
  isSameProcess,
} from "../../src/service/platform/service/process-info.js";
import {
  dataDirectory,
  installRoot,
  packagePath,
} from "../../src/service/platform/service/runtime.js";

try {
  const data = fs.realpathSync(dataDirectory());

  if (
    [parse(data).root, homedir(), installRoot].some((path) => {
      const protectedPath = fs.realpathSync(path);

      return (
        protectedPath === data || protectedPath.startsWith(`${data}${sep}`)
      );
    })
  ) {
    throw new Error(`Refusing to reset unsafe data directory: ${data}`);
  }

  const lock = join(data, "service.pid");
  const pid = fs.existsSync(lock) ? Number(fs.readFileSync(lock, "utf8")) : 0;

  if (!Number.isSafeInteger(pid) || pid < 0) {
    throw new Error("Invalid service.pid");
  }

  const running = pid > 0 && isProcessRunning(pid);
  const owner = running ? inspectProcess(pid) : undefined;

  if (running && (!owner || !isExtensionService(owner, lock))) {
    throw new Error("Cannot verify the service. Stop it manually first.");
  }

  if (running && !fs.existsSync(packagePath("dist/main.js"))) {
    throw new Error("Run npm run build before resetting a running service.");
  }

  console.error(
    `WARNING: Delete all data in ${data}, including worktrees and uncommitted work. ${running ? "The service will stop and restart." : "The service will stay stopped."}`,
  );

  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await terminal.question('Type "reset" to continue: ');
  terminal.close();

  if (answer.trim() === "reset") {
    if (owner) {
      const current = inspectProcess(owner.pid);

      if (
        Number(fs.readFileSync(lock, "utf8")) !== owner.pid ||
        !current ||
        !isSameProcess(owner, current)
      ) {
        throw new Error("Service changed. Retry.");
      }

      process.kill(owner.pid, "SIGTERM");
      const deadline = Date.now() + 30_000;

      while (isProcessRunning(owner.pid)) {
        if (Date.now() >= deadline) {
          throw new Error("Service did not stop. Data was kept.");
        }

        await setTimeout(100);
      }
    }

    // Hold the service lease so clients cannot start against partially reset data.
    const release = lease(data);

    try {
      for (const entry of fs.readdirSync(data)) {
        if (entry !== "service.pid") {
          fs.rmSync(join(data, entry), { recursive: true, force: true });
        }
      }
    } finally {
      release();
    }

    if (running) {
      // Restart locally even when the checkout normally connects through an explicit URL.
      delete process.env.CODEX_SUBAGENT_EXTENSION_URL;
      process.env.CODEX_SUBAGENT_EXTENSION_DATA = data;
      await connectService();
    }

    console.log(`Data reset: ${data}`);
  } else {
    console.log("Reset cancelled.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
