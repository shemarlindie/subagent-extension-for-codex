import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { rotateStartupLog } from "./log-rotation.js";

async function logPath(t: import("vitest").TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "startup-log-"));
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return join(directory, "service.log");
}

test("rotates oversized startup output after lease release and replaces its single backup", async (t) => {
  const path = await logPath(t);
  await writeFile(path, Buffer.alloc(5_000_001, "a"), { mode: 0o600 });
  await writeFile(`${path}.1`, "old backup");
  rotateStartupLog(path, () => true);
  expect((await stat(`${path}.1`)).size).toBe(5_000_001);

  expect((await readFile(`${path}.1`)).subarray(0, 10).toString()).toBe(
    "aaaaaaaaaa",
  );

  if (process.platform !== "win32") {
    expect((await stat(`${path}.1`)).mode & 0o777).toBe(0o600);
  }

  await expect(stat(`${path}.2`)).rejects.toMatchObject({ code: "ENOENT" });
});

test("leaves output attached to an active lease untouched", async (t) => {
  const path = await logPath(t);
  await writeFile(path, Buffer.alloc(5_000_001, "a"));
  await writeFile(`${path}.1`, "old backup");
  rotateStartupLog(path, () => false);
  expect((await stat(path)).size).toBe(5_000_001);
  expect(await readFile(`${path}.1`, "utf8")).toBe("old backup");
});

test("preserves small startup logs and tolerates missing destinations", async (t) => {
  const path = await logPath(t);
  expect(() => rotateStartupLog(path, () => true)).not.toThrow();
  await writeFile(path, "existing startup output");
  rotateStartupLog(path, () => true);
  expect(await readFile(path, "utf8")).toBe("existing startup output");
  expect(await readdir(join(path, ".."))).toEqual(["service.log"]);
});
