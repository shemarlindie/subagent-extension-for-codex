import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll } from "vitest";

let seed: Promise<string> | undefined;

afterAll(async () => {
  if (seed) await rm(await seed, { recursive: true, force: true });
});

async function committedRepository() {
  const directory = await mkdtemp(join(tmpdir(), "test-repository-template-"));

  try {
    execFileSync("git", ["init", "-q", directory]);
    await writeFile(join(directory, "README.md"), "hello\n");
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
export async function copyCommittedRepository(destination: string) {
  seed ??= committedRepository();
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
