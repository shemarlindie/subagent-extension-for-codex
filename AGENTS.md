# Agent instructions

Keep things simple and treat over-engineering as a defect. See [Component and change conventions](#component-and-change-conventions).

## Essential reading

- Read the [README overview and task behavior](README.md) to understand the product.
- Before choosing an approach for design or any implementation work (including creating, extending, fixing and refactoring), inspect the relevant existing code and instructions, and read [Architecture](docs/architecture.md) and the matching guides below for ownership and system boundaries.
- Before changing code, read the relevant [development workflow](docs/development.md#choosing-a-development-tool) and [checks](docs/development.md#checks). Read setup instructions only when running or configuring the project.

## Read when relevant

Read the matching guide's relevant sections before working in an area. Unrelated guides do not need to be loaded.

| Work area                                                  | Read                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI components, styles or client state                      | Prefer Base UI where suitable. See [Panel architecture](docs/panel-architecture.md) and [Panel behavior](docs/panel-guide.md).                                       |
| Provider execution, permissions or session policy          | [Provider contract](docs/provider-contract.md) and relevant [Configuration](docs/configuration.md) sections.                                                         |
| Claude executable selection, readiness or SDK/CLI upgrades | [Claude Code CLI](docs/claude-cli.md) and [version qualification](docs/claude-verification.md#qualifying-claude-code-versions).                                      |
| Settings, budgets or repository access                     | Relevant [Configuration](docs/configuration.md) sections.                                                                                                            |
| MCP tools, user authority or panel inputs                  | [MCP reference](docs/mcp-reference.md).                                                                                                                              |
| Host context, project/chat scope, entrypoints or mentions  | [Host capabilities](docs/host-capabilities.md).                                                                                                                      |
| Startup, continuation, recovery or storage                 | [Task continuation](docs/task-continuation.md). [Database and migrations](docs/database.md) for schema changes or migration.                                         |
| Capability claims or verification gaps                     | [Host capabilities](docs/host-capabilities.md) and [Claude execution verification](docs/claude-verification.md). Inspect evidence only for the claim being assessed. |

## Validation

- Validate the resulting behavior and relevant architectural boundaries. Match checks to the change and prefer focused checks during iteration. You may skip or defer expensive checks when their runtime outweighs the confidence they add. Report what was skipped and why.
- Before adding, changing or removing tests, inspect existing coverage and follow [Choosing test coverage](docs/development.md#choosing-test-coverage).
- Before committing, run the relevant formatting, lint, type, test, build and browser checks against the final changes being committed. Unrelated checks do not need to run.
- Follow the repository's ESLint rules when editing code.
- Format changed files with `npx eslint --fix <files> && npx prettier --write <files>`.
- Before running HTTP integration suites, ensure the sandbox permits localhost TCP listeners (`127.0.0.1`). Request escalation up front if needed. CI runners need the same access. Do not skip these tests because listener binding is denied.
- Update affected documentation and report meaningful design decisions, intentional differences from established patterns, and remaining concerns in proportion to the change.

### Browser checks

Check in the browser when a change is large, when seeing it would help, or when the user asks. Skip small changes that tests cover.

- For large changes, use the `verify-features` skill. It covers the tools, scripts, and the widths, themes and states to check. For other checks, a screenshot of the affected state is enough.
- Follow [UI verification](docs/ui-verification.md) for dev-server setup, fixture cases, host controls and browser measurements. Use fixture data. Use live data only for behavior fixtures cannot show, and do not start tasks in live mode.
- Build preview events with the typed builder in `dev/panel/scenarios/timeline.ts` or [record them](docs/development.md#recorded-fixtures) with `npm run fixture:record`. Add a fixture for every new event or activity row kind. `dev/panel/scenarios/preview-sdk-fixtures.test.ts` replays synthetic and recorded events through the provider.
- Start or restart a needed dev server without asking for permission and notify the user. Stop any dev server you started for validation when you are done. Leave pre-existing servers running.

### Large changes

- Before building on an external behavior or an unproven approach, confirm it with a small probe or prototype. Keep it so tests can reuse it.
- Plan a verification checklist of expected behaviors with IDs, and list accepted limits separately. In the plan, have each planned commit name the IDs it verifies. Evidence can be a new or existing test or a browser check. Keep IDs in the plan, out of code and test names.

## Writing style

Use plain language, active voice, and direct statements. Start with the main point. Add the context, reasons, and examples the reader needs.

Be concise, precise and consistent. Keep claims accurate, explain uncertainty, and avoid repetition.

Use short paragraphs. Add headings, lists, or tables when they make the writing easier to follow.

Avoid semicolons and dashes in sentences. Keep them where needed in code, commands, formatting, and hyphenated words. Avoid “not X, but Y” phrasing and equivalents such as “rather than” or “not just,” unless the contrast is the clearest way to communicate an important distinction.

## Documentation style

- Give each guide a clear purpose and audience. Keep the README focused on orientation and setup. Place detailed procedures and contracts in their owning guides. Include implementation details only when they help that audience, and skip obvious or expected behavior.
- Keep one canonical home for each explanation and link to it elsewhere, repeating only a brief summary needed locally. Update explanations in place and remove superseded material after retaining useful details. Check affected links and headings.
- Describe current behavior. Keep history only when it explains a current decision or constraint. Check commands, examples, defaults and capability claims against code and tests. State the scope of evidence. Local tests do not establish live-host support.

## Component and change conventions

- Keep responsibility boundaries clear, modules cohesive, state and lifecycle ownership appropriate, and dependency direction consistent. Follow established patterns when suitable. Address architectural weaknesses introduced or directly affected by the change. Leave broader improvements as recommendations outside the task's scope.
- Organize modules around feature ownership and reasons to change. Keep feature logic, types, UI and styles together. Group subfolders by responsibility rather than file type. Put UI domain logic in `src/panel/features` and reusable generic helpers in `src/panel/shared/utils`. Keep browser-safe contracts and domain functions used by both runtimes in feature-scoped `src/shared` modules. These must not import service execution or panel rendering. Keep application composition and state in `src/panel/app/state`. Limit panel shared code to stable cross-feature concepts and platform integrations.
- Reuse existing components, logic, styles and infrastructure where responsibilities align. Preserve distinct behavior and presentation where the domain requires them. Introduce an abstraction only when it removes real duplication or clarifies ownership, and keep it free of excessive configuration or coupling.
- Keep new and existing code as simple as the task allows. Build for current requirements and avoid speculative options, generality, layers and handling for cases that cannot occur. Apply the same restraint to tests, documentation and plans. Within the affected area, simplify over-engineered code and remove unnecessary duplication, obsolete code and needless indirection. Keep components and utilities small and focused, with components responsible for rendering and reusable helpers in their owning modules. Split files by responsibility without needless fragmentation, normally keeping one React component per file. Use kebab-case component filenames.
- Prefer named prop and state types. Use existing types or `satisfies` when they simplify code or replace repeated assertions.
- Name components for their actual scope. Use a generic name only when the component and its styling are genuinely reusable. Use a domain-specific name when behavior or styling is domain-specific.
- Keep large collapsed sections lightweight: unmount expensive child rows while closed, and show a loader when asynchronous or deferred rendering needs feedback.
- Categorize changes into coherent, independently understandable commit groups, and make dependencies/order clear so a requested group can be applied first. Do not auto-commit unless implementing a plan already divided into commits or the user explicitly asks.
