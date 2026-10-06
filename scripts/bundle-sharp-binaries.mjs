// sharp loads a prebuilt libvips binary from an optional, platform-specific
// package, and npm installs only the current machine's. The package bundles
// node_modules, so before packing this adds the other macOS architecture's
// binaries too: a tarball packed on Apple Silicon then also works on Intel Macs,
// and the reverse. Runs from `prepack`; safe to run repeatedly.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sharp = JSON.parse(
  readFileSync("node_modules/sharp/package.json", "utf8"),
);

const wanted = Object.entries(sharp.optionalDependencies).filter(([name]) =>
  /^@img\/sharp-(libvips-)?darwin-(arm64|x64)$/.test(name),
);

const scratch = mkdtempSync(join(tmpdir(), "sharp-binaries-"));

try {
  for (const [name, version] of wanted) {
    const target = join("node_modules", name);

    let installed;

    try {
      installed = JSON.parse(
        readFileSync(join(target, "package.json"), "utf8"),
      );
    } catch {}

    if (installed?.version === version) continue;

    // npm refuses to install another CPU's package, so fetch and unpack it.
    // Override outer pack flags without dropping registry or auth settings.
    const tarball = execFileSync(
      "npm",
      [
        "pack",
        `${name}@${version}`,
        "--pack-destination",
        scratch,
        "--silent",
        "--no-dry-run",
        "--no-json",
      ],
      { encoding: "utf8" },
    ).trim();

    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });

    execFileSync("tar", [
      "-xzf",
      join(scratch, tarball),
      "-C",
      target,
      "--strip-components=1",
    ]);

    console.log(`Bundled ${name}@${version}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
