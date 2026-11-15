// The recorder must load before React DOM. Import sorting keeps a side-effect
// import in place.
import "./render-recorder";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, test, vi } from "vitest";

import { unreachedComponents, type Render } from "./render-recorder";
import { scenarios } from "./render-scenarios/index";
import {
  runScenario,
  type Scenario,
  type ScenarioResult,
} from "./render-scenarios/scenario";

// Vitest runs from the repository root.
const OUTPUT = join(process.cwd(), "render-report");

const results: { scenario: Scenario; result: ScenarioResult }[] = [];
const unstable = new Set<string>();

beforeAll(async () => {
  // Every panel component registers as its module loads, so the report can
  // list the ones no scenario reached.
  const modules = import.meta.glob([
    "../../../src/panel/**/*.tsx",
    "!**/*.test.tsx",
    "!**/*-test-harness.tsx",
  ]);

  await Promise.all(Object.values(modules).map((load) => load()));
});

// Spies reset after each test, so each test spies again.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation((message, selector) => {
    if (String(message).startsWith("useSnapshot")) {
      unstable.add(firstLine(selector));
    }
  });
});

for (const scenario of scenarios) {
  test(scenario.label, async (t) => {
    results.push({ scenario, result: await runScenario(t, scenario) });
  });
}

afterAll(() => {
  mkdirSync(OUTPUT, { recursive: true });
  const file = join(OUTPUT, "render-report.md");
  writeFileSync(file, report());
  console.info(`Render report: ${file}`);
});

const firstLine = (value: unknown) => String(value).split("\n")[0] ?? "";

/** Our components' renders that update an existing component. */
const updates = (renders: Render[]) =>
  renders.filter(({ ours, mount }) => ours && !mount);

const path = (names: string[]) => names.slice(-4).join(" › ") || "(root)";

/** Counts rows by key, most frequent first. */
function tally<T>(rows: T[], key: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);

  return [...counts].sort(([, a], [, b]) => b - a);
}

function summary() {
  const rows = results.map(({ scenario, result }) => {
    const renders = updates(result.renders);

    return [
      scenario.label,
      scenario.group,
      result.commits,
      result.notifications,
      renders.length,
      renders.filter(({ wasted }) => wasted).length,
      result.remounts.filter(({ ours }) => ours).length,
      result.transients.filter(({ ours }) => ours).length,
      result.warnings,
    ].join(" | ");
  });

  return [
    "| Scenario | Group | Commits | Notifications | Renders | Wasted | Remounts | Transient | Warnings |",
    "| --- | --- | --: | --: | --: | --: | --: | --: | --: |",
    ...rows.map((row) => `| ${row} |`),
  ];
}

function findings() {
  return results.flatMap(({ scenario, result }) => {
    const wasted = tally(
      updates(result.renders).filter(({ wasted }) => wasted),
      ({ name, cause, path: names }) =>
        `${name} | ${cause ?? ""} | ${path(names)}`,
    );

    const remounts = result.remounts.filter(({ ours }) => ours);
    const transients = result.transients.filter(({ ours }) => ours);
    if (!wasted.length && !remounts.length && !transients.length) return [];

    return [
      `### ${scenario.label}`,
      "",
      ...(wasted.length
        ? [
            "| Wasted | Cause | Path | Count |",
            "| --- | --- | --- | --: |",
            ...wasted.map(([row, count]) => `| ${row} | ${count} |`),
            "",
          ]
        : []),
      ...remounts.map(
        ({ name, path: names }) => `- Remounted: ${name} in ${path(names)}`,
      ),
      ...transients.map(
        ({ name, path: names }) =>
          `- Rendered and returned to its first output: ${name} in ${path(names)}`,
      ),
      ...(remounts.length || transients.length ? [""] : []),
    ];
  });
}

function report() {
  const unreached = unreachedComponents();

  return [
    "# Panel render report",
    "",
    `${results.length} scenarios. Counts cover components declared in \`src/panel\`. A render is wasted when its output matches the output before it. See [Panel architecture](../docs/panel-architecture.md#render-report).`,
    "",
    "## Summary",
    "",
    ...summary(),
    "",
    "## Findings",
    "",
    ...findings(),
    "## Selections that change on every patch",
    "",
    ...(unstable.size
      ? [...unstable].map((selector) => `- \`${selector}\``)
      : ["None."]),
    "",
    "## Components no scenario rendered",
    "",
    ...(unreached.length ? unreached.map((name) => `- ${name}`) : ["None."]),
    "",
  ].join("\n");
}
