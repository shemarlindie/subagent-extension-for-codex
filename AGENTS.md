# Agent instructions

Keep things simple. Avoid over-engineering.

## What to read

- To understand the product, read the [README](README.md) introduction and
  [Start a task](README.md#start-a-task).
- Before choosing an approach for design or implementation work, including fixes
  and refactors, inspect the relevant code and instructions and read
  [Architecture](docs/architecture.md).
- Before changing code, read
  [Choosing a development tool](docs/development.md#choosing-a-development-tool)
  and [Checks](docs/development.md#checks). Read setup only when running or
  configuring the project.
- Before adding, changing or removing tests, read
  [Choosing test coverage](docs/development.md#choosing-test-coverage).
- Before creating a branch, committing or opening a pull request, read
  [Commits, pull requests and branches](CONTRIBUTING.md#commits-pull-requests-and-branches).

Also read the guides that match the work area. When unsure whether one applies,
check it.

- UI components, styles or client state:
  [Panel architecture](docs/panel-architecture.md) and
  [Panel behavior](docs/panel-guide.md).
- Browser checks, fixtures or dev servers:
  [UI verification](docs/ui-verification.md).
- Provider execution, permissions or session policy:
  [Provider contract](docs/provider-contract.md) and relevant
  [Configuration](docs/configuration.md) sections.
- Claude executable selection, readiness or SDK/CLI upgrades:
  [Claude Code CLI](docs/claude-cli.md) and
  [version qualification](docs/claude-verification.md#qualifying-claude-code-versions).
- Settings, budgets or repository access: relevant
  [Configuration](docs/configuration.md) sections.
- MCP tools, user authority or panel inputs:
  [MCP reference](docs/mcp-reference.md).
- Host context, project/chat scope, entrypoints or mentions:
  [Host capabilities](docs/host-capabilities.md).
- Startup, continuation, recovery or storage:
  [Task continuation](docs/task-continuation.md), plus
  [Database and migrations](docs/database.md) for schema changes or migrations.
- Capability claims or verification gaps:
  [Host capabilities](docs/host-capabilities.md) and
  [Claude execution verification](docs/claude-verification.md). Inspect evidence
  only for the claim at hand.

## Code conventions

- Follow established patterns when suitable. Keep modules cohesive, and keep
  responsibility boundaries, state and lifecycle ownership, and dependency
  direction clear. Fix architectural weaknesses the change introduces or
  directly affects. Leave broader improvements as recommendations.
- Before implementing, choose the simplest approach that meets the current
  requirements. Avoid speculative options, generality, layers and handling for
  cases that cannot occur, in code, tests, docs and plans. Within the affected
  area, simplify over-engineered code and remove duplication, obsolete code and
  needless indirection.
- Reuse existing components, logic, styles and infrastructure where
  responsibilities align. Keep distinct behavior and presentation where the
  domain requires them. Add an abstraction only when it removes real duplication
  or clarifies ownership, and keep it free of excess configuration or coupling.
- Organize modules by feature ownership and reasons to change. Keep a feature's
  logic, types, UI and styles together, and group subfolders by responsibility.
  - Panel domain logic goes in `src/panel/features`, generic helpers in
    `src/panel/shared/utils`, and application composition and state in
    `src/panel/app/state`. Limit panel shared code to stable cross-feature
    concepts and platform integrations.
  - Browser-safe contracts and domain functions used by both runtimes go in
    feature-scoped `src/shared` modules, which must not import service execution
    or panel rendering.
- Keep components and utilities small and focused. Components render, and
  reusable helpers live in their owning modules. Split files by responsibility
  without needless fragmentation, normally one React component per file, with
  kebab-case filenames.
- Name components for their actual scope. Use a generic name only when the
  component and its styling are genuinely reusable.
- Prefer Base UI where suitable.
- Prefer named prop and state types. Use existing types or `satisfies` when they
  simplify code or replace repeated assertions.
- Keep large collapsed sections lightweight. Unmount expensive child rows while
  closed, and show a loader when asynchronous or deferred rendering needs
  feedback.
- Follow the repository's Oxlint rules.
- Put repository skills in `.agents/skills`, which Codex reads. Add a stub with
  the same frontmatter in `.claude/skills` that links to the shared skill.

## Validation

- Validate the resulting behavior and the relevant architectural boundaries.
  Prefer focused checks while iterating. Skip or defer expensive checks when
  their runtime outweighs the confidence they add, and report what you skipped
  and why.
- Before committing, run the relevant formatting, lint, type, test, build and
  browser checks against the final changes. Format changed files as
  [Checks](docs/development.md#checks) describes, and run the
  `review-and-improve` skill on the changes.
- HTTP integration suites need localhost TCP listeners on `127.0.0.1`. Request
  sandbox escalation up front if needed. Never skip these tests because listener
  binding is denied. CI runners need the same access.
- Report meaningful design decisions, intentional departures from established
  patterns and remaining concerns, in proportion to the change.

### Browser checks

Check in the browser when a change is large, when seeing it would help, or when
the user asks. Skip small changes that tests cover.

- For large changes, use the `verify-features` skill. Otherwise a screenshot of
  the affected state is enough.
- Follow [UI verification](docs/ui-verification.md). Use fixture data, and use
  live data only for behavior fixtures cannot show. Never start tasks in live
  mode.
- Add a fixture for every new event or activity row kind.

### Large changes

- Confirm external behavior or an unproven approach with a small probe or
  prototype before building on it.
- Plan a verification checklist of expected behaviors with IDs, and list
  accepted limits separately. Have each planned commit name the IDs it verifies.
  Evidence can be a new or existing test or a browser check. Keep IDs in the
  plan, out of code and test names.

### Test and documentation levels

Users may ask for a level, such as "test at level 1" or "document at level 3".
[Test levels](docs/development.md#test-levels) and
[documentation levels](#documentation-levels) run from 1 to 5 and control the
breadth of additions.

- Default to level 2 for both. Go higher only for a concrete changed contract,
  failure mode or reader task the default leaves unaddressed. Expand only as far
  as that need requires, and name the reason in the final report.
- A level is a ceiling, never a quota. Adding nothing is valid when existing
  coverage or documentation suffices. Levels never reduce required checks, fixes
  for broken behavior, accuracy or meaningful assertions, and never justify
  duplicate coverage, repeated explanations or speculative cases.
- Never weaken an assertion to hide a regression. Fix the code.
- When a ceiling leaves material risk, use existing tests or authorized manual
  verification where possible and report the precise gap. Ask only when the task
  requires scope beyond the level.
- Before finishing, remove test and documentation additions that give no
  distinct regression protection or needed reader guidance.

## Working environment

- Zsh does not split unquoted variables and fails on unmatched globs. Pipe file
  lists to `xargs`, use arrays such as `"${files[@]}"`, and quote glob patterns
  such as `--include='*.ts'`.
- In a worktree session, keep git commands inside the session worktree, such as
  with `git -C <worktree path>`.
- Check for a running dev server before starting one. If the port belongs to
  this app, open its URL instead.
- If needed, check that the built-in browser pane is shown before taking
  screenshots or running page scripts. Ask the user to show it when it is
  hidden.
- Write scratch files to the session scratchpad, not `/tmp`.

## Writing style

These rules apply to everything you write, including code comments,
documentation, commit messages, pull requests, plans and chat replies.

- Use plain language, active voice and direct statements. Start with the main
  point, then add the context, reasons and examples the reader needs.
- Be concise, precise and consistent. Keep claims accurate, explain uncertainty
  and avoid repetition. Skip obvious or expected behavior, including what stays
  the same.
- Use short paragraphs. Add headings, lists or tables when they help.
- Avoid semicolons and dashes in sentences. Keep them where needed in code,
  commands, formatting and hyphenated words.
- Avoid “not X, but Y” phrasing and equivalents such as “rather than” or “not
  just,” unless the contrast is the clearest way to make an important point.

## Documentation

- Update documentation when the user asks, or when a change makes guidance
  inaccurate or leaves a question readers need answered. Make the smallest
  sufficient edit in the canonical home.
- Give each guide a clear purpose and audience. Keep the README to orientation
  and setup, and put procedures and contracts in their owning guides. Include
  implementation details, safeguards and verification results only when readers
  need them to use, operate or change the feature.
- Keep one canonical home for each explanation and link to it elsewhere, with
  only a brief local summary. Update in place, remove superseded material after
  keeping its useful details, and check affected links and headings.
- Describe current behavior. Keep history only when it explains a current
  decision or constraint. Check commands, examples, defaults and capability
  claims against code and tests, and state the scope of evidence. Local tests do
  not establish live-host support.

### Documentation levels

1. Fix guidance the change made inaccurate. Add no new explanation.
2. Make small edits covering what readers need.
3. Explain behavior, usage and necessary constraints.
4. Add detailed procedures or contracts, with examples and troubleshooting where
   useful.
5. Write a comprehensive reference for the explicit scope.

## Commits

Do not auto-commit unless you are implementing a plan already divided into
commits or the user explicitly asks. Group changes into coherent, independently
understandable commits, and make their order and dependencies clear so a
requested group can be applied first.
