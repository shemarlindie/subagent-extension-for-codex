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

// Long enough for the service's 32-character minimum; it guards only this
// disposable demo, whose fixture worker makes no model calls.
const token = "local-demo-only-not-a-real-token";

const env = {
  ...process.env,
  CODEX_SUBAGENT_EXTENSION_DATA: resolve(".codex-subagent-extension/demo"),
  CODEX_SUBAGENT_EXTENSION_TOKEN: token,
};

execFileSync(process.execPath, ["dist/projects-cli.js", "register", repo], {
  env,
  stdio: "ignore",
});

// The fixture worker is development-only, so the demo runs the dev entry
// (dev/demo-service.ts) through tsx rather than the shipped dist/main.js.
const child = spawn(
  process.execPath,
  ["--import", "tsx", "dev/demo-service.ts"],
  { stdio: "inherit", env },
);

console.error(`Demo login token: ${token} (fixture worker; no model calls)`);

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
