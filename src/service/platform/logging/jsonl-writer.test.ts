import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, vi } from "vitest";

import { JsonlWriter } from "./jsonl-writer.js";

async function temporaryDirectory(t: import("vitest").TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "logging-writer-"));
  t.onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return directory;
}

test("serializes concurrent writes and rotates complete records with bounded retention", async (t) => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, "events.jsonl");
  const writer = new JsonlWriter(path, { maxBytes: 16, backups: 2 });

  for (let sequence = 1; sequence <= 5; sequence++) writer.write({ sequence });
  await writer.flush();

  expect(await readdir(directory)).toEqual([
    "events.jsonl",
    "events.jsonl.1",
    "events.jsonl.2",
  ]);

  for (const [suffix, sequence] of [
    ["", 5],
    [".1", 4],
    [".2", 3],
  ] as const) {
    expect(await readFile(`${path}${suffix}`, "utf8")).toBe(
      `${JSON.stringify({ sequence })}\n`,
    );

    if (process.platform !== "win32") {
      expect((await stat(`${path}${suffix}`)).mode & 0o777).toBe(0o600);
    }
  }
});

test("uses existing file size on startup and tightens existing file permissions", async (t) => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, "events.jsonl");
  await writeFile(path, '{"before":true}\n');
  await chmod(path, 0o644);
  const writer = new JsonlWriter(path, { maxBytes: 32 });
  writer.write({ after: true });
  await writer.flush();

  if (process.platform !== "win32") {
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  }

  writer.write({ next: true });
  await writer.flush();

  expect(await readFile(`${path}.1`, "utf8")).toBe(
    '{"before":true}\n{"after":true}\n',
  );

  expect(await readFile(path, "utf8")).toBe('{"next":true}\n');
});

test("bounds queued bytes and reports dropped records without blocking subsequent writes", async (t) => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, "events.jsonl");
  const writer = new JsonlWriter(path, { maxPendingBytes: 15 });
  writer.write({ sequence: 1 });
  writer.write({ sequence: 2 });
  writer.write({ sequence: 3 });
  await writer.flush();
  writer.write({ sequence: 4 });
  await writer.flush();

  const records: unknown[] = (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  expect(records).toEqual([
    expect.objectContaining({ event: "logging.dropped", count: 2 }),
    { sequence: 1 },
    { sequence: 4 },
  ]);
});

test("makes existing logs private when the first write rotates them", async (t) => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, "events.jsonl");
  await writeFile(path, '{"before":true}\n');
  await chmod(path, 0o644);
  const writer = new JsonlWriter(path, { maxBytes: 16 });
  writer.write({ after: true });
  await writer.flush();

  expect(await readFile(`${path}.1`, "utf8")).toBe('{"before":true}\n');

  if (process.platform !== "win32") {
    expect((await stat(`${path}.1`)).mode & 0o777).toBe(0o600);
  }
});

test("drops oversized and unserializable records while preserving future writes", async (t) => {
  const directory = await temporaryDirectory(t);
  const path = join(directory, "events.jsonl");
  const writer = new JsonlWriter(path, { maxBytes: 256 });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => writer.write(cyclic)).not.toThrow();
  writer.write({ value: "x".repeat(256) });
  writer.write({ sequence: 1 });
  await writer.flush();

  const text = await readFile(path, "utf8");
  expect(text).toContain('"event":"logging.dropped","count":2');
  expect(text).toContain('{"sequence":1}\n');
  expect(text).not.toContain("self");
});

test("fails open, reports filesystem failures once and recovers when the destination is restored", async (t) => {
  const directory = await temporaryDirectory(t);
  const destination = join(directory, "missing");
  const path = join(destination, "events.jsonl");
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const writer = new JsonlWriter(path);
  writer.write({ sequence: 1 });
  writer.write({ sequence: 2 });
  await expect(writer.flush()).resolves.toBeUndefined();
  expect(stderr).toHaveBeenCalledTimes(1);

  expect(stderr).toHaveBeenCalledWith(
    "Structured log write failed; records may be lost.\n",
  );

  await mkdir(destination);
  writer.write({ sequence: 3 });
  await writer.flush();
  expect(await readFile(path, "utf8")).toBe('{"sequence":3}\n');

  await rm(destination, { recursive: true });
  writer.write({ sequence: 4 });
  await writer.flush();
  expect(stderr).toHaveBeenCalledTimes(2);
});
