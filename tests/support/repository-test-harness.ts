import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll } from "vitest";

const seeds = new Map<string, Promise<string>>();

afterAll(async () => {
  await Promise.all(
    [...seeds.values()].map(async (seed) =>
      rm(await seed, { recursive: true, force: true }),
    ),
  );
});

async function committedRepository(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), "test-repository-template-"));

  try {
    execFileSync("git", ["init", "-q", directory]);

    await Promise.all(
      Object.entries(files).map(async ([name, content]) => {
        const path = join(directory, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content);
      }),
    );

    execFileSync("git", ["-C", directory, "add", "."]);

    execFileSync("git", [
      "-C",
      directory,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "initial",
    ]);

    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Copy a committed seed into a fresh repository with independent files and Git objects. */
export async function copyCommittedRepository(
  destination: string,
  files: Record<string, string> = { "README.md": "hello\n" },
) {
  const key = JSON.stringify(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );

  let seed = seeds.get(key);

  if (!seed) {
    seed = committedRepository(files);
    seeds.set(key, seed);
  }

  const source = await seed;
  await mkdir(destination, { recursive: true });

  await Promise.all(
    (await readdir(source)).map((name) =>
      cp(join(source, name), join(destination, name), {
        recursive: true,
        force: false,
        errorOnExist: true,
      }),
    ),
  );
}
