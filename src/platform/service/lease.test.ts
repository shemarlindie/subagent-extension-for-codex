import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test } from "vitest";

import { ExistingServiceError, lease } from "./lease.js";

async function data(t: import("vitest").TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "ac-lease-"));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

  return dir;
}

test("service lock validates a live PID and prevents concurrent recovery", async (t) => {
  const dir = await data(t);
  const release = lease(dir);

  assert.throws(
    () => lease(dir),
    (error) => {
      assert.ok(error instanceof ExistingServiceError);
      assert.equal(error.pid, process.pid);
      assert.equal(error.lockFile, join(dir, "service.pid"));
      assert.match(error.message, /live service/);

      return true;
    },
  );

  release();
  await assert.rejects(access(join(dir, "service.pid")));
  const release2 = lease(dir);
  release2();
});

test("stale lock recovery requires an absent process and malformed lock fails closed", async (t) => {
  const dir = await data(t);
  await writeFile(join(dir, "service.pid"), "99999999");
  const release = lease(dir);
  release();
  await writeFile(join(dir, "service.pid"), "not-a-pid");
  assert.throws(() => lease(dir), /Invalid service lock/);
});

test("reclaims a lock left by this PID before a new lease was acquired", async (t) => {
  const dir = await data(t);
  await writeFile(join(dir, "service.pid"), String(process.pid));

  const release = lease(dir);

  assert.equal(
    await readFile(join(dir, "service.pid"), "utf8"),
    String(process.pid),
  );

  release();
  await assert.rejects(access(join(dir, "service.pid")));
});
