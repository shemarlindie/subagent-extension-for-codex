import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join } from "node:path";

import { build } from "esbuild";

const outdir = "dist";

const result = await build({
  entryPoints: {
    main: "src/main.ts",
    stdio: "src/stdio.ts",
    "projects-cli": "src/projects-cli.ts",
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
    /^(dev|ui|tests)\//.test(path) || /\.test\.[cm]?[jt]sx?$/.test(path),
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

// The SDK's platform package holds the Claude Code binary for this host; it ships as a plain file.
const require = createRequire(import.meta.url);
const sdkEntry = require.resolve("@anthropic-ai/claude-agent-sdk");

const sdkVersion = JSON.parse(
  readFileSync(join(dirname(sdkEntry), "package.json"), "utf8"),
).version;

const musl =
  process.platform === "linux" &&
  !process.report.getReport().header.glibcVersionRuntime;

const platformPackages =
  process.platform === "linux"
    ? musl
      ? [`linux-${process.arch}-musl`, `linux-${process.arch}`]
      : [`linux-${process.arch}`, `linux-${process.arch}-musl`]
    : [`${process.platform}-${process.arch}`];

const sdkRequire = createRequire(sdkEntry);

const platformDirectory = platformPackages
  .map((suffix) => {
    try {
      return dirname(
        sdkRequire.resolve(
          `@anthropic-ai/claude-agent-sdk-${suffix}/package.json`,
        ),
      );
    } catch {
      return undefined;
    }
  })
  .find(Boolean);

if (!platformDirectory)
  throw new Error(
    `No Claude Code platform package for ${process.platform}-${process.arch}; reinstall without --omit=optional`,
  );

const platformVersion = JSON.parse(
  readFileSync(join(platformDirectory, "package.json"), "utf8"),
).version;

if (platformVersion !== sdkVersion)
  throw new Error(
    `Claude Code platform package ${platformVersion} does not match the bundled SDK ${sdkVersion}; reinstall dependencies`,
  );

const binary = process.platform === "win32" ? "claude.exe" : "claude";
mkdirSync(join(outdir, "claude"), { recursive: true });
copyFileSync(join(platformDirectory, binary), join(outdir, "claude", binary));
chmodSync(join(outdir, "claude", binary), 0o755);

copyFileSync(
  join(platformDirectory, "LICENSE.md"),
  join(outdir, "claude", "LICENSE.md"),
);

const javascript = Object.entries(outputs)
  .filter(([path]) => path.endsWith(".js"))
  .reduce((total, [, output]) => total + output.bytes, 0);

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

console.log(
  `Backend: ${mb(javascript)} JavaScript, ${packages.length} bundled packages, Claude Code binary from SDK ${sdkVersion} ${mb(statSync(join(outdir, "claude", binary)).size)}`,
);
