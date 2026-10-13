import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, test, vi } from "vitest";

import {
  ClaudeCli,
  type ClaudeCliEnvironment,
  type ClaudeCliStatus,
  claudeCliSupport,
  claudePathVariable,
  compareVersions,
  locateClaudeCli,
  parseClaudeVersion,
  validateClaudeCli,
} from "./executable.js";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "claude-cli-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A fake `claude` that prints the given `--version` output. */
async function fakeClaude(path: string, output = "2.1.293 (Claude Code)") {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/sh\necho '${output}'\n`);
  await chmod(path, 0o755);

  return path;
}

const posix = (env: NodeJS.ProcessEnv): ClaudeCliEnvironment => ({
  env,
  platform: "linux",
});

test("the override wins over PATH and is resolved through symlinks", async () => {
  const onPath = await fakeClaude(join(root, "bin", "claude"));
  const target = await fakeClaude(join(root, "custom dir", "claude-2.1.293"));
  const link = join(root, "links", "claude");
  await mkdir(dirname(link));
  await symlink(target, link);

  assert.deepEqual(
    await locateClaudeCli(
      posix({ PATH: dirname(onPath), [claudePathVariable]: link }),
    ),
    { path: target },
  );
});

test("an invalid override is an error, not a fallback to PATH", async () => {
  const onPath = await fakeClaude(join(root, "bin", "claude"));

  for (const override of ["claude", join(root, "missing", "claude")]) {
    const located = await locateClaudeCli(
      posix({ PATH: dirname(onPath), [claudePathVariable]: override }),
    );

    assert.ok("problem" in located);
    assert.equal(located.problem, "invalid_override");
    assert.match(located.message, new RegExp(claudePathVariable));
  }
});

test("PATH lookup takes the first executable claude, resolved through symlinks", async () => {
  const notExecutable = join(root, "plain", "claude");
  await mkdir(dirname(notExecutable));
  await writeFile(notExecutable, "");
  const target = await fakeClaude(join(root, "Caskroom", "2.1.293", "claude"));
  const linked = join(root, "with space", "claude");
  await mkdir(dirname(linked));
  await symlink(target, linked);
  const directory = join(root, "directory", "claude");
  await mkdir(directory, { recursive: true });
  const later = await fakeClaude(join(root, "later", "claude"));

  const PATH = [
    "",
    "relative/bin",
    dirname(notExecutable),
    dirname(directory),
    dirname(linked),
    dirname(later),
  ].join(":");

  assert.deepEqual(await locateClaudeCli(posix({ PATH })), { path: target });
});

test("a missing CLI names the install step and the override", async () => {
  const located = await locateClaudeCli(posix({ PATH: join(root, "empty") }));

  assert.ok("problem" in located);
  assert.equal(located.problem, "missing");
  assert.match(located.message, /code\.claude\.com\/docs\/en\/setup/);
  assert.match(located.message, /@anthropic-ai\/claude-code@stable/);
  assert.match(located.message, new RegExp(claudePathVariable));
});

test("Windows finds claude.exe, or the binary behind npm's launchers", async () => {
  const native = join(root, "native");
  await mkdir(native);
  await writeFile(join(native, "claude.exe"), "");
  const npm = join(root, "npm prefix");
  await mkdir(npm);
  await writeFile(join(npm, "claude.cmd"), "");

  const exe = join(
    npm,
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
  );

  await mkdir(dirname(exe), { recursive: true });
  await writeFile(exe, "");

  // Windows spells the variable Path; the lookup ignores case.
  const windows = (Path: string): ClaudeCliEnvironment => ({
    env: { Path },
    platform: "win32",
  });

  assert.deepEqual(await locateClaudeCli(windows(`${npm};${native}`)), {
    path: exe,
  });

  assert.deepEqual(await locateClaudeCli(windows(`${native};${npm}`)), {
    path: join(native, "claude.exe"),
  });
});

test("version output is parsed strictly", () => {
  assert.equal(parseClaudeVersion("2.1.293 (Claude Code)\n"), "2.1.293");

  for (const output of [
    "2.1.293",
    "2.1.293-beta.1 (Claude Code)",
    "v2.1.293 (Claude Code)",
    "Claude Code 2.1.293",
    "",
  ]) {
    assert.equal(parseClaudeVersion(output), undefined, output);
  }

  assert.ok(compareVersions("2.1.10", "2.1.9") > 0);
  assert.equal(compareVersions("2.1.9", "2.1.9"), 0);
});

test("validation accepts the minimum and newer releases but rejects older versions", async () => {
  const check = async (version: string) =>
    validateClaudeCli(
      await fakeClaude(
        join(root, version, "claude"),
        `${version} (Claude Code)`,
      ),
    );

  for (const version of [
    claudeCliSupport.minimum,
    "2.1.296",
    "2.2.0",
    "3.0.0",
  ]) {
    const status = await check(version);
    assert.equal(status.ready, true, version);
    assert.equal(status.version, version);
  }

  const old = await check("2.1.284");
  assert.equal(old.ready, false);
  assert.equal(!old.ready && old.problem, "too_old");
  assert.match(!old.ready ? old.message : "", /claude update/);
});

test("an outdated Homebrew install is told to upgrade the cask", async () => {
  const status = await validateClaudeCli(
    await fakeClaude(
      join(root, "Caskroom", "claude-code", "2.1.200", "claude"),
      "2.1.200 (Claude Code)",
    ),
  );

  assert.match(!status.ready ? status.message : "", /brew upgrade --cask/);
});

test("prerelease, malformed, failing and hanging CLIs are rejected", async () => {
  const problem = async (status: Promise<ClaudeCliStatus>) => {
    const result = await status;

    return result.ready ? "ready" : result.problem;
  };

  assert.equal(
    await problem(
      validateClaudeCli(
        await fakeClaude(
          join(root, "pre", "claude"),
          "2.1.293-rc.1 (Claude Code)",
        ),
      ),
    ),
    "unrecognized",
  );

  assert.equal(
    await problem(
      validateClaudeCli(await fakeClaude(join(root, "odd", "claude"), "hello")),
    ),
    "unrecognized",
  );

  const failing = join(root, "failing", "claude");
  await mkdir(dirname(failing));
  await writeFile(failing, "#!/bin/sh\nexit 3\n");
  await chmod(failing, 0o755);
  assert.equal(await problem(validateClaudeCli(failing)), "unlaunchable");

  const noPermission = join(root, "no-exec", "claude");
  await mkdir(dirname(noPermission));
  await writeFile(noPermission, "#!/bin/sh\necho '2.1.293 (Claude Code)'\n");
  assert.equal(await problem(validateClaudeCli(noPermission)), "unlaunchable");

  const hanging = join(root, "hanging", "claude");
  await mkdir(dirname(hanging));
  await writeFile(hanging, "#!/bin/sh\nexec sleep 5\n");
  await chmod(hanging, 0o755);
  const timedOut = await validateClaudeCli(hanging, 200);
  assert.equal(!timedOut.ready && timedOut.problem, "unlaunchable");
  assert.match(!timedOut.ready ? timedOut.message : "", /did not finish/);
});

test("validation is reused until the binary is replaced", async () => {
  const path = await fakeClaude(join(root, "bin", "claude"));
  const validated: string[] = [];

  const cli = new ClaudeCli(
    () => posix({ PATH: dirname(path) }),
    async (target) => {
      validated.push(await readFile(target, "utf8"));

      return validateClaudeCli(target);
    },
  );

  assert.equal(await cli.executable(), path);
  assert.equal(await cli.executable(), path);
  assert.equal(validated.length, 1);

  // An auto-update swaps the file under the same name.
  const replacement = await fakeClaude(
    join(root, "staging", "claude"),
    "2.1.100 (Claude Code)",
  );

  await rename(replacement, path);

  await assert.rejects(cli.executable(), /older than the supported/);
  assert.equal(validated.length, 2);
});

test("a failed check is retried sooner than a passing one is", async () => {
  const path = await fakeClaude(join(root, "bin", "claude"), "broken");
  let checks = 0;

  const cli = new ClaudeCli(
    () => posix({ PATH: dirname(path) }),
    async (target) => {
      checks++;

      return validateClaudeCli(target);
    },
  );

  const start = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(start);
  assert.equal((await cli.status()).ready, false);
  assert.equal((await cli.status()).ready, false);
  assert.equal(checks, 1);

  clock.mockReturnValue(start + 31_000);
  await cli.status();
  assert.equal(checks, 2);
});

test("an unsupported CLI reports its path, version and the supported range", async () => {
  const path = await fakeClaude(
    join(root, "bin", "claude"),
    "2.0.0 (Claude Code)",
  );

  const status = await new ClaudeCli(() =>
    posix({ PATH: dirname(path) }),
  ).status();

  assert.deepEqual(
    { ...status, message: undefined },
    {
      ready: false,
      problem: "too_old",
      message: undefined,
      path,
      version: "2.0.0",
      supported: `${claudeCliSupport.minimum}+`,
    },
  );
});

test("the minimum was qualified against the bundled SDK and accepts its paired CLI", () => {
  const require = createRequire(import.meta.url);

  // The SDK's exports hide its manifest, which sits beside the entry point.
  const sdk = JSON.parse(
    readFileSync(
      join(
        dirname(require.resolve("@anthropic-ai/claude-agent-sdk")),
        "package.json",
      ),
      "utf8",
    ),
  ) as { version: string; claudeCodeVersion: string };

  assert.equal(
    sdk.version,
    claudeCliSupport.sdk,
    "The SDK changed; re-qualify Claude Code compatibility",
  );

  assert.ok(
    compareVersions(sdk.claudeCodeVersion, claudeCliSupport.minimum) >= 0,
  );
});
