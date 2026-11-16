import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test, type TestContext } from "vitest";

const script = fileURLToPath(
  new URL("../../../scripts/compare-renders.mjs", import.meta.url),
);

async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "compare-renders-"));
  t.onTestFinished(() => rm(path, { recursive: true, force: true }));

  return path;
}

const run = (cwd: string, ...args: string[]) =>
  execFileSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });

test("save keeps each scenario's counts and median render time", async (t) => {
  const cwd = await directory(t);

  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ scripts: { "report:renders": "node report.mjs" } }),
  );

  // Writes a report whose render time changes on each run.
  await writeFile(
    join(cwd, "report.mjs"),
    `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
let run = 0;
try { run = Number(readFileSync("run", "utf8")); } catch {}
writeFileSync("run", String(run + 1));
mkdirSync("render-report", { recursive: true });
writeFileSync("render-report/render-report.md", \`# Panel render report

## Summary

| Scenario | Group | Commits | Notifications | Renders | Wasted | Remounts | Transient | Warnings | Render ms |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: |
| Open a dialog | One-off | 10 | 3 | 341 | 257 | 0 | 0 | 0 | \${[3, 1, 4, 2][run]}.00 |

## Findings

| Wasted | Cause | Path | Count |
| --- | --- | --- | --: |
| Icon | parent rendered with the same props | Button | 2 |
\`);
`,
  );

  run(cwd, "save", "main", "4");

  assert.deepEqual(
    JSON.parse(
      await readFile(join(cwd, "render-report/runs/main.json"), "utf8"),
    ),
    { "Open a dialog": { renders: 341, wasted: 257, ms: 2.5 } },
  );
});

test("compare lists changed scenarios, most saved first, then totals", async (t) => {
  const cwd = await directory(t);
  const runs = join(cwd, "render-report/runs");
  await mkdir(runs, { recursive: true });

  const save = (name: string, results: object) =>
    writeFile(join(runs, `${name}.json`), JSON.stringify(results));

  await save("before", {
    Same: { renders: 5, wasted: 2, ms: 1 },
    Small: { renders: 10, wasted: 6, ms: 2 },
    Large: { renders: 40, wasted: 30, ms: 5 },
  });

  await save("after", {
    Same: { renders: 5, wasted: 2, ms: 0.9 },
    Small: { renders: 9, wasted: 5, ms: 2 },
    Large: { renders: 20, wasted: 10, ms: 2 },
  });

  assert.equal(
    run(cwd, "before", "after"),
    `| Scenario | Renders | Wasted | Render ms (median) |
| --- | --: | --: | --: |
| Large | 40 → 20 | 30 → 10 | 5.00 → 2.00 |
| Small | 10 → 9 | 6 → 5 | 2.00 → 2.00 |

All 3 scenarios: wasted 38 → 17, render ms 8.0 → 4.9 (-39%)
`,
  );
});
