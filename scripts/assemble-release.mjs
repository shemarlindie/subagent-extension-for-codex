// Assembles each host's package from the build, the package the release
// publishes to npm. Each one is a Codex marketplace that is also the plugin.
// Run after `npm run build`:
//   node scripts/assemble-release.mjs [--host codex] [--out release]
// Writes <out>/<host> for every folder in plugins/, or only for --host.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
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
  options: {
    host: { type: "string" },
    out: { type: "string", default: "release" },
  },
});

for (const entry of ["dist/main.js", "dist/stdio.js", "dist/app.html"]) {
  if (!existsSync(entry)) {
    throw new Error(`${entry} is missing; run npm run build first`);
  }
}

/** What every package ships beside its plugin folder. */
const shared = ["dist", "migrations", "assets", "README.md", "LICENSE"];

const hosts = values.host
  ? [values.host]
  : readdirSync("plugins", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

// The root package.json is the version source and holds the shared metadata.
// The plugin folder's package.json names the package.
const rootManifest = JSON.parse(readFileSync("package.json", "utf8"));

for (const host of hosts) {
  const source = join("plugins", host);
  const out = resolve(values.out, host);

  rmSync(out, { recursive: true, force: true });
  cpSync(source, out, { recursive: true });

  for (const path of shared) {
    cpSync(path, join(out, path), { recursive: true });
  }

  const manifest = {
    ...rootManifest,
    ...JSON.parse(readFileSync(join(source, "package.json"), "utf8")),
  };

  // Nothing installs dependencies or runs scripts from the release. The
  // manifest only marks the package root and carries its metadata.
  const slim = Object.fromEntries(
    [
      "name",
      "version",
      "description",
      "keywords",
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

  writeFileSync(
    join(out, "package.json"),
    `${JSON.stringify(slim, null, 2)}\n`,
  );

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
    `Release ${manifest.version} in ${out}; install as ${manifest.name}@${marketplace.name}`,
  );
}
