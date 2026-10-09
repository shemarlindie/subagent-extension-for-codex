import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

import { build } from "esbuild";

const outdir = "dist";

const result = await build({
  entryPoints: {
    main: "src/service/main.ts",
    stdio: "src/service/stdio.ts",
    "projects-cli": "src/service/projects-cli.ts",
  },
  outdir,
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
  (path) =>
    /^(dev|tests|src\/panel)\//.test(path) ||
    /\.test\.[cm]?[jt]sx?$/.test(path),
);

if (forbidden.length)
  throw new Error(
    `Backend bundle includes non-production code:\n${forbidden.join("\n")}`,
  );

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

if (unexpected.length)
  throw new Error(
    `Backend bundle leaves packages external:\n${unexpected.join("\n")}`,
  );

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

const javascript = Object.entries(outputs)
  .filter(([path]) => path.endsWith(".js"))
  .reduce((total, [, output]) => total + output.bytes, 0);

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

console.log(
  `Backend: ${mb(javascript)} JavaScript, ${packages.length} bundled packages`,
);
