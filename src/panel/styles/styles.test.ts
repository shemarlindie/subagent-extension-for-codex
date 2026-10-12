import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { test } from "vitest";

test("app.css imports every stylesheet partial exactly once", () => {
  const stylesheet = resolve("src/panel/styles/app.css");

  const imports = [
    ...readFileSync(stylesheet, "utf8").matchAll(
      /^@import "(\.{1,2}\/[^"]+)";$/gm,
    ),
  ].map((match) => resolve("src/panel/styles", match[1]));

  const partials = readdirSync("src/panel", {
    recursive: true,
    encoding: "utf8",
  })
    .filter((file) => file.endsWith(".css"))
    .map((file) => resolve("src/panel", file))
    .filter((file) => file !== stylesheet);

  assert.deepEqual([...imports].sort(), partials.sort());
});

test("theme accent and success states follow their host color tokens", () => {
  const theme = readFileSync("src/panel/styles/theme.css", "utf8");
  const base = readFileSync("src/panel/styles/primitives.css", "utf8");
  const panel = readFileSync("src/panel/app/styles/panel.css", "utf8");

  const activity = readFileSync(
    "src/panel/features/tasks/activity/activity.css",
    "utf8",
  );

  const questions = readFileSync(
    "src/panel/features/tasks/controls/questions.css",
    "utf8",
  );

  const files = readFileSync(
    "src/panel/features/file-preview/file-preview.css",
    "utf8",
  );

  assert.match(theme, /--accent:\s*var\(--color-text-info\);/);
  assert.match(theme, /--success:\s*var\(--color-text-success\);/);
  assert.match(base, /--focus-ring:[^;]*var\(--color-ring-primary\)/s);

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
    [files, ".diff-stat .add", "color"],
    [activity, ".row-status-icon.running", "color"],
    [activity, ".row-status-icon.completed", "color"],
    [activity, '.timeline-dot[data-status="running"]', "--dot-color"],
    [activity, '.timeline-dot[data-status="completed"]', "--dot-color"],
    [questions, ".question-step[data-answered] svg", "color"],
  ] as const) {
    assertRuleUsesSuccess(styles, selector, property);
  }
});

test("text selection uses host theme colors", () => {
  const theme = readFileSync("src/panel/styles/theme.css", "utf8");

  assert.match(
    theme,
    /::selection\s*\{[^}]*background-color:\s*color-mix\(in srgb, var\(--accent\) 24%, transparent\);[^}]*color:\s*inherit;/s,
  );
});
