// Assembles the built package as a Codex marketplace that is also the plugin,
// the package the release publishes to npm. Run after `npm run build`:
//   node scripts/assemble-release.mjs [--out release]
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

/**
 * main's marketplace. Its name becomes the plugin ID's suffix
 * (subagent-extension-for-codex@shemarlindie) and part of Codex's PLUGIN_DATA
 * path, so it must never change. The release reuses it, so an install from the
 * release keeps the same ID and data.
 */
const marketplace = JSON.parse(
  readFileSync(".agents/plugins/marketplace.json", "utf8"),
);

const { values } = parseArgs({
  options: { out: { type: "string", default: "release" } },
});

const out = resolve(values.out);

for (const entry of ["dist/main.js", "dist/stdio.js", "dist/app.html"]) {
  if (!existsSync(entry)) {
    throw new Error(`${entry} is missing; run npm run build first`);
  }
}

// Under npm, its own script runs through this Node, since Windows can't start
// the npm.cmd shim without a shell. tests/support/npm.ts does the same.
const npmCli = process.env.npm_execpath;
const npm = npmCli?.endsWith(".js") ? [process.execPath, npmCli] : ["npm"];

// npm's file list, so the plugin and any npm package ship the same files.
const [{ files }] = JSON.parse(
  execFileSync(
    npm[0],
    [...npm.slice(1), "pack", "--dry-run", "--json", "--ignore-scripts"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ),
);

rmSync(out, { recursive: true, force: true });

for (const { path } of files) {
  mkdirSync(dirname(join(out, path)), { recursive: true });
  cpSync(path, join(out, path));
}

// Nothing installs dependencies or runs scripts from the release. The
// manifest only marks the package root and carries its metadata.
const manifest = JSON.parse(readFileSync("package.json", "utf8"));

const slim = Object.fromEntries(
  [
    "name",
    "version",
    "description",
    "license",
    "author",
    "homepage",
    "repository",
    "bugs",
    "type",
    "engines",
  ]
    .filter((key) => key in manifest)
    .map((key) => [key, manifest[key]]),
);

writeFileSync(join(out, "package.json"), `${JSON.stringify(slim, null, 2)}\n`);

mkdirSync(join(out, ".agents/plugins"), { recursive: true });

writeFileSync(
  join(out, ".agents/plugins/marketplace.json"),
  `${JSON.stringify(
    {
      name: marketplace.name,
      interface: marketplace.interface,
      plugins: [
        {
          name: manifest.name,
          source: { source: "local", path: "./" },
          category: "Coding",
        },
      ],
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Release ${manifest.version}: ${files.length} files in ${out}; install as ${manifest.name}@${marketplace.name}`,
);
