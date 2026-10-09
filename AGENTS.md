# Agent instructions

## Essential reading

- Read the [README overview and task behavior](README.md) to understand the product.
- Before implementation or design work, read [Architecture](docs/architecture.md) for ownership and system boundaries.
- Before changing code, read the relevant [development workflow](docs/development.md#choosing-a-development-tool) and [checks](docs/development.md#checks). Read setup instructions only when running or configuring the project.

## Read when relevant

Read the matching guide's relevant sections before working in an area; unrelated guides do not need to be loaded.

| Work area                                                  | Read                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| UI components, styles or client state                      | [React UI architecture](docs/react-ui.md); [Panel behavior](docs/codex-panel.md) when changing user interactions.                  |
| Provider execution, permissions or session policy          | [Provider contract](docs/provider-contract.md) and relevant [Configuration](docs/configuration.md) sections.                       |
| Claude executable selection, readiness or SDK/CLI upgrades | [Claude Code CLI](docs/claude-cli.md) and [version qualification](docs/development.md#qualifying-claude-code-versions).            |
| Settings, budgets or repository access                     | Relevant [Configuration](docs/configuration.md) sections.                                                                          |
| MCP tools, user authority, forms or webhook events         | [MCP reference](docs/mcp-reference.md).                                                                                            |
| Host context, project/chat scope, entrypoints or mentions  | [Host capabilities](docs/host-capabilities.md).                                                                                    |
| Startup, continuation, recovery or storage                 | [Setup and task continuation](docs/setup-and-resume.md); [Database](docs/development.md#database) for schema changes or migration. |
| Capability claims or verification gaps                     | [Implementation status](docs/implementation-status.md); inspect dated evidence only for the claim being assessed.                  |

## Validation

- Match checks to the change and prefer focused checks during iteration. You may skip or defer expensive checks when their runtime outweighs the confidence they add; report what was skipped and why.
- Before committing, run the relevant formatting, lint, type, test, build and browser checks against the final changes being committed. Unrelated checks do not need to run.
- Format changed files with `npx eslint --fix <files> && npx prettier --write <files>`. ESLint enforces blank-line layout.
- HTTP integration suites need localhost TCP listeners. If the default Codex command sandbox reports `listen EPERM`, rerun the affected suites with escalated execution permission. CI needs a runner that permits it. Listener permission errors are not a reason to skip or weaken affected tests.

### Browser checks

Check in the browser when a change is large, when seeing it would help, or when the user asks. Skip small changes that tests cover.

- Follow [UI verification](docs/ui-verification.md) for dev-server setup, fixture cases, host controls and browser measurements. Use fixture data; use live data only for behavior fixtures cannot show, and do not start tasks in live mode.
- Build preview events with the typed builder or [record them](docs/development.md#recorded-fixtures) with `npm run fixture:record`. Add a fixture for every new event or activity row kind; `ui/dev/preview/preview-sdk-fixtures.test.ts` replays synthetic and recorded events through the provider.
- Start or restart a needed dev server without asking for permission and notify the user. Otherwise leave existing servers running.

## Documentation style

- Lead with what the reader needs to know or do. Use plain language, active voice and precise, consistent terms; avoid filler, unnecessary jargon and invented labels.
- Give each guide a clear purpose and audience. Keep the README focused on orientation and setup; place detailed procedures and contracts in their owning guides. Include implementation details only when they help that audience.
- Keep one canonical home for each explanation and link to it elsewhere, repeating only a brief summary needed locally. Update explanations in place, consolidate overlap and remove superseded material after retaining useful details. Check affected links and headings.
- Use short paragraphs and descriptive headings, numbered steps, bullets for parallel points and tables for comparisons. Add small command or code examples when they make a workflow usable.
- Describe current behavior. Keep history only when it explains a current decision or constraint. Resolve discrepancies with code and tests, checking commands, examples, defaults and capability claims. Date evidence and state its scope; local tests do not establish live-host support.

## Component and change conventions

- Organize modules around feature ownership and reasons to change. Keep feature logic, types, UI and styles together; group subfolders by responsibility rather than file type. Put UI domain logic in `ui/features` and reusable generic helpers in `ui/shared/utils`. Limit shared code to stable cross-feature concepts and platform integrations.
- Keep focused tests beside their owning modules; reserve integration suites for behavior that crosses feature, process, host, or environment boundaries.
- Keep components focused on rendering; extract reusable helpers into their owning modules. Split oversized files by responsibility and keep one React component per file unless splitting adds needless indirection. Use kebab-case component filenames.
- Prefer named prop and state types over inline object types.
- Name components for their actual scope. Use a generic name only when the component and its styling are genuinely reusable; use a domain-specific name when behavior or styling is domain-specific.
- Keep large collapsed sections lightweight: unmount expensive child rows while closed, and show a loader when asynchronous or deferred rendering needs feedback.
- Categorize changes into coherent, independently understandable commit groups, and make dependencies/order clear so a requested group can be applied first. Do not auto-commit unless implementing a plan already divided into commits or the user explicitly asks.
