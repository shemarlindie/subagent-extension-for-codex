import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test, type TestContext } from "vitest";

import { npmCommand } from "../../support/npm.js";

const runner = fileURLToPath(
  new URL("../../../scripts/run-parallel.mjs", import.meta.url),
);

/** Observe process exit directly, without waiting for inherited output pipes. */
function exitCode(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "ignore",
      timeout: 15_000,
    });

    child.once("error", reject);
    child.once("exit", resolve);
  });
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "parallel-scripts-"));
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await copyFile(runner, join(directory, "parallel.mjs"));

  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      private: true,
      scripts: {
        parallel: "node parallel.mjs",
        left: "node worker.mjs left right",
        right: "node worker.mjs right left",
        failure: "node worker.mjs failure waiting",
        waiting: "node worker.mjs waiting failure",
      },
    }),
  );

  await writeFile(
    join(directory, "worker.mjs"),
    `import { readFile, rename, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
const [name, peer] = process.argv.slice(2);
async function untilFile(file) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      await readFile(file);
      return;
    } catch (error) {
      if (error.code !== "ENOENT" || Date.now() >= deadline) throw error;
      await setTimeout(10);
    }
  }
}
await writeFile(name + ".started", "");
// Neither script can finish unless its sibling has started.
await untilFile(peer + ".started");
if (name === "failure") {
  await writeFile("failure.pid", String(process.pid));
  await rename("failure.pid", "failure.failed");
  process.exitCode = 7;
} else {
  if (name === "waiting") {
    await untilFile("failure.failed");
    const pid = Number(await readFile("failure.failed", "utf8"));
    const deadline = Date.now() + 5000;
    // Finish only after the failing worker has actually exited.
    for (;;) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") break;
        throw error;
      }
      if (Date.now() >= deadline) throw new Error("Failing worker did not exit");
      await setTimeout(10);
    }
  }
  await writeFile(name + ".finished", "finished");
}
`,
  );

  return {
    directory,
    run: (...scripts: string[]) =>
      exitCode(...npmCommand(["run", "parallel", "--", ...scripts]), {
        cwd: directory,
      }),
  };
}

test.concurrent(
  "independent scripts overlap and finish before success is reported",
  async (t) => {
    const { directory, run } = await fixture(t);

    assert.equal(await run("left", "right"), 0);

    for (const name of ["left", "right"]) {
      assert.equal(
        await readFile(join(directory, `${name}.finished`), "utf8"),
        "finished",
      );
    }
  },
);

test.concurrent(
  "a failed script reports failure after its sibling finishes",
  async (t) => {
    const { directory, run } = await fixture(t);

    assert.equal(await run("failure", "waiting"), 1);

    assert.equal(
      await readFile(join(directory, "waiting.finished"), "utf8"),
      "finished",
    );
  },
);
