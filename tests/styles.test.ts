import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { test } from "vitest";

test("app.css imports every stylesheet partial exactly once", () => {
  const imports = [
    ...readFileSync("ui/styles/app.css", "utf8").matchAll(
      /^@import "\.\/([^"]+)";$/gm,
    ),
  ].map((match) => match[1]);

  const partials = ["shared", "surfaces"].flatMap((dir) =>
    readdirSync(`ui/styles/${dir}`).map((file) => `${dir}/${file}`),
  );

  assert.deepEqual(
    [...imports].sort(),
    ["theme.css", "base.css", ...partials].sort(),
  );
});

test("theme accent and success states follow their host color tokens", () => {
  const theme = readFileSync("ui/styles/theme.css", "utf8");
  const base = readFileSync("ui/styles/shared/base.css", "utf8");
  const panel = readFileSync("ui/styles/surfaces/panel.css", "utf8");
  const activity = readFileSync("ui/styles/shared/activity.css", "utf8");
  const questions = readFileSync("ui/styles/shared/questions.css", "utf8");

  assert.match(theme, /--accent:\s*var\(--color-ring-primary\);/);
  assert.match(theme, /--success:\s*var\(--color-text-success\);/);
  assert.match(base, /--focus-ring:[^;]*var\(--accent\)/s);

  const assertRuleUsesSuccess = (
    styles: string,
    selector: string,
    property: string,
  ) => {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const rule = styles.match(
      new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`),
    );

    assert.ok(rule, `Missing CSS rule for ${selector}`);
    assert.match(rule[1], new RegExp(`${property}:\\s*var\\(--success\\);`));
  };

  for (const [styles, selector, property] of [
    [panel, ".dot.running", "background"],
    [panel, ".dot.completed", "background"],
    [panel, ".diff-line.add", "color"],
    [activity, ".row-status-icon.running", "color"],
    [activity, ".row-status-icon.completed", "color"],
    [activity, '.timeline-dot[data-status="running"]', "--dot-color"],
    [activity, '.timeline-dot[data-status="completed"]', "--dot-color"],
    [questions, ".question-step[data-answered] svg", "color"],
  ] as const) {
    assertRuleUsesSuccess(styles, selector, property);
  }
});
