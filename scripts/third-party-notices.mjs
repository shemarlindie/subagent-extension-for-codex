import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const packageDirectory = (path) =>
  path
    .replaceAll("\\", "/")
    .match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];

/**
 * Bundling drops the packages' own license files, so this collects them into
 * one notice for the bundle built from the `modules` paths. Returns the number
 * of packages it lists.
 */
export function writeThirdPartyNotices(file, bundle, modules) {
  const packages = [...new Set(modules.map(packageDirectory).filter(Boolean))];

  const notices = packages
    .map((directory) => {
      const manifest = JSON.parse(
        readFileSync(join(directory, "package.json"), "utf8"),
      );

      const licenseFile = readdirSync(directory).find((name) =>
        /^(licen[cs]e|copying)/i.test(name),
      );

      const text = licenseFile
        ? readFileSync(join(directory, licenseFile), "utf8").trim()
        : `License: ${manifest.license ?? "unspecified"} (no license file in the package)`;

      return { id: `${manifest.name}@${manifest.version}`, text };
    })
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((notice, index, all) => notice.id !== all[index - 1]?.id);

  writeFileSync(
    file,
    `Third-party software bundled into ${bundle}.\n\n${notices
      .map(
        ({ id, text }) =>
          `${"=".repeat(72)}\n${id}\n${"=".repeat(72)}\n\n${text}\n`,
      )
      .join("\n")}`,
  );

  return notices.length;
}
