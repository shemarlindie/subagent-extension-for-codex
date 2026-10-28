// Run independent npm scripts, waiting for every child before reporting failure.
// npm_execpath keeps Windows shims out of child_process.spawn.
import { spawn } from "node:child_process";

const scripts = process.argv.slice(2);

if (!scripts.length) throw new Error("Provide at least one npm script");

const npmCli = process.env.npm_execpath;

if (!npmCli) throw new Error("Run this command through an npm script");

const results = await Promise.all(
  scripts.map(
    (script) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [npmCli, "run", script], {
          stdio: "inherit",
        });

        child.on("error", (error) => {
          console.error(error);
          resolve(1);
        });

        child.on("exit", (code) => resolve(code ?? 1));
      }),
  ),
);

process.exitCode = results.some((code) => code !== 0) ? 1 : 0;
