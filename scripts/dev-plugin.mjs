// Install/update this checkout's plugin, or uninstall it:
//   npm run dev:plugin -- install|update|uninstall [--stop-service]
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { offerDrain } from "./dev-plugin-service.mjs";

const [operation, ...options] = process.argv.slice(2);
const stopRequested = options[0] === "--stop-service";

if (
  !["install", "update", "uninstall"].includes(operation) ||
  options.length > 1 ||
  (options.length && !stopRequested)
) {
  console.error(
    "Usage: npm run dev:plugin -- install|update|uninstall [--stop-service]",
  );

  process.exit(1);
}

const marketplace = JSON.parse(
  readFileSync(".agents/plugins/marketplace.json", "utf8"),
).name;

const { name } = JSON.parse(readFileSync("package.json", "utf8"));
const plugin = `${name}@${marketplace}`;
const codex = process.env.CODEX_BIN || "codex";

// Under npm, its own script runs through this Node, as in assemble-release.mjs.
const npmCli = process.env.npm_execpath;
const npm = npmCli?.endsWith(".js") ? [process.execPath, npmCli] : ["npm"];

function run(command, args) {
  const { status, error } = spawnSync(command, args, { stdio: "inherit" });

  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
}

// Don't list first: Codex's list command fails when a local source is missing.
function uninstall() {
  run(codex, ["plugin", "remove", plugin]);

  const { status, error, stderr } = spawnSync(
    codex,
    ["plugin", "marketplace", "remove", marketplace],
    { stdio: ["inherit", "inherit", "pipe"], encoding: "utf8" },
  );

  if (error) throw error;

  // Only the exact absent-marketplace error is harmless.
  const absent =
    status === 1 &&
    stderr.trim() ===
      `Error: marketplace \`${marketplace}\` is not configured or installed`;

  if (status !== 0 && !absent) {
    process.stderr.write(stderr);
    process.exit(status ?? 1);
  }
}

const removing = operation === "uninstall";

// Build before removing anything, so a failed build preserves the installation.
if (!removing) {
  run(npm[0], [...npm.slice(1), "run", "build"]);
  run(process.execPath, ["scripts/assemble-release.mjs"]);
}

// Reset the source too, allowing a switch from the published marketplace.
uninstall();

if (removing) {
  console.log(`Uninstalled ${plugin}. Task data is kept.
To return to the published plugin:
  codex plugin marketplace add shemarlindie/subagent-extension-for-codex
  codex plugin add ${plugin}`);
} else {
  run(codex, ["plugin", "marketplace", "add", resolve("release")]);
  run(codex, ["plugin", "add", plugin]);

  console.log(`Installed ${plugin} from release/.
Reopen the panel and restart Codex for the new proxy and skills.
Same-version backend changes need the running service to stop first.`);
}

if (
  !(await offerDrain(
    removing
      ? "Also stop the running service?"
      : "Restart the running service for the new build?",
    stopRequested,
  ))
) {
  console.error(
    `${plugin} is ${removing ? "uninstalled" : "installed"}, but the service wasn't drained.`,
  );

  process.exit(1);
}
