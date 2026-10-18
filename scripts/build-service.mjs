import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

import { build } from "esbuild";

import { testModule } from "./lint/source-boundaries.mjs";

const outdir = "dist";

// package.json is the version source. plugin.json repeats it for Codex, so a mismatch fails the build.
const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
const plugin = JSON.parse(readFileSync("plugin.json", "utf8"));

if (plugin.version !== packageManifest.version) {
  throw new Error(
    `plugin.json version ${plugin.version} differs from package.json version ${packageManifest.version}`,
  );
}

const entries = {
  main: "src/service/main.ts",
  stdio: "src/service/stdio.ts",
  "projects-cli": "src/service/projects-cli.ts",
};

const result = await build({
  entryPoints: entries,
  // Public entries in dist/ are version guards that load these bundles.
  outdir: join(outdir, "bundle"),
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  packages: "bundle",
  platform: "node",
  target: "node24",
  format: "esm",
  splitting: true,
  // Bundled CommonJS (express, body-parser, debug) requires built-ins, which ESM output can only do through a real require.
  banner: {
    js: 'import { createRequire as __bundleCreateRequire } from "node:module"; const require = __bundleCreateRequire(import.meta.url);',
  },
  sourcemap: true,
  // Stack traces need only file and line mappings; embedded sources would triple the maps' size.
  sourcesContent: false,
  metafile: true,
  logLevel: "warning",
});

const { inputs, outputs } = result.metafile;

// Development, UI and test code must never reach the service bundle.
const forbidden = Object.keys(inputs).filter(
  (path) => /^(dev|tests|src\/panel)\//.test(path) || testModule.test(path),
);

if (forbidden.length) {
  throw new Error(
    `Backend bundle includes non-production code:\n${forbidden.join("\n")}`,
  );
}

// Only Node built-ins stay external; supports-color is debug's optional probe, which falls back when it is missing.
const builtins = new Set(builtinModules);

const allowedExternal = (path) =>
  path.startsWith("node:") || builtins.has(path) || path === "supports-color";

const externals = new Set(
  Object.values(outputs).flatMap((output) =>
    output.imports.filter((i) => i.external).map((i) => i.path),
  ),
);

const unexpected = [...externals].filter((path) => !allowedExternal(path));

if (unexpected.length) {
  throw new Error(
    `Backend bundle leaves packages external:\n${unexpected.join("\n")}`,
  );
}

// Bundling drops the packages' own license files, so collect them into one notice.
const packageDirectory = (path) =>
  path.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];

const packages = [
  ...new Set(Object.keys(inputs).map(packageDirectory).filter(Boolean)),
];

const notices = packages
  .map((directory) => {
    const manifest = JSON.parse(
      readFileSync(join(directory, "package.json"), "utf8"),
    );

    const licenseFile = readdirSync(directory).find((file) =>
      /^(licen[cs]e|copying)/i.test(file),
    );

    const text = licenseFile
      ? readFileSync(join(directory, licenseFile), "utf8").trim()
      : `License: ${manifest.license ?? "unspecified"} (no license file in the package)`;

    return { id: `${manifest.name}@${manifest.version}`, text };
  })
  .sort((a, b) => a.id.localeCompare(b.id))
  .filter((notice, index, all) => notice.id !== all[index - 1]?.id);

writeFileSync(
  join(outdir, "THIRD_PARTY_LICENSES.txt"),
  `Third-party software bundled into this package's dist/ JavaScript.\n\n${notices
    .map(
      ({ id, text }) =>
        `${"=".repeat(72)}\n${id}\n${"=".repeat(72)}\n\n${text}\n`,
    )
    .join("\n")}`,
);

// An old Node fails to parse or link the bundle before any check in it runs, so
// each public entry checks the version first, in syntax old runtimes accept.
const minimumNode = Number(
  packageManifest.engines.node.match(/^>=(\d+)$/)?.[1],
);

if (!minimumNode) {
  throw new Error('package.json engines.node must have the form ">=<major>"');
}

for (const name of Object.keys(entries)) {
  await build({
    stdin: {
      contents: `import { nodeVersionError } from "./src/service/platform/service/node-version.ts";
const error = nodeVersionError(process.versions.node, process.execPath, ${minimumNode});
if (error) {
  console.error(error);
  process.exitCode = 1;
} else {
  import("./bundle/${name}.js");
}
`,
      resolveDir: ".",
      loader: "ts",
      sourcefile: `${name}-entry.ts`,
    },
    outfile: join(outdir, `${name}.js`),
    bundle: true,
    external: ["./bundle/*"],
    platform: "node",
    target: "es2017",
    format: "esm",
    logLevel: "warning",
  });
}

const javascript = Object.entries(outputs)
  .filter(([path]) => path.endsWith(".js"))
  .reduce((total, [, output]) => total + output.bytes, 0);

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

console.log(
  `Backend: ${mb(javascript)} JavaScript, ${packages.length} bundled packages`,
);
