import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, onTestFinished, test } from "vitest";

import { downloadsDirectory } from "./downloads-directory.js";

async function linuxFixture() {
  const directory = await mkdtemp(join(tmpdir(), "downloads-directory-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, "home").replaceAll("\\", "/");
  const config = join(directory, "custom-config");
  await mkdir(config);

  return {
    home,
    file: join(config, "user-dirs.dirs"),
    options: {
      platform: "linux" as const,
      home,
      env: { XDG_CONFIG_HOME: config },
    },
  };
}

test("Linux honors a redirected Downloads folder and literal shell escapes", async () => {
  const { file, home, options } = await linuxFixture();

  await writeFile(
    file,
    'XDG_DOWNLOAD_DIR="$HOME/Téléchargements \\"quoted\\" \\\\folder \\$cash \\`tick"\n',
  );

  await expect(downloadsDirectory(options)).resolves.toBe(
    `${home}/Téléchargements "quoted" \\folder $cash \`tick`,
  );

  const redirected = "/mnt/Another volume/Incoming ";
  await writeFile(file, `XDG_DOWNLOAD_DIR="${redirected}" # relocated\n`);
  await expect(downloadsDirectory(options)).resolves.toBe(redirected);

  // The last assignment wins, as when the desktop sources this configuration.
  await writeFile(
    file,
    `XDG_DOWNLOAD_DIR="$HOME/Downloads"\nXDG_DOWNLOAD_DIR="${redirected}"\n`,
  );

  await expect(downloadsDirectory(options)).resolves.toBe(redirected);
});

test("Linux uses Downloads only when no configured location exists", async () => {
  const { file, home, options } = await linuxFixture();

  await expect(downloadsDirectory(options)).resolves.toBe(
    join(home, "Downloads"),
  );

  await writeFile(file, 'XDG_DESKTOP_DIR="$HOME/Desktop"\n');

  await expect(downloadsDirectory(options)).resolves.toBe(
    join(home, "Downloads"),
  );

  // A relative XDG_CONFIG_HOME is invalid, so the home configuration wins.
  await mkdir(join(home, ".config"), { recursive: true });

  await writeFile(
    join(home, ".config", "user-dirs.dirs"),
    'XDG_DOWNLOAD_DIR="$HOME/Incoming"\n',
  );

  await expect(
    downloadsDirectory({ ...options, env: { XDG_CONFIG_HOME: "relative" } }),
  ).resolves.toBe(`${home}/Incoming`);
});

test.each([
  'XDG_DOWNLOAD_DIR="relative/path"',
  'XDG_DOWNLOAD_DIR="$OTHER/Downloads"',
  'XDG_DOWNLOAD_DIR="/tmp/`whoami`"',
  "XDG_DOWNLOAD_DIR=/unquoted/path",
])("Linux refuses an unusable Downloads setting: %s", async (line) => {
  const { file, options } = await linuxFixture();
  await writeFile(file, `${line}\n`);
  await expect(downloadsDirectory(options)).rejects.toThrow();
});

test("Linux reports unreadable configuration instead of silently choosing another folder", async () => {
  const { file, options } = await linuxFixture();
  await mkdir(file);
  await expect(downloadsDirectory(options)).rejects.toThrow();
});

test.each([
  { platform: "darwin" as const, path: "/Volumes/Personal/Incoming " },
  { platform: "win32" as const, path: "D:\\Users\\Renée\\Incoming " },
  { platform: "win32" as const, path: "\\\\fileserver\\users\\Incoming" },
])(
  "$platform preserves the system's redirected Downloads path",
  async ({ platform, path }) => {
    await expect(
      downloadsDirectory({ platform, execute: async () => `${path}\r\n` }),
    ).resolves.toBe(path);
  },
);

test.each([
  { platform: "darwin" as const, output: "relative/path\n" },
  { platform: "win32" as const, output: "C:Downloads\n" },
  { platform: "win32" as const, output: "\n" },
])("$platform refuses an invalid system path", async ({ platform, output }) => {
  await expect(
    downloadsDirectory({ platform, execute: async () => output }),
  ).rejects.toThrow();
});

test("a failed native lookup and unsupported systems leave saving unavailable", async () => {
  await expect(
    downloadsDirectory({
      platform: "darwin",
      execute: async () => {
        throw new Error("System lookup failed");
      },
    }),
  ).rejects.toThrow();

  await expect(downloadsDirectory({ platform: "freebsd" })).rejects.toThrow();
});
