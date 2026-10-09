// Large files for previews. Each one crosses a limit a viewer has to handle: a
// diff past the 8-file collapse, minified JSON, a 20,000-row table, a 30,000-line
// log past the 200K-character highlighting cap, long Markdown, a single 250 KB
// line, and an SVG over 64 KB that shows as source only.
// Contents are generated on first read (getters), so megabytes of text are only
// built when a file is first used.
import type { PreviewFile } from "../../../src/panel/features/file-preview/file-format";

/** Deterministic pseudo-random numbers, so fixtures are stable across loads. */
function random(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;

    return state / 2 ** 32;
  };
}

function lazy<T>(build: () => T) {
  let value: T | undefined;

  return () => (value ??= build());
}

const MODULES = [
  "react-dom",
  "lodash",
  "date-fns",
  "chart-core",
  "zod",
  "highlight",
  "markdown-it",
  "d3-scale",
  "immer",
  "router",
];

/** 60 files with ~7,000 changed lines: renames, deletions and new files included. */
const buildDiff = lazy(() => {
  const next = random(1),
    parts: string[] = [];

  for (let file = 0; file < 60; file++) {
    const path = `src/build/module-${String(file).padStart(2, "0")}.ts`;

    if (file === 3) {
      parts.push(
        `diff --git a/src/build/legacy-loader.ts b/src/build/loader.ts\nsimilarity index 92%\nrename from src/build/legacy-loader.ts\nrename to src/build/loader.ts\n--- a/src/build/legacy-loader.ts\n+++ b/src/build/loader.ts\n@@ -1,3 +1,3 @@\n-export const name = "legacy-loader";\n+export const name = "loader";\n export const version = 2;\n export default name;`,
      );

      continue;
    }

    if (file === 7) {
      const removed = Array.from(
        { length: 40 },
        (_, line) => `-export const unused${line} = ${line};`,
      );

      parts.push(
        `diff --git a/src/build/unused.ts b/src/build/unused.ts\ndeleted file mode 100644\n--- a/src/build/unused.ts\n+++ /dev/null\n@@ -1,40 +0,0 @@\n${removed.join("\n")}`,
      );

      continue;
    }

    const added = file % 9 === 0;
    const lines: string[] = [];
    let oldCount = 0,
      newCount = 0;

    for (let line = 0; line < 118; line++) {
      const roll = added ? 0 : next();
      const code = `  const value${line} = compute(${line}, "${MODULES[line % MODULES.length]}");`;

      if (added || roll < 0.35) {
        lines.push(`+${code.replace("compute", "computeCached")}`);
        newCount++;
      } else if (roll < 0.6) {
        lines.push(`-${code}`);
        oldCount++;
      } else {
        lines.push(` ${code}`);
        oldCount++;
        newCount++;
      }
    }

    parts.push(
      `diff --git a/${path} b/${path}\n${added ? "new file mode 100644\n--- /dev/null" : `--- a/${path}`}\n+++ b/${path}\n@@ -${added ? 0 : 1},${oldCount} +1,${newCount} @@\n${lines.join("\n")}`,
    );
  }

  return parts.join("\n") + "\n";
});

/** About 400 KB of minified JSON on one line. */
const bundleStats = lazy(() => {
  const next = random(2);

  return JSON.stringify({
    version: 5,
    builtAt: "2026-10-02T09:40:00Z",
    chunks: Array.from({ length: 1800 }, (_, index) => ({
      id: index,
      name: `chunk-${index.toString(36)}`,
      size: Math.round(next() * 90000),
      modules: MODULES.filter(() => next() < 0.4),
      initial: index < 12,
    })),
  });
});

/** 20,000 rows; some fields quote commas and newlines. */
const moduleSizes = lazy(() => {
  const next = random(3),
    rows = ['module,chunk,raw_bytes,gzip_bytes,"notes"'];

  for (let index = 0; index < 20000; index++) {
    const raw = Math.round(next() * 200000);

    rows.push(
      `node_modules/${MODULES[index % MODULES.length]}/file-${index}.js,chunk-${(index % 1800).toString(36)},${raw},${Math.round(raw * 0.31)},${index % 997 === 0 ? '"duplicated, see\nchunk report"' : ""}`,
    );
  }

  return rows.join("\n") + "\n";
});

/** 30,000 lines, past the highlighting cap. */
const buildLog = lazy(() => {
  const next = random(4),
    lines: string[] = [];

  for (let index = 0; index < 30000; index++) {
    const level = next() < 0.04 ? "WARN" : "INFO";

    lines.push(
      `2026-10-02T09:${String(Math.floor(index / 600) % 60).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z ${level} [${MODULES[index % MODULES.length]}] transformed file-${index}.js in ${Math.round(next() * 40)}ms`,
    );
  }

  return lines.join("\n") + "\n";
});

/** Over 100 KB of Markdown: many sections, tables and code blocks. */
const perfNotes = lazy(() => {
  const sections = ["# Build performance notes", ""];

  for (let index = 0; index < 360; index++) {
    const name = MODULES[index % MODULES.length];

    sections.push(
      `## ${index + 1}. ${name}`,
      "",
      `The **${name}** chunk grew by ${(index * 13) % 400} KB. See [the profile](https://example.com/profile/${index}) for details.`,
      "",
      "| Metric | Before | After |",
      "| --- | --- | --- |",
      `| Raw | ${index * 3} KB | ${index * 4} KB |`,
      `| Gzip | ${index} KB | ${index + 2} KB |`,
      "",
      "```ts",
      `import { ${name.replace(/-/g, "")} } from "${name}";`,
      `export const lazy${index} = () => import("${name}");`,
      "```",
      "",
      `- [${index % 2 ? "x" : " "}] Split ${name} into its own chunk`,
      "",
    );
  }

  return sections.join("\n");
});

/** One 250 KB minified line, which the preview wraps. */
const vendorBundle = lazy(() => {
  const parts: string[] = ['"use strict";'];

  for (let index = 0; parts.join("").length < 250_000; index++)
    parts.push(
      `var a${index}=function(e,t){return e+t*${index}};function b${index}(n){return a${index}(n,${index % 7})}`,
    );

  return parts.join("");
});

/** An SVG over 64 KB, which shows as source only. */
const dependencyGraph = lazy(() => {
  const next = random(5),
    nodes: string[] = [];

  for (let index = 0; index < 900; index++) {
    const x = Math.round(next() * 1180) + 10,
      y = Math.round(next() * 780) + 10;

    nodes.push(
      `<circle cx="${x}" cy="${y}" r="${3 + (index % 5)}" fill="hsl(${(index * 37) % 360} 70% 55%)"/><line x1="${x}" y1="${y}" x2="600" y2="400" stroke="#8884" stroke-width="0.5"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800"><rect width="1200" height="800" fill="#101418"/>${nodes.join("")}</svg>\n`;
});

function file(path: string, content: () => string): PreviewFile {
  return {
    path,
    get content() {
      return content();
    },
  };
}

/** The large files, each a fresh object whose content is built on first read. */
export function largeFiles(): PreviewFile[] {
  return [
    file("changes.diff", buildDiff),
    file("dist/bundle-stats.json", bundleStats),
    file("reports/module-sizes.csv", moduleSizes),
    file("logs/build.log", buildLog),
    file("docs/performance-notes.md", perfNotes),
    file("dist/vendor.min.js", vendorBundle),
    file("docs/dependency-graph.svg", dependencyGraph),
  ];
}
