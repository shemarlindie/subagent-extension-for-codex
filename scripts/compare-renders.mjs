// Compares render report results between two versions of the panel. Render
// times vary between runs, so `save` keeps each scenario's median time.
//
//   node scripts/compare-renders.mjs save <name> [runs]
//   node scripts/compare-renders.mjs <before> <after>
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RUNS = join("render-report", "runs");

const cells = (line) =>
  line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

/** The latest report's summary rows, keyed by column name. */
function readSummary() {
  const report = readFileSync("render-report/render-report.md", "utf8");

  const [header, , ...rows] = report
    .split("## Summary")[1]
    .split("\n## ")[0]
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map(cells);

  return rows.map((row) =>
    Object.fromEntries(header.map((name, index) => [name, row[index]])),
  );
}

const median = (values) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];

/** Runs the report `runs` times and saves each scenario's results as `name`. */
function save(name, runs) {
  const scenarios = {};

  for (let run = 0; run < runs; run++) {
    execSync("npm run report:renders", { stdio: "ignore" });

    for (const row of readSummary()) {
      scenarios[row.Scenario] ??= {
        renders: Number(row.Renders),
        wasted: Number(row.Wasted),
        times: [],
      };

      scenarios[row.Scenario].times.push(Number(row["Render ms"]));
    }
  }

  const results = Object.entries(scenarios).map(
    ([label, { times, ...counts }]) => [
      label,
      { ...counts, ms: median(times) },
    ],
  );

  mkdirSync(RUNS, { recursive: true });

  writeFileSync(
    join(RUNS, `${name}.json`),
    JSON.stringify(Object.fromEntries(results), null, 2),
  );
}

const load = (name) =>
  JSON.parse(readFileSync(join(RUNS, `${name}.json`), "utf8"));

const percent = (before, after) =>
  `${Math.round(((after - before) / before) * 100)}%`;

/** Prints scenarios whose renders changed, then totals for all of them. */
function compare(beforeName, afterName) {
  const before = load(beforeName);
  const after = load(afterName);
  const labels = Object.keys(before).filter((label) => label in after);
  const saved = (label) => before[label].wasted - after[label].wasted;

  const changed = labels
    .filter(
      (label) =>
        before[label].renders !== after[label].renders ||
        before[label].wasted !== after[label].wasted,
    )
    .toSorted((a, b) => saved(b) - saved(a));

  const lines = [
    "| Scenario | Renders | Wasted | Render ms (median) |",
    "| --- | --: | --: | --: |",
    ...changed.map((label) => {
      const [a, b] = [before[label], after[label]];

      return `| ${label} | ${a.renders} → ${b.renders} | ${a.wasted} → ${b.wasted} | ${a.ms.toFixed(2)} → ${b.ms.toFixed(2)} |`;
    }),
  ];

  const total = (runs, field) =>
    labels.reduce((sum, label) => sum + runs[label][field], 0);

  const [msBefore, msAfter] = [total(before, "ms"), total(after, "ms")];

  lines.push(
    "",
    `All ${labels.length} scenarios: wasted ${total(before, "wasted")} → ${total(after, "wasted")}, render ms ${msBefore.toFixed(1)} → ${msAfter.toFixed(1)} (${percent(msBefore, msAfter)})`,
  );

  console.info(lines.join("\n"));
}

const [command, ...args] = process.argv.slice(2);

if (command === "save" && args[0]) {
  save(args[0], Number(args[1] ?? 7));
} else if (command && args[0]) {
  compare(command, args[0]);
} else {
  throw new Error(
    "Usage: compare-renders.mjs save <name> [runs] | <before> <after>",
  );
}
