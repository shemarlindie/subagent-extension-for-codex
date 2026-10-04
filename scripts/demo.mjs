import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repo = resolve(".codex-subagent-extension/demo-repository");
await mkdir(repo, { recursive: true });

try {
  await access(repo + "/.git");
} catch {
  execFileSync("git", ["init", "-q", repo]);

  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "demo@example.invalid",
  ]);

  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.name",
    "Subagent extension demo",
  ]);

  await writeFile(
    repo + "/README.md",
    "# Demo repository\n\nFixture tasks use this repository. No model calls occur.\n",
  );

  execFileSync("git", ["-C", repo, "add", "README.md"]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "Demo fixture"]);
}

const env = {
  ...process.env,
  CODEX_SUBAGENT_EXTENSION_DATA: resolve(".codex-subagent-extension/demo"),
  CODEX_SUBAGENT_EXTENSION_PROVIDER: "fixture",
  CODEX_SUBAGENT_EXTENSION_TOKEN: "local-demo-only",
};

execFileSync(process.execPath, ["dist/projects-cli.js", "register", repo], {
  env,
  stdio: "ignore",
});

const child = spawn(process.execPath, ["dist/main.js"], {
  stdio: "inherit",
  env,
});

console.error(
  "Demo login token: local-demo-only (fixture mode; no model calls)",
);

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
