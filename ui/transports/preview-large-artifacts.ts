// Large artifacts for the "Profile the production build" fixture task. Each one
// crosses a different limit: the snippet line cut, the 5,000-line preview cap,
// the 200K-character highlighting cap, the 8-file diff collapse, the 5,000-row
// table cap, the 64K cap on showing an SVG as itself (so it is rasterized),
// and a raster image needing a thumbnail.
// Contents are generated on first read (getters), so the fixture service only
// builds megabytes of text when this task's artifacts are first requested.
import type { Artifact } from "../../src/core/model";

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

/** A worker report shaped like Result, over 100 KB, that scrolls in the Report view. */
const profileReport = lazy(() =>
  JSON.stringify(
    {
      summary:
        "Profiled the production build: 1,800 chunks, 14.2 MB before compression. Most of the size comes from duplicated date and chart libraries.",
      findings: Array.from(
        { length: 2400 },
        (_, index) =>
          `chunk-${index.toString(36)} bundles ${MODULES[index % MODULES.length]} again (${(index * 37) % 900} KB).`,
      ),
      evidence: Array.from(
        { length: 120 },
        (_, index) => `Read dist/stats/chunk-${index}.json`,
      ),
      changes: [],
      tests: ["npm run build -- --profile — passed"],
      recommendations: [
        "Deduplicate date-fns through a shared vendor chunk.",
        "Lazy-load chart-core on the reports route.",
      ],
    },
    null,
    2,
  ),
);

/** 20,000 rows, past the preview's 5,000-row cap; some fields quote commas and newlines. */
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

/** 30,000 lines, past both the 5,000-line cap and the highlighting cap. */
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

/** One 250 KB minified line: the card cuts it; the preview wraps it. */
const vendorBundle = lazy(() => {
  const parts: string[] = ['"use strict";'];

  for (let index = 0; parts.join("").length < 250_000; index++)
    parts.push(
      `var a${index}=function(e,t){return e+t*${index}};function b${index}(n){return a${index}(n,${index % 7})}`,
    );

  return parts.join("");
});

/** An SVG over the 64 KB cap for showing it as itself, so the service rasterizes a thumbnail. */
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

const crcTable = lazy(() =>
  Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;

    return c >>> 0;
  }),
);

function crc32(bytes: Uint8Array) {
  const table = crcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);

  return (crc ^ 0xffffffff) >>> 0;
}

/** An uncompressed RGB PNG ("stored" deflate blocks), enough for fixture images. */
function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
) {
  const stride = width * 3 + 1,
    raw = new Uint8Array(stride * height);

  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // No row filter.

    for (let x = 0; x < width; x++)
      raw.set(pixel(x, y), y * stride + 1 + x * 3);
  }

  // zlib header, stored blocks of at most 65,535 bytes, then the Adler-32 checksum.
  const blocks = Math.ceil(raw.length / 65535),
    zlib = new Uint8Array(2 + raw.length + blocks * 5 + 4);

  zlib.set([0x78, 0x01]);
  let offset = 2,
    a = 1,
    b = 0;

  for (let start = 0; start < raw.length; start += 65535) {
    const length = Math.min(65535, raw.length - start);

    zlib.set(
      [
        start + length >= raw.length ? 1 : 0,
        length & 0xff,
        length >> 8,
        ~length & 0xff,
        (~length >> 8) & 0xff,
      ],
      offset,
    );

    zlib.set(raw.subarray(start, start + length), offset + 5);
    offset += 5 + length;
  }

  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }

  new DataView(zlib.buffer).setUint32(offset, ((b << 16) | a) >>> 0);

  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length);
    body.set([...type].map((char) => char.charCodeAt(0)));
    body.set(data, 4);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc32(body));

    return out;
  };

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB.

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib),
    chunk("IEND", new Uint8Array()),
  ];

  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;

  for (const part of parts) {
    png.set(part, position);
    position += part.length;
  }

  let binary = "";

  for (let start = 0; start < png.length; start += 0x8000)
    binary += String.fromCharCode(...png.subarray(start, start + 0x8000));

  return btoa(binary);
}

/** A flame-graph-like picture. */
function flamePixel(width: number, height: number) {
  return (x: number, y: number): [number, number, number] => {
    const u = x / width,
      v = y / height,
      band = Math.floor(v * 24),
      edge = Math.sin(u * (8 + band) * 3.1 + band) > 0.86;

    if (v < 0.08 || edge) return [24, 20, 28];

    return [
      200 + Math.round(55 * u),
      60 + Math.round(150 * (1 - v)),
      30 + ((band * 23) % 60),
    ];
  };
}

const flameGraph = lazy(() => encodePng(1200, 800, flamePixel(1200, 800)));

export const PROFILE_TASK = "preview-build-profile";

function artifact(
  id: string,
  type: string,
  title: string,
  mime_type: string,
  content: () => string,
  created_at: string,
): Artifact {
  return {
    id,
    task_id: PROFILE_TASK,
    type,
    title,
    mime_type,
    created_at,
    get content() {
      return content();
    },
  };
}

export const largeArtifactSpecs = [
  [
    "preview-build-diff",
    "diff",
    "Changes · attempt 1",
    "text/x-diff",
    buildDiff,
  ],
  [
    "preview-build-report",
    "report",
    "Build profile",
    "application/json",
    profileReport,
  ],
  [
    "preview-build-stats",
    "file",
    "bundle-stats.json",
    "application/json",
    bundleStats,
  ],
  ["preview-build-sizes", "report", "Module sizes", "text/csv", moduleSizes],
  ["preview-build-log", "log", "Build log", "text/plain", buildLog],
  [
    "preview-build-notes",
    "report",
    "Performance notes",
    "text/markdown",
    perfNotes,
  ],
  [
    "preview-build-vendor",
    "file",
    "vendor.min.js",
    "text/javascript",
    vendorBundle,
  ],
  [
    "preview-build-graph",
    "file",
    "dependency-graph.svg",
    "image/svg+xml",
    dependencyGraph,
  ],
  ["preview-build-flame", "file", "flame-graph.png", "image/png", flameGraph],
] as const;

export function largeArtifacts(createdAt: string): Artifact[] {
  return largeArtifactSpecs.map(([id, type, title, mime, content]) =>
    artifact(id, type, title, mime, content, createdAt),
  );
}
