---
name: review-and-improve
description: Review and improve current project changes for correctness, architecture, tests, cleanup, comments, and documentation under the project's instructions. Use whenever the user asks for an "improvement review", to "review and improve my changes", to clean up or harden the current diff/working tree before committing, or invokes /review-and-improve. Supports a review-only mode that reports findings without editing.
argument-hint: "[review-only] [branch]"
---

Review the project changes and resolve actionable findings within the requested scope. With `review-only`, report findings without editing. Preserve unrelated pre-existing changes. By default, review uncommitted changes. With `branch`, review every commit since `main` plus uncommitted changes. Apply the chosen scope to every step.

[AGENTS.md](../../../AGENTS.md) sets the standard for every step, including what to read, code conventions, validation and writing style. This skill adds only the review procedure.

1. **Establish scope.** Inspect the diff for the chosen scope, the relevant code, and any directory-specific `CLAUDE.md` or `AGENTS.md` files. Identify the affected areas and validation commands.
2. **Inspect the changes.** Review correctness, regressions, unintended behavior and simplicity, flagging over-engineering in new and touched code. Preserve intentional behavior, and separate it from defects.
   - Check tests against [Choosing test coverage](../../../docs/development.md#choosing-test-coverage).
   - Check module placement and runtime boundaries against [Code ownership](../../../docs/architecture.md#code-ownership), focusing on what Oxlint does not enforce.
   - Check documentation for accuracy. Flag missing docs only where readers would get behavior, contracts or constraints wrong. Flag docs that restate expected behavior or code.
   - Walk each section of AGENTS.md against the diff. Report the sections you checked and any violations. An informal read of the diff does not count.
3. **Review UI design.** When the change touches panel UI, styles or client state, check the rendered result against the [Design review](../../../docs/ui-verification.md#design-review) checklist. Fix checklist failures. Recommend broader design changes, and flag visual patterns the change does not need.
4. **Prioritize findings.** Group actionable findings by area, and handle them in a deliberate order.
5. **Fix and validate each group.** Before editing, confirm the approach follows the instructions and established patterns. Keep fixes focused. Add comments that explain non-obvious intent, constraints or meaningful blocks. After moving docs, run markdownlint and check cross-file links. Reassess the group's code, tests and docs, and validate its behavior and boundaries before moving on.
6. **Validate and report.** Run `npm test`, or `npm run check` for a faster pass without tests. Reuse earlier results when no later change invalidates them. Isolate failures with the focused scripts in [Checks](../../../docs/development.md#checks). Flag new `oxlint-suppressions.json` entries and new file length or complexity exceptions. Report findings, resolutions and checks run or skipped. Skip report lines for steps that add nothing.
